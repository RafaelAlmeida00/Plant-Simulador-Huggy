// src/sessions/WorkerPoolManager.ts

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import * as path from 'path';

/**
 * Message types sent from Main Thread to Worker
 */
export type WorkerCommandType = 'INIT' | 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RECOVER';

/**
 * Message structure for Main → Worker commands
 */
export interface WorkerMessage {
    type: WorkerCommandType;
    sessionId: string;
    payload?: any;
}

/**
 * Event types sent from Worker to Main Thread
 */
export type WorkerEventType =
    | 'INIT_COMPLETE'
    | 'HEARTBEAT'
    | 'EVENT'
    | 'ERROR'
    | 'STATE_CHANGE'
    | 'WORKER_CRASHED';

/**
 * Event structure for Worker → Main communication
 */
export interface WorkerEvent {
    type: WorkerEventType;
    sessionId: string;
    data?: any;
    timestamp: number;
}

/**
 * Metadata for tracking active workers
 */
interface WorkerMetadata {
    worker: Worker;
    sessionId: string;
    createdAt: number;
    lastHeartbeat: number;
    status: 'initializing' | 'ready' | 'running' | 'paused' | 'stopping' | 'stopped';
    gracefulShutdown: boolean; // Marks intentional shutdown to prevent false crash detection
}

/**
 * WorkerPoolManager manages Worker Threads for simulation sessions.
 *
 * Responsibilities:
 * - Spawn/terminate Worker Threads
 * - Message routing (Main ↔ Worker)
 * - Health monitoring (heartbeat)
 * - Crash detection and notification
 */
export class WorkerPoolManager extends EventEmitter {
    // Map of sessionId -> WorkerMetadata
    private workers: Map<string, WorkerMetadata> = new Map();

    // Heartbeat monitoring
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_INTERVAL_MS = 5_000;
    private readonly HEARTBEAT_TIMEOUT_MS = 15_000;

    // Path to the worker script
    private readonly workerScriptPath: string;

    constructor() {
        super();

        // Determine worker script path
        // In production, the worker will be compiled to JS
        // In development, we use ts-node or similar
        const isProduction = process.env.NODE_ENV === 'production';
        this.workerScriptPath = isProduction
            ? path.resolve(__dirname, '../workers/SimulationWorker.js')
            : path.resolve(__dirname, '../workers/SimulationWorker.ts');

        this.startHeartbeatMonitoring();
    }

