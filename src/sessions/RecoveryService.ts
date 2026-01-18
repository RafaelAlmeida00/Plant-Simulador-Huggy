// src/sessions/RecoveryService.ts

import { SessionRepository, ISession } from '../adapters/http/repositories/SessionRepository';
import { PlantSnapshotRepository, IPlantSnapshotRecord } from '../adapters/http/repositories/PlantSnapshotRepository';
import { BufferStateRepository, IBufferState } from '../adapters/http/repositories/BufferStateRepository';
import { CarEventRepository, ICarEvent } from '../adapters/http/repositories/CarEventRepository';
import { StopEventRepository, IStopEvent } from '../adapters/http/repositories/StopEventRepository';
import { DatabaseFactory } from '../adapters/database/DatabaseFactory';
import { logger } from '../utils/logger';
import { PlantSnapshot } from '../utils/shared';

/**
 * Recovery data collected for a session
 */
export interface SessionRecoveryData {
    session: ISession;
    plantSnapshot: PlantSnapshot | null;
    bufferStates: IBufferState[];
    completedCarIds: Set<string>;
    activeStops: IStopEvent[];
}

/**
 * Summary of recovery operation
 */
export interface RecoverySummary {
    interruptedCount: number;
    expiredCount: number;
    staleCount: number;
    sessions: ISession[];
}

/**
 * RecoveryService handles session recovery after server restart.
 *
 * Responsibilities:
 * - Mark active sessions as interrupted on server startup
 * - Collect recovery data (snapshots, buffers, completed cars)
 * - Provide methods for session recovery or discard
 */
export class RecoveryService {
    private readonly sessionRepository: SessionRepository;
    private readonly plantSnapshotRepository: PlantSnapshotRepository;
    private readonly bufferStateRepository: BufferStateRepository;
    private readonly carEventRepository: CarEventRepository;
    private readonly stopEventRepository: StopEventRepository;

    // Maximum age for interrupted sessions before marking as stopped (24 hours)
    private readonly MAX_INTERRUPTED_AGE_MS = 24 * 60 * 60 * 1000;

    constructor() {
        this.sessionRepository = new SessionRepository();
        this.plantSnapshotRepository = new PlantSnapshotRepository();
        this.bufferStateRepository = new BufferStateRepository();
        this.carEventRepository = new CarEventRepository();
        this.stopEventRepository = new StopEventRepository();
    }

    /**
     * Called on server startup to handle any sessions that were running when server stopped
     */
    public async handleServerStartup(): Promise<RecoverySummary> {
        logger().info('[RecoveryService] Handling server startup recovery...');

        // 1. Mark all running/paused sessions as interrupted
        const interruptedCount = await this.sessionRepository.markSessionsAsInterrupted();
        logger().info(`[RecoveryService] Marked ${interruptedCount} sessions as interrupted`);

        // 2. Mark expired sessions
        const expiredCount = await this.sessionRepository.markExpiredSessions();
        logger().info(`[RecoveryService] Marked ${expiredCount} sessions as expired`);

        // 3. Mark stale interrupted sessions as stopped (older than MAX_INTERRUPTED_AGE_MS)
        const staleCount = await this.sessionRepository.markStaleSessionsAsStopped(this.MAX_INTERRUPTED_AGE_MS);
        logger().info(`[RecoveryService] Marked ${staleCount} stale sessions as stopped`);

        // 4. Get all interrupted sessions for the summary
        const db = await DatabaseFactory.getDatabase();
        const sql = `SELECT * FROM sessions WHERE status = $1 ORDER BY interrupted_at DESC`;
        const result = await db.query<ISession>(
            db.getDialect() === 'postgres' ? sql : sql.replace(/\$\d+/g, '?'),
            ['interrupted']
        );

        logger().info(`[RecoveryService] Server startup complete. ${result.rows.length} sessions available for recovery`);

        return {
            interruptedCount,
            expiredCount,
            staleCount,
            sessions: result.rows
        };
    }

    /**
     * Get all interrupted sessions for a user
     */
    public async getInterruptedSessions(userId: string): Promise<ISession[]> {
        return this.sessionRepository.findInterruptedByUser(userId);
    }

    /**
     * Check if a session can be recovered
     */
    public async canRecover(sessionId: string): Promise<boolean> {
        return this.sessionRepository.canRecover(sessionId);
    }

    /**
     * Collect all recovery data for a session
     */
    public async collectRecoveryData(sessionId: string): Promise<SessionRecoveryData | null> {
        const session = await this.sessionRepository.findById(sessionId);
        if (!session) {
            logger().warn(`[RecoveryService] Session ${sessionId} not found`);
            return null;
        }

        if (session.status !== 'interrupted') {
            logger().warn(`[RecoveryService] Session ${sessionId} is not in interrupted state (${session.status})`);
            return null;
        }

        logger().info(`[RecoveryService] Collecting recovery data for session ${sessionId}...`);

        // 1. Get the latest plant snapshot
        const plantSnapshot = await this.getLatestPlantSnapshot(sessionId);

        // 2. Get the latest buffer states
        const bufferStates = await this.getLatestBufferStates(sessionId);

        // 3. Get completed car IDs (cars that have COMPLETED events)
        const completedCarIds = await this.getCompletedCarIds(sessionId);

        // 4. Get active stops (stops that were IN_PROGRESS when server stopped)
        const activeStops = await this.getActiveStops(sessionId);

        logger().info(
            `[RecoveryService] Recovery data collected: ` +
            `snapshot=${plantSnapshot ? 'yes' : 'no'}, ` +
            `buffers=${bufferStates.length}, ` +
            `completedCars=${completedCarIds.size}, ` +
            `activeStops=${activeStops.length}`
        );

        return {
            session,
            plantSnapshot,
            bufferStates,
            completedCarIds,
            activeStops
        };
    }

