// Load environment variables BEFORE any other imports
import 'dotenv/config';

import { Server } from "./adapters/http/server";
import { socketServer } from "./adapters/http/websocket/SocketServer";
import { DatabaseFactory } from "./adapters/database/DatabaseFactory";
import { logger } from "./utils/logger";
import { validateSecurityEnvironment } from "./config/security-config";
import { SessionManager } from "./sessions/SessionManager";
import { registerSessionRoutes } from "./adapters/http/router/router";

const serverStartTime = Date.now();

const MEMORY_LOG_INTERVAL_MS = 30_000;
let memoryLogInterval: NodeJS.Timeout | undefined;

function bytesToMiB(bytes: number): number {
    return bytes / 1024 / 1024;
}

function logMemoryUsage(reason: string): void {
    const mem = process.memoryUsage();
    const uptimeMs = Date.now() - serverStartTime;

    console.log(
        `[MEM] reason=${reason} uptimeMs=${uptimeMs} ` +
        `rssMiB=${bytesToMiB(mem.rss).toFixed(1)} ` +
        `heapUsedMiB=${bytesToMiB(mem.heapUsed).toFixed(1)} ` +
        `heapTotalMiB=${bytesToMiB(mem.heapTotal).toFixed(1)} ` +
        `externalMiB=${bytesToMiB(mem.external).toFixed(1)} ` +
        `arrayBuffersMiB=${bytesToMiB(mem.arrayBuffers).toFixed(1)}`
    );
}

function startMemoryLogging(): void {
    if (memoryLogInterval) return;

    logMemoryUsage('startup');
    memoryLogInterval = setInterval(() => {
        logMemoryUsage('interval');
    }, MEMORY_LOG_INTERVAL_MS);
}

function stopMemoryLogging(): void {
    if (!memoryLogInterval) return;
    clearInterval(memoryLogInterval);
    memoryLogInterval = undefined;
}

process.on('SIGTERM', () => {
    console.log('[SIGNAL] SIGTERM received. Logging memory snapshot and shutting down.');
    logMemoryUsage('SIGTERM');
    stopMemoryLogging();

    // Since we added a SIGTERM handler, Node will not exit by default.
    // Give stdout a brief moment to flush.
    setTimeout(() => {
        process.exit(0);
    }, 250);
});

async function main(): Promise<void> {
    startMemoryLogging();

    logger().info('[BOOT] Starting simulation server...');

    // Security validation FIRST - fail fast if misconfigured
    logger().info('[BOOT] Validating security environment...');
    validateSecurityEnvironment();

    // Primeiro processo do boot: banco (inclui criação de tabelas via connect()).
    await DatabaseFactory.getDatabase();

    logger().info('[BOOT] Database connected. Initializing session manager...');

    // Initialize SessionManager for multi-session support
    const sessionManager = new SessionManager();
    await sessionManager.initialize();
    logger().info('[BOOT] Session manager initialized.');

    // Register session routes
    registerSessionRoutes(sessionManager);
    logger().info('[BOOT] Session routes registered.');

    // Forward worker events to WebSocket for session-specific broadcasting
    sessionManager.onWorkerEvent((event) => {
        // Route session events to subscribed clients
        switch (event.type) {
            case 'EVENT':
                // Handle simulation events (sent with eventType in data)
                const eventType = event.data?.eventType;
                switch (eventType) {
                    case 'carCreated':
                    case 'carMoved':
                    case 'carCompleted':
                    case 'bufferIn':
                    case 'bufferOut':
                    case 'reworkIn':
                    case 'reworkOut':
                        socketServer.emitSessionEvent(event.sessionId, eventType, event.data);
                        break;

                    case 'stopStarted':
                        socketServer.broadcastToSession(event.sessionId, 'stops', {
                            action: 'STARTED',
                            stop: event.data.stop
                        });
                        break;

                    case 'stopEnded':
                        socketServer.broadcastToSession(event.sessionId, 'stops', {
                            action: 'ENDED',
                            stop: event.data.stop
                        });
                        break;

                    case 'oeeCalculated':
                        socketServer.broadcastToSession(event.sessionId, 'oee', event.data.oee);
                        break;

                    case 'tick':
                        // Emit health status for session
                        socketServer.broadcastToSession(event.sessionId, 'health', {
                            serverStatus: 'healthy',
                            simulatorStatus: event.data.state?.status || 'running',
                            timestamp: Date.now(),
                            simulatorTimestamp: event.data.tick?.simulatedTimestamp,
                            simulatorTimeString: event.data.tick?.simulatedTimeString
                        });
                        break;
                }
                break;

            case 'STATE_CHANGE':
                // Session state changed (running, paused, stopped)
                socketServer.broadcastToSession(event.sessionId, 'health', {
                    serverStatus: 'healthy',
                    simulatorStatus: event.data?.status || 'unknown',
                    timestamp: Date.now()
                });
                break;

            case 'ERROR':
                socketServer.broadcastToSession(event.sessionId, 'events', {
                    type: 'SESSION_ERROR',
                    error: event.data
                });
                break;

            case 'WORKER_CRASHED':
                socketServer.broadcastToSession(event.sessionId, 'events', {
                    type: 'SESSION_CRASHED',
                    message: 'Worker thread crashed unexpectedly'
                });
                break;

            // INIT_COMPLETE and HEARTBEAT are handled internally by SessionManager
        }
    });
    logger().info('[BOOT] Worker event forwarding configured.');

    // Start HTTP server (no legacy simulation - use multi-session architecture)
    const server = new Server();
    await server.listen();

    logger().info('[BOOT] Server ready. Create sessions via POST /api/sessions');
}

main().catch((error) => {
    console.error('[BOOT] Fatal error during startup:', error);
    process.exitCode = 1;
});
