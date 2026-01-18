// src/sessions/SessionManager.ts

import { SessionRepository, ISession, SessionStatus } from '../adapters/http/repositories/SessionRepository';
import { WorkerPoolManager, WorkerMessage, WorkerEvent } from './WorkerPoolManager';
import { ConfigPlantRepository } from '../adapters/http/repositories/ConfigPlantRepository';
import { RecoveryService, SessionRecoveryData, RecoverySummary } from './RecoveryService';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * Session limits configuration
 */
export interface SessionLimits {
    maxGlobalSessions: number;
    maxSessionsPerUser: number;
}

/**
 * Options for creating a new session
 */
export interface CreateSessionOptions {
    userId: string;
    name?: string;
    configId?: string;
    durationDays?: number;
    speedFactor?: number;
}

/**
 * Session metadata tracked in memory
 */
export interface SessionMetadata {
    id: string;
    userId: string;
    status: SessionStatus;
    workerId?: string;
    startedAt?: number;
    expiresAt?: number;
}

/**
 * SessionManager handles the lifecycle of simulation sessions.
 *
 * Responsibilities:
 * - Track active sessions (Map<sessionId, SessionMetadata>)
 * - Enforce limits: 20 global, 2 per user
 * - Session lifecycle: idle → running → paused → stopped/expired
 * - Expiration cleanup scheduler
 */
export class SessionManager {
    private readonly sessionRepository: SessionRepository;
    private readonly configRepository: ConfigPlantRepository;
    private readonly workerPool: WorkerPoolManager;
    private readonly recoveryService: RecoveryService;
    private readonly limits: SessionLimits;

    // In-memory tracking of active sessions
    private activeSessions: Map<string, SessionMetadata> = new Map();

    // Expiration cleanup interval
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly CLEANUP_INTERVAL_MS = 60_000; // Check every minute

    // Recovery summary from last startup
    private lastRecoverySummary: RecoverySummary | null = null;

    constructor(
        limits: SessionLimits = { maxGlobalSessions: 20, maxSessionsPerUser: 2 },
        workerPool?: WorkerPoolManager
    ) {
        this.sessionRepository = new SessionRepository();
        this.configRepository = new ConfigPlantRepository();
        this.recoveryService = new RecoveryService();
        this.limits = limits;
        this.workerPool = workerPool ?? new WorkerPoolManager();

        // Setup worker event handlers
        this.setupWorkerEventHandlers();
    }

    /**
     * Initialize the SessionManager
     * - Handle server startup recovery
     * - Load active sessions from database
     * - Start expiration cleanup scheduler
     */
    public async initialize(): Promise<void> {
        logger().info('[SessionManager] Initializing...');

        // Handle server startup recovery - mark running sessions as interrupted
        this.lastRecoverySummary = await this.recoveryService.handleServerStartup();

        // Load active sessions from database (none should be running at this point)
        await this.loadActiveSessions();

        // Start cleanup scheduler
        this.startCleanupScheduler();

        logger().info(`[SessionManager] Initialized with ${this.activeSessions.size} active sessions`);
        if (this.lastRecoverySummary.interruptedCount > 0) {
            logger().info(`[SessionManager] ${this.lastRecoverySummary.interruptedCount} sessions available for recovery`);
        }
    }

    /**
     * Shutdown the SessionManager
     */
    public async shutdown(): Promise<void> {
        logger().info('[SessionManager] Shutting down...');

        // Stop cleanup scheduler
        this.stopCleanupScheduler();

        // Stop all workers
        await this.workerPool.terminateAll();

        logger().info('[SessionManager] Shutdown complete');
    }

    /**
     * Create a new session in idle state
     */
    public async createSession(options: CreateSessionOptions): Promise<ISession> {
        const { userId, name, configId, durationDays = 7, speedFactor = 60 } = options;

        // Check user limit
        const userSessionCount = await this.sessionRepository.countActiveByUserId(userId);
        if (userSessionCount >= this.limits.maxSessionsPerUser) {
            throw new Error(`User has reached maximum session limit (${this.limits.maxSessionsPerUser})`);
        }

        // Check global limit
        const globalSessionCount = await this.sessionRepository.countActiveGlobal();
        if (globalSessionCount >= this.limits.maxGlobalSessions) {
            throw new Error(`Global session limit reached (${this.limits.maxGlobalSessions})`);
        }

        // Get config snapshot if configId provided
        let configSnapshot: string | undefined;
        if (configId) {
            const config = await this.configRepository.findById(configId);
            if (config) {
                configSnapshot = config.config;
            }
        }

        // Create session in idle state
        const sessionId = randomUUID();
        const session = await this.sessionRepository.create({
            id: sessionId,
            user_id: userId,
            name,
            config_id: configId,
            config_snapshot: configSnapshot,
            duration_days: durationDays,
            speed_factor: speedFactor,
            status: 'idle',
            created_at: Date.now()
        });

        logger().info(`[SessionManager] Created session ${sessionId} for user ${userId}`);

        return session;
    }