    /**
     * Spawn a new worker for a session
     */
    public async spawnWorker(sessionId: string): Promise<string> {
        if (this.workers.has(sessionId)) {
            throw new Error(`Worker already exists for session ${sessionId}`);
        }

        logger().info(`[WorkerPool] Spawning worker for session ${sessionId}`);

        return new Promise((resolve, reject) => {
            try {
                // Determine if we need ts-node for development
                const isProduction = process.env.NODE_ENV === 'production';
                const workerOptions: any = {
                    workerData: { sessionId }
                };

                // In development, use ts-node to run TypeScript workers directly
                if (!isProduction) {
                    workerOptions.execArgv = ['-r', 'ts-node/register'];
                }

                const worker = new Worker(this.workerScriptPath, workerOptions);

                const metadata: WorkerMetadata = {
                    worker,
                    sessionId,
                    createdAt: Date.now(),
                    lastHeartbeat: Date.now(),
                    status: 'initializing',
                    gracefulShutdown: false
                };

                // Setup message handler
                worker.on('message', (event: WorkerEvent) => {
                    this.handleWorkerMessage(sessionId, event);
                });

                // Setup error handler
                worker.on('error', (error: Error) => {
                    logger().error(`[WorkerPool] Worker error for session ${sessionId}: ${error.message}`);
                    this.emit('event', {
                        type: 'ERROR',
                        sessionId,
                        data: { message: error.message, stack: error.stack },
                        timestamp: Date.now()
                    } as WorkerEvent);
                });

                // Setup exit handler
                worker.on('exit', (code) => {
                    logger().info(`[WorkerPool] Worker for session ${sessionId} exited with code ${code}`);

                    // Get metadata BEFORE deleting to check gracefulShutdown flag
                    const metadata = this.workers.get(sessionId);
                    const wasGracefulShutdown = metadata?.gracefulShutdown === true;
                    const wasActive = metadata !== undefined;

                    // Clean up
                    this.workers.delete(sessionId);

                    // Only emit crash if:
                    // 1. Worker was active (not already cleaned up)
                    // 2. NOT a graceful shutdown (flag was not set)
                    if (wasActive && !wasGracefulShutdown) {
                        this.emit('event', {
                            type: 'WORKER_CRASHED',
                            sessionId,
                            data: { exitCode: code },
                            timestamp: Date.now()
                        } as WorkerEvent);
                    }
                });

                // Store worker
                this.workers.set(sessionId, metadata);

                // Resolve immediately - worker is created but not initialized yet
                // INIT_COMPLETE will be waited for separately after INIT command is sent
                resolve(sessionId);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Wait for worker initialization to complete
     * Call this AFTER sending the INIT command
     */
    public async waitForInit(sessionId: string, timeoutMs: number = 30_000): Promise<void> {
        const metadata = this.workers.get(sessionId);
        if (!metadata) {
            throw new Error(`No worker found for session ${sessionId}`);
        }

        // If already ready, return immediately
        if (metadata.status === 'ready') {
            return;
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off('event', initHandler);
                reject(new Error(`Worker initialization timeout for session ${sessionId}`));
            }, timeoutMs);

            const initHandler = (event: WorkerEvent) => {
                if (event.type === 'INIT_COMPLETE' && event.sessionId === sessionId) {
                    clearTimeout(timeout);
                    metadata.status = 'ready';
                    this.off('event', initHandler);
                    resolve();
                } else if (event.type === 'ERROR' && event.sessionId === sessionId) {
                    clearTimeout(timeout);
                    this.off('event', initHandler);
                    reject(new Error(event.data?.message || 'Worker initialization failed'));
                }
            };

            this.on('event', initHandler);
        });
    }

    /**
     * Send a command to a worker
     */
    public async sendCommand(sessionId: string, message: WorkerMessage): Promise<void> {
        const metadata = this.workers.get(sessionId);
        if (!metadata) {
            throw new Error(`No worker found for session ${sessionId}`);
        }

        logger().debug(`[WorkerPool] Sending ${message.type} to session ${sessionId}`);

        metadata.worker.postMessage(message);
    }

    /**
     * Terminate a worker gracefully
     */
    public async terminateWorker(sessionId: string): Promise<void> {
        const metadata = this.workers.get(sessionId);
        if (!metadata) {
            return; // Already terminated
        }

        logger().info(`[WorkerPool] Terminating worker for session ${sessionId}`);

        // CRITICAL: Set graceful shutdown flag BEFORE sending STOP
        // This prevents the exit handler from emitting WORKER_CRASHED
        metadata.status = 'stopping';
        metadata.gracefulShutdown = true;

        // Delete from Map BEFORE terminate to avoid race condition with exit handler
        this.workers.delete(sessionId);

        // Give the worker a chance to clean up
        try {
            metadata.worker.postMessage({ type: 'STOP', sessionId } as WorkerMessage);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch {
            // Worker might already be unresponsive
        }

        // Force terminate
        await metadata.worker.terminate();

        logger().info(`[WorkerPool] Worker terminated for session ${sessionId}`);
    }

    /**
     * Terminate all workers
     */
    public async terminateAll(): Promise<void> {
        logger().info(`[WorkerPool] Terminating all ${this.workers.size} workers`);

        const terminatePromises = Array.from(this.workers.keys()).map(sessionId =>
            this.terminateWorker(sessionId)
        );

        await Promise.all(terminatePromises);

        this.stopHeartbeatMonitoring();
    }

    /**
     * Check if a worker exists for a session
     */
    public hasWorker(sessionId: string): boolean {
        return this.workers.has(sessionId);
    }

    /**
     * Get worker status
     */
    public getWorkerStatus(sessionId: string): WorkerMetadata['status'] | null {
        return this.workers.get(sessionId)?.status ?? null;
    }

    /**
     * Get count of active workers
     */
    public getActiveWorkerCount(): number {
        return this.workers.size;
    }

    /**
     * Get worker age in milliseconds
     */
    public getWorkerAge(sessionId: string): number {
        const metadata = this.workers.get(sessionId);
        if (!metadata) return 0;
        return Date.now() - metadata.createdAt;
    }

    /**
     * Register event listener for worker events
     */
    public onEvent(handler: (event: WorkerEvent) => void): void {
        this.on('event', handler);
    }

    /**
     * Remove event listener
     */
    public offEvent(handler: (event: WorkerEvent) => void): void {
        this.off('event', handler);
    }

    // ============================================================
    // PRIVATE METHODS
    // ============================================================

    private handleWorkerMessage(sessionId: string, event: WorkerEvent): void {
        const metadata = this.workers.get(sessionId);

        switch (event.type) {
            case 'HEARTBEAT':
                if (metadata) {
                    metadata.lastHeartbeat = Date.now();
                }
                break;

            case 'INIT_COMPLETE':
                if (metadata) {
                    metadata.status = 'ready';
                }
                break;

            case 'STATE_CHANGE':
                if (metadata && event.data?.status) {
                    metadata.status = event.data.status;
                }
                break;
        }

        // Forward all events to listeners
        this.emit('event', event);
    }

    private startHeartbeatMonitoring(): void {
        if (this.heartbeatInterval) return;

        this.heartbeatInterval = setInterval(() => {
            this.checkHeartbeats();
        }, this.HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeatMonitoring(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private checkHeartbeats(): void {
        const now = Date.now();

        for (const [sessionId, metadata] of this.workers) {
            if (metadata.status === 'initializing' || metadata.status === 'stopping') {
                continue;
            }

            const timeSinceHeartbeat = now - metadata.lastHeartbeat;
            if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT_MS) {
                logger().warn(`[WorkerPool] Worker for session ${sessionId} missed heartbeat (${timeSinceHeartbeat}ms)`);

                // Emit crash event
                this.emit('event', {
                    type: 'WORKER_CRASHED',
                    sessionId,
                    data: { reason: 'heartbeat_timeout', lastHeartbeat: metadata.lastHeartbeat },
                    timestamp: now
                } as WorkerEvent);

                // Terminate the unresponsive worker
                this.terminateWorker(sessionId).catch(err => {
                    logger().error(`[WorkerPool] Error terminating unresponsive worker:`, err);
                });
            }
        }
    }
}