    /**
     * Get the latest plant snapshot for a session
     */
    private async getLatestPlantSnapshot(sessionId: string): Promise<PlantSnapshot | null> {
        const db = await DatabaseFactory.getDatabase();
        const sql = `SELECT * FROM plant_snapshots WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 1`;
        const result = await db.query<IPlantSnapshotRecord>(
            db.getDialect() === 'postgres' ? sql : sql.replace(/\$1/g, '?'),
            [sessionId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const record = result.rows[0];
        if (typeof record.snapshot_data === 'string') {
            try {
                return JSON.parse(record.snapshot_data) as PlantSnapshot;
            } catch {
                return null;
            }
        }
        return record.snapshot_data as PlantSnapshot;
    }

    /**
     * Get the latest buffer states for a session
     */
    private async getLatestBufferStates(sessionId: string): Promise<IBufferState[]> {
        const db = await DatabaseFactory.getDatabase();

        // Get the latest state for each buffer
        const sql = `
            SELECT b.*
            FROM buffer_states b
            INNER JOIN (
                SELECT buffer_id, MAX(timestamp) AS max_ts
                FROM buffer_states
                WHERE session_id = $1
                GROUP BY buffer_id
            ) m ON b.buffer_id = m.buffer_id AND b.timestamp = m.max_ts
            WHERE b.session_id = $1
        `;

        const convertedSql = db.getDialect() === 'postgres'
            ? sql
            : sql.replace(/\$1/g, '?');

        const result = await db.query<IBufferState>(convertedSql, [sessionId]);

        // Parse car_ids if it's a string
        return result.rows.map(state => {
            if (typeof state.car_ids === 'string') {
                try {
                    state.car_ids = JSON.parse(state.car_ids);
                } catch {
                    state.car_ids = [];
                }
            }
            return state;
        });
    }

    /**
     * Get all car IDs that have COMPLETED events for a session
     */
    private async getCompletedCarIds(sessionId: string): Promise<Set<string>> {
        const db = await DatabaseFactory.getDatabase();
        const sql = `SELECT DISTINCT car_id FROM car_events WHERE session_id = $1 AND event_type = $2`;
        const result = await db.query<{ car_id: string }>(
            db.getDialect() === 'postgres' ? sql : sql.replace(/\$\d+/g, '?'),
            [sessionId, 'COMPLETED']
        );

        return new Set(result.rows.map(r => r.car_id));
    }

    /**
     * Get active stops for a session (stops that were IN_PROGRESS)
     */
    private async getActiveStops(sessionId: string): Promise<IStopEvent[]> {
        const db = await DatabaseFactory.getDatabase();
        const sql = `SELECT * FROM stop_events WHERE session_id = $1 AND status = $2 ORDER BY start_time DESC`;
        const result = await db.query<IStopEvent>(
            db.getDialect() === 'postgres' ? sql : sql.replace(/\$\d+/g, '?'),
            [sessionId, 'IN_PROGRESS']
        );

        return result.rows;
    }

    /**
     * Prepare recovery payload for worker initialization
     * This transforms the recovery data into a format the worker can use
     */
    public prepareRecoveryPayload(recoveryData: SessionRecoveryData): {
        simulatedTimestamp: number;
        currentTick: number;
        plantSnapshot: PlantSnapshot | null;
        bufferStates: Array<{
            bufferId: string;
            carIds: string[];
            currentCount: number;
            status: string;
        }>;
        completedCarIds: string[];
        activeStops: Array<{
            stopId: string;
            shop: string;
            line: string;
            station: string;
            reason?: string;
            type?: string;
            category?: string;
            severity?: string;
            startTime: number;
            durationMs?: number;
        }>;
    } {
        return {
            simulatedTimestamp: recoveryData.session.simulated_timestamp || Date.now(),
            currentTick: recoveryData.session.current_tick || 0,
            plantSnapshot: recoveryData.plantSnapshot,
            bufferStates: recoveryData.bufferStates.map(state => ({
                bufferId: state.buffer_id,
                carIds: Array.isArray(state.car_ids) ? state.car_ids : [],
                currentCount: state.current_count,
                status: state.status
            })),
            completedCarIds: Array.from(recoveryData.completedCarIds),
            activeStops: recoveryData.activeStops.map(stop => ({
                stopId: stop.stop_id,
                shop: stop.shop,
                line: stop.line,
                station: stop.station,
                reason: stop.reason,
                type: stop.type,
                category: stop.category,
                severity: stop.severity,
                startTime: stop.start_time,
                durationMs: stop.duration_ms
            }))
        };
    }

    /**
     * Mark a session as recovered (change status to running)
     */
    public async markAsRecovered(sessionId: string): Promise<ISession | null> {
        const session = await this.sessionRepository.findById(sessionId);
        if (!session || session.status !== 'interrupted') {
            return null;
        }

        return this.sessionRepository.updateStatus(sessionId, 'running', {
            interrupted_at: undefined
        });
    }

    /**
     * Discard an interrupted session (mark as stopped, keep data)
     */
    public async discardSession(sessionId: string): Promise<ISession | null> {
        const session = await this.sessionRepository.findById(sessionId);
        if (!session || session.status !== 'interrupted') {
            return null;
        }

        return this.sessionRepository.updateStatus(sessionId, 'stopped', {
            stopped_at: Date.now(),
            interrupted_at: undefined
        });
    }

    /**
     * Delete an interrupted session and all its data
     */
    public async deleteInterruptedSession(sessionId: string): Promise<boolean> {
        const session = await this.sessionRepository.findById(sessionId);
        if (!session || session.status !== 'interrupted') {
            return false;
        }

        await this.sessionRepository.deleteSessionData(sessionId);
        return true;
    }
}