    /**
     * Start a session (spawn worker, initialize simulation)
     */
    public async startSession(sessionId: string, userId: string): Promise<ISession> {
        // Verify ownership
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'idle' && session.status !== 'stopped') {
            throw new Error(`Cannot start session in ${session.status} state`);
        }

        // Check limits again (in case they changed)
        const userActiveCount = await this.sessionRepository.countActiveByUserId(userId);
        if (userActiveCount >= this.limits.maxSessionsPerUser) {
            throw new Error(`User has reached maximum active session limit (${this.limits.maxSessionsPerUser})`);
        }

        const globalActiveCount = await this.sessionRepository.countActiveGlobal();
        if (globalActiveCount >= this.limits.maxGlobalSessions) {
            throw new Error(`Global active session limit reached (${this.limits.maxGlobalSessions})`);
        }

        // Calculate expiration time
        const startedAt = Date.now();
        const expiresAt = startedAt + (session.duration_days * 24 * 60 * 60 * 1000);

        // Spawn worker
        const workerId = await this.workerPool.spawnWorker(sessionId);

        // Initialize the worker with session config
        await this.workerPool.sendCommand(sessionId, {
            type: 'INIT',
            sessionId,
            payload: {
                configSnapshot: session.config_snapshot,
                speedFactor: session.speed_factor
            }
        });

        // Start the simulation
        await this.workerPool.sendCommand(sessionId, {
            type: 'START',
            sessionId
        });

        // Update database
        const updatedSession = await this.sessionRepository.updateStatus(sessionId, 'running', {
            started_at: startedAt,
            expires_at: expiresAt
        });

        // Track in memory
        this.activeSessions.set(sessionId, {
            id: sessionId,
            userId,
            status: 'running',
            workerId,
            startedAt,
            expiresAt
        });

        logger().info(`[SessionManager] Started session ${sessionId}, expires at ${new Date(expiresAt).toISOString()}`);

