// src/adapters/http/repositories/SessionRepository.ts

import { BaseRepository } from './BaseRepository';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'expired' | 'interrupted';

export interface ISession {
    id: string;
    user_id: string;
    name?: string;
    config_id?: string;
    config_snapshot?: string;
    duration_days: number;
    speed_factor: number;
    status: SessionStatus;
    started_at?: number;
    expires_at?: number;
    stopped_at?: number;
    simulated_timestamp?: number;
    current_tick?: number;
    last_snapshot_at?: number;
    interrupted_at?: number;
    created_at?: number;
}

export class SessionRepository extends BaseRepository<ISession> {
    protected tableName = 'sessions';
    protected idColumn = 'id';
    protected timestampColumn = 'created_at';

    protected allowedFilterColumns(): readonly string[] {
        return ['id', 'user_id', 'name', 'config_id', 'status', 'started_at', 'expires_at', 'stopped_at', 'simulated_timestamp', 'current_tick', 'last_snapshot_at', 'interrupted_at', 'created_at'] as const;
    }

    public async create(entity: Partial<ISession>): Promise<ISession> {
        const db = await this.getDb();

        const sql = `
            INSERT INTO ${this.tableName}
            (id, user_id, name, config_id, config_snapshot, duration_days, speed_factor, status, started_at, expires_at, stopped_at, simulated_timestamp, current_tick, last_snapshot_at, interrupted_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ${this.getReturningClause(db)}
        `;

        const now = Date.now();
        const params = [
            entity.id,
            entity.user_id,
            entity.name ?? null,
            entity.config_id ?? null,
            entity.config_snapshot ?? null,
            entity.duration_days ?? 7,
            entity.speed_factor ?? 60,
            entity.status ?? 'idle',
            entity.started_at ?? null,
            entity.expires_at ?? null,
            entity.stopped_at ?? null,
            entity.simulated_timestamp ?? null,
            entity.current_tick ?? 0,
            entity.last_snapshot_at ?? null,
            entity.interrupted_at ?? null,
            entity.created_at ?? now
        ];

        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), params);

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        // SQLite doesn't support RETURNING, so fetch the inserted row
        return { ...entity, created_at: now } as ISession;
    }

    public async update(id: string | number, entity: Partial<ISession>): Promise<ISession | null> {
        const db = await this.getDb();

        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        const fields = ['user_id', 'name', 'config_id', 'config_snapshot', 'duration_days', 'speed_factor', 'status', 'started_at', 'expires_at', 'stopped_at', 'simulated_timestamp', 'current_tick', 'last_snapshot_at', 'interrupted_at'];
        for (const field of fields) {
            if ((entity as any)[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                params.push((entity as any)[field]);
            }
        }

        if (updates.length === 0) return this.findById(String(id));

        params.push(id);
        const returningClause = this.getReturningClause(db);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex}${returningClause}`;

        if (db.getDialect() === 'postgres') {
            const result = await db.query<ISession>(this.convertPlaceholders(db, sql), params);
            return result.rows[0] || null;
        }

        await db.execute(this.convertPlaceholders(db, sql), params);
        return this.findById(String(id));
    }

    /**
     * Find all sessions for a specific user
     */
    public async findByUserId(userId: string, statuses?: SessionStatus[]): Promise<ISession[]> {
        const db = await this.getDb();

        let sql = `SELECT * FROM ${this.tableName} WHERE user_id = $1`;
        const params: any[] = [userId];
        let paramIndex = 2;

        if (statuses && statuses.length > 0) {
            const placeholders = statuses.map(() => `$${paramIndex++}`).join(', ');
            sql += ` AND status IN (${placeholders})`;
            params.push(...statuses);
        }

        sql += ` ORDER BY created_at DESC`;

        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), params);
        return result.rows;
    }

    /**
     * Count active sessions for a user (running or paused)
     */
    public async countActiveByUserId(userId: string): Promise<number> {
        const db = await this.getDb();

        const sql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE user_id = $1 AND status IN ($2, $3)`;
        const result = await db.query<{ count: number }>(this.convertPlaceholders(db, sql), [userId, 'running', 'paused']);

        return Number(result.rows[0]?.count || 0);
    }

    /**
     * Count total active sessions globally (running or paused)
     */
    public async countActiveGlobal(): Promise<number> {
        const db = await this.getDb();

        const sql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE status IN ($1, $2)`;
        const result = await db.query<{ count: number }>(this.convertPlaceholders(db, sql), ['running', 'paused']);

        return Number(result.rows[0]?.count || 0);
    }

    /**
     * Find sessions that have expired (expires_at < now)
     */
    public async findExpired(): Promise<ISession[]> {
        const db = await this.getDb();

        const sql = `SELECT * FROM ${this.tableName} WHERE expires_at IS NOT NULL AND expires_at < $1 AND status IN ($2, $3)`;
        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), [Date.now(), 'running', 'paused']);

        return result.rows;
    }

    /**
     * Update session status
     */
    public async updateStatus(id: string, status: SessionStatus, additionalFields?: Partial<ISession>): Promise<ISession | null> {
        const updates: Partial<ISession> = { status, ...additionalFields };
        return this.update(id, updates);
    }

    /**
     * Delete all data for a session from all tables
     */
    public async deleteSessionData(sessionId: string): Promise<void> {
        const db = await this.getDb();

        const tables = ['car_events', 'stop_events', 'buffer_states', 'plant_snapshots', 'oee', 'mttr_mtbf'];

        await db.transaction(async () => {
            for (const table of tables) {
                const sql = `DELETE FROM ${table} WHERE session_id = $1`;
                await db.execute(this.convertPlaceholders(db, sql), [sessionId]);
            }

            // Finally delete the session itself
            const deleteSessionSql = `DELETE FROM ${this.tableName} WHERE id = $1`;
            await db.execute(this.convertPlaceholders(db, deleteSessionSql), [sessionId]);
        });
    }

    /**
     * Mark session as expired
     */
    public async markExpired(id: string): Promise<ISession | null> {
        return this.updateStatus(id, 'expired', { stopped_at: Date.now() });
    }

    /**
     * Find session by ID with ownership check
     */
    public async findByIdForUser(id: string, userId: string): Promise<ISession | null> {
        const db = await this.getDb();

        const sql = `SELECT * FROM ${this.tableName} WHERE id = $1 AND user_id = $2`;
        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), [id, userId]);

        return result.rows[0] || null;
    }

    // ==================== RECOVERY METHODS ====================

    /**
     * Find all sessions that were running or paused when server restarted
     * These are candidates for marking as interrupted
     */
    public async findActiveSessions(): Promise<ISession[]> {
        const db = await this.getDb();

        const sql = `SELECT * FROM ${this.tableName} WHERE status IN ($1, $2)`;
        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), ['running', 'paused']);

        return result.rows;
    }

    /**
     * Mark all active sessions as interrupted (called on server startup)
     * Returns the number of sessions marked
     */
    public async markSessionsAsInterrupted(): Promise<number> {
        const db = await this.getDb();

        const now = Date.now();
        const sql = `UPDATE ${this.tableName} SET status = $1, interrupted_at = $2 WHERE status IN ($3, $4)`;
        const rowCount = await db.execute(this.convertPlaceholders(db, sql), ['interrupted', now, 'running', 'paused']);

        return rowCount;
    }

    /**
     * Mark sessions that have passed their expires_at as expired
     */
    public async markExpiredSessions(): Promise<number> {
        const db = await this.getDb();

        const now = Date.now();
        const sql = `UPDATE ${this.tableName} SET status = $1, stopped_at = $2 WHERE expires_at IS NOT NULL AND expires_at < $3 AND status NOT IN ($4, $5, $6)`;
        const rowCount = await db.execute(this.convertPlaceholders(db, sql), ['expired', now, now, 'stopped', 'expired', 'interrupted']);

        return rowCount;
    }

    /**
     * Mark stale interrupted sessions as stopped (sessions interrupted for too long)
     */
    public async markStaleSessionsAsStopped(maxAgeMs: number): Promise<number> {
        const db = await this.getDb();

        const cutoff = Date.now() - maxAgeMs;
        const sql = `UPDATE ${this.tableName} SET status = $1, stopped_at = $2 WHERE status = $3 AND interrupted_at < $4`;
        const rowCount = await db.execute(this.convertPlaceholders(db, sql), ['stopped', Date.now(), 'interrupted', cutoff]);

        return rowCount;
    }

    /**
     * Update session clock state (called periodically during simulation)
     */
    public async updateClockState(id: string, simulatedTimestamp: number, currentTick: number): Promise<void> {
        const db = await this.getDb();

        const now = Date.now();
        const sql = `UPDATE ${this.tableName} SET simulated_timestamp = $1, current_tick = $2, last_snapshot_at = $3 WHERE id = $4`;
        await db.execute(this.convertPlaceholders(db, sql), [simulatedTimestamp, currentTick, now, id]);
    }

    /**
     * Find all interrupted sessions for a specific user
     */
    public async findInterruptedByUser(userId: string): Promise<ISession[]> {
        const db = await this.getDb();

        const sql = `SELECT * FROM ${this.tableName} WHERE user_id = $1 AND status = $2 ORDER BY interrupted_at DESC`;
        const result = await db.query<ISession>(this.convertPlaceholders(db, sql), [userId, 'interrupted']);

        return result.rows;
    }

    /**
     * Mark a session as interrupted (single session)
     */
    public async markInterrupted(id: string): Promise<ISession | null> {
        return this.updateStatus(id, 'interrupted', { interrupted_at: Date.now() });
    }

    /**
     * Check if a session can be recovered (has valid snapshot data)
     */
    public async canRecover(id: string): Promise<boolean> {
        const session = await this.findById(id);
        if (!session || session.status !== 'interrupted') {
            return false;
        }
        // Session can be recovered if it has a valid simulated_timestamp
        return session.simulated_timestamp !== null && session.simulated_timestamp !== undefined;
    }

    /**
     * Get recovery data for a session
     */
    public async getRecoveryData(id: string): Promise<{
        session: ISession;
        hasSnapshot: boolean;
    } | null> {
        const session = await this.findById(id);
        if (!session) return null;

        return {
            session,
            hasSnapshot: session.simulated_timestamp !== null && session.simulated_timestamp !== undefined
        };
    }
}