        return updatedSession!;
    }

    /**
     * Pause a running session
     */
    public async pauseSession(sessionId: string, userId: string): Promise<ISession> {
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'running') {
            throw new Error(`Cannot pause session in ${session.status} state`);
        }

        // Send pause command to worker
        await this.workerPool.sendCommand(sessionId, {
            type: 'PAUSE',
            sessionId
        });

        // Update database
        const updatedSession = await this.sessionRepository.updateStatus(sessionId, 'paused');

        // Update memory tracking
        const metadata = this.activeSessions.get(sessionId);
        if (metadata) {
            metadata.status = 'paused';
        }

        logger().info(`[SessionManager] Paused session ${sessionId}`);

        return updatedSession!;
    }

    /**
     * Resume a paused session
     */
    public async resumeSession(sessionId: string, userId: string): Promise<ISession> {
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'paused') {
            throw new Error(`Cannot resume session in ${session.status} state`);
        }

        // Send resume command to worker
        await this.workerPool.sendCommand(sessionId, {
            type: 'RESUME',
            sessionId
        });

        // Update database
        const updatedSession = await this.sessionRepository.updateStatus(sessionId, 'running');

        // Update memory tracking
        const metadata = this.activeSessions.get(sessionId);
        if (metadata) {
            metadata.status = 'running';
        }

        logger().info(`[SessionManager] Resumed session ${sessionId}`);

        return updatedSession!;
    }

    /**
     * Stop a session (terminate worker, keep data)
     */
    public async stopSession(sessionId: string, userId: string): Promise<ISession> {
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'running' && session.status !== 'paused') {
            throw new Error(`Cannot stop session in ${session.status} state`);
        }

        // Send stop command and terminate worker
        try {
            await this.workerPool.sendCommand(sessionId, {
                type: 'STOP',
                sessionId
            });
        } catch {
            // Worker might already be dead
        }

        await this.workerPool.terminateWorker(sessionId);

        // Update database
        const updatedSession = await this.sessionRepository.updateStatus(sessionId, 'stopped', {
            stopped_at: Date.now()
        });

        // Remove from memory tracking
        this.activeSessions.delete(sessionId);

        logger().info(`[SessionManager] Stopped session ${sessionId}`);

        return updatedSession!;
    }

    /**
     * Delete a session and all its data
     */
    public async deleteSession(sessionId: string, userId: string): Promise<void> {
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        // If running, stop first
        if (session.status === 'running' || session.status === 'paused') {
            await this.stopSession(sessionId, userId);
        }

        // Delete all session data
        await this.sessionRepository.deleteSessionData(sessionId);

        // Remove from memory tracking
        this.activeSessions.delete(sessionId);

        logger().info(`[SessionManager] Deleted session ${sessionId} and all associated data`);
    }

    /**
     * Get session details
     */
    public async getSession(sessionId: string, userId: string): Promise<ISession | null> {
        return this.sessionRepository.findByIdForUser(sessionId, userId);
    }

    /**
     * List all sessions for a user
     */
    public async listUserSessions(userId: string): Promise<ISession[]> {
        return this.sessionRepository.findByUserId(userId);
    }

    /**
     * Get session count statistics
     */
    public async getSessionStats(userId: string): Promise<{ userActive: number; globalActive: number; limits: SessionLimits }> {
        const userActive = await this.sessionRepository.countActiveByUserId(userId);
        const globalActive = await this.sessionRepository.countActiveGlobal();

        return {
            userActive,
            globalActive,
            limits: this.limits
        };
    }

    /**
     * Register an event handler for worker events
     */
    public onWorkerEvent(handler: (event: WorkerEvent) => void): void {
        this.workerPool.onEvent(handler);
    }

    /**
     * Get the WorkerPoolManager (for WebSocket integration)
     */
    public getWorkerPool(): WorkerPoolManager {
        return this.workerPool;
    }

    // ============================================================
    // RECOVERY METHODS
    // ============================================================

    /**
     * Get the recovery summary from the last server startup
     */
    public getRecoverySummary(): RecoverySummary | null {
        return this.lastRecoverySummary;
    }

    /**
     * Get all interrupted sessions for a user (available for recovery)
     */
    public async getInterruptedSessions(userId: string): Promise<ISession[]> {
        return this.recoveryService.getInterruptedSessions(userId);
    }

    /**
     * Recover an interrupted session
     * This spawns a new worker and initializes it with the recovery data
     */
    public async recoverSession(sessionId: string, userId: string): Promise<ISession> {
        // Verify ownership
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'interrupted') {
            throw new Error(`Cannot recover session in ${session.status} state`);
        }

        // Check limits
        const userActiveCount = await this.sessionRepository.countActiveByUserId(userId);
        if (userActiveCount >= this.limits.maxSessionsPerUser) {
            throw new Error(`User has reached maximum active session limit (${this.limits.maxSessionsPerUser})`);
        }

        const globalActiveCount = await this.sessionRepository.countActiveGlobal();
        if (globalActiveCount >= this.limits.maxGlobalSessions) {
            throw new Error(`Global active session limit reached (${this.limits.maxGlobalSessions})`);
        }

        // Collect recovery data
        const recoveryData = await this.recoveryService.collectRecoveryData(sessionId);
        if (!recoveryData) {
            throw new Error('Failed to collect recovery data for session');
        }

        // Prepare recovery payload
        const recoveryPayload = this.recoveryService.prepareRecoveryPayload(recoveryData);

        // Spawn worker
        const workerId = await this.workerPool.spawnWorker(sessionId);

        // Initialize the worker with session config
        await this.workerPool.sendCommand(sessionId, {
            type: 'INIT',
            sessionId,
            payload: {
                configSnapshot: session.config_snapshot,
                speedFactor: session.speed_factor
            }
        });

        // Send recovery command to restore state
        await this.workerPool.sendCommand(sessionId, {
            type: 'RECOVER',
            sessionId,
            payload: recoveryPayload
        });

        // Start the simulation
        await this.workerPool.sendCommand(sessionId, {
            type: 'START',
            sessionId
        });

        // Update database - mark as running, clear interrupted_at
        const updatedSession = await this.sessionRepository.updateStatus(sessionId, 'running', {
            interrupted_at: undefined
        });

        // Track in memory
        this.activeSessions.set(sessionId, {
            id: sessionId,
            userId,
            status: 'running',
            workerId,
            startedAt: session.started_at,
            expiresAt: session.expires_at
        });

        logger().info(`[SessionManager] Recovered session ${sessionId} from interrupted state`);

        return updatedSession!;
    }

    /**
     * Discard an interrupted session (mark as stopped, keep data)
     */
    public async discardInterruptedSession(sessionId: string, userId: string): Promise<ISession> {
        // Verify ownership
        const session = await this.sessionRepository.findByIdForUser(sessionId, userId);
        if (!session) {
            throw new Error('Session not found or access denied');
        }

        if (session.status !== 'interrupted') {
            throw new Error(`Cannot discard session in ${session.status} state`);
        }

        const updatedSession = await this.recoveryService.discardSession(sessionId);
        if (!updatedSession) {
            throw new Error('Failed to discard session');
        }

        logger().info(`[SessionManager] Discarded interrupted session ${sessionId}`);

        return updatedSession;
    }

    /**
     * Check if a session can be recovered
     */
    public async canRecoverSession(sessionId: string): Promise<boolean> {
        return this.recoveryService.canRecover(sessionId);
    }

    // ============================================================
    // PRIVATE METHODS
    // ============================================================

    private setupWorkerEventHandlers(): void {
        this.workerPool.onEvent(async (event) => {
            switch (event.type) {
                case 'ERROR':
                    logger().error(`[SessionManager] Worker error for session ${event.sessionId}:`, event.data);
                    break;

                case 'WORKER_CRASHED':
                    logger().error(`[SessionManager] Worker crashed for session ${event.sessionId}`);
                    await this.handleWorkerCrash(event.sessionId);
                    break;

                case 'HEARTBEAT':
                    // Update last seen timestamp (could be used for health monitoring)
                    break;
            }
        });
    }

    private async handleWorkerCrash(sessionId: string): Promise<void> {
        const metadata = this.activeSessions.get(sessionId);
        if (!metadata) return;

        // Update session status to stopped
        await this.sessionRepository.updateStatus(sessionId, 'stopped', {
            stopped_at: Date.now()
        });

        this.activeSessions.delete(sessionId);

        logger().warn(`[SessionManager] Session ${sessionId} marked as stopped due to worker crash`);
    }

    private async loadActiveSessions(): Promise<void> {
        // Find all running/paused sessions
        const db = await this.sessionRepository['getDb']();
        const sql = `SELECT * FROM sessions WHERE status IN ('running', 'paused')`;
        const result = await db.query<ISession>(sql.replace(/\$\d+/g, '?'));

        for (const session of result.rows) {
            this.activeSessions.set(session.id, {
                id: session.id,
                userId: session.user_id,
                status: session.status,
                startedAt: session.started_at,
                expiresAt: session.expires_at
            });

            // Note: We don't restart workers here - sessions will need to be manually restarted
            // This is intentional to avoid resource exhaustion on server restart
            logger().info(`[SessionManager] Loaded session ${session.id} with status ${session.status}`);
        }
    }

    private startCleanupScheduler(): void {
        if (this.cleanupInterval) return;

        this.cleanupInterval = setInterval(async () => {
            await this.cleanupExpiredSessions();
        }, this.CLEANUP_INTERVAL_MS);

        logger().debug('[SessionManager] Cleanup scheduler started');
    }

    private stopCleanupScheduler(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    private async cleanupExpiredSessions(): Promise<void> {
        try {
            const expiredSessions = await this.sessionRepository.findExpired();

            for (const session of expiredSessions) {
                logger().info(`[SessionManager] Expiring session ${session.id}`);

                // Terminate worker if still running
                try {
                    await this.workerPool.terminateWorker(session.id);
                } catch {
                    // Worker might not exist
                }

                // Mark as expired
                await this.sessionRepository.markExpired(session.id);

                // Remove from memory tracking
                this.activeSessions.delete(session.id);
            }

            if (expiredSessions.length > 0) {
                logger().info(`[SessionManager] Cleaned up ${expiredSessions.length} expired sessions`);
            }
        } catch (error) {
            logger().error(`[SessionManager] Error during cleanup: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
