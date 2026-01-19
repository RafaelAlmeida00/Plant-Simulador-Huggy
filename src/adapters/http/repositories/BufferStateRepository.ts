// src/adapters/database/repositories/BufferStateRepository.ts

import { BaseRepository } from './BaseRepository';

export interface IBufferState {
    id?: number;
    session_id?: string;
    buffer_id: string;
    from_location: string;
    to_location: string;
    capacity: number;
    current_count: number;
    status: string;
    type: string;
    car_ids?: string[];
    timestamp: number;
    created_at?: number;
}

export class BufferStateRepository extends BaseRepository<IBufferState> {
    protected tableName = 'buffer_states';
    protected idColumn = 'id';
    protected timestampColumn = 'timestamp';

    protected allowedFilterColumns(): readonly string[] {
        return [
            'id',
            'session_id',
            'buffer_id',
            'from_location',
            'to_location',
            'capacity',
            'current_count',
            'status',
            'type',
            'car_ids',
            'timestamp',
            'created_at'
        ] as const;
    }

    protected override normalize(state: IBufferState): IBufferState {
        if (state && typeof state.car_ids === 'string') {
            try {
                state.car_ids = JSON.parse(state.car_ids);
            } catch {
                // keep as-is
            }
        }
        return state;
    }

    public async create(entity: Partial<IBufferState>): Promise<IBufferState> {
        const db = await this.getDb();

        const sql = `
            INSERT INTO ${this.tableName}
            (session_id, buffer_id, from_location, to_location, capacity, current_count, status, type, car_ids, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ${this.getReturningClause(db)}
        `;

        const carIdsJson = entity.car_ids ? JSON.stringify(entity.car_ids) : null;
        const params = [
            entity.session_id ?? null,
            entity.buffer_id,
            entity.from_location,
            entity.to_location,
            entity.capacity,
            entity.current_count,
            entity.status,
            entity.type,
            carIdsJson,
            entity.timestamp
        ];

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);

        if (result.rows.length > 0) {
            return this.normalize(result.rows[0]);
        }

        const lastId = await db.query<{ id: number }>('SELECT last_insert_rowid() as id');
        return this.normalize({ ...(entity as any), id: lastId.rows[0]?.id } as IBufferState);
    }

    public async update(id: string | number, entity: Partial<IBufferState>): Promise<IBufferState | null> {
        const db = await this.getDb();

        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (entity.current_count !== undefined) {
            updates.push(`current_count = $${paramIndex++}`);
            params.push(entity.current_count);
        }
        if (entity.status !== undefined) {
            updates.push(`status = $${paramIndex++}`);
            params.push(entity.status);
        }
        if (entity.car_ids !== undefined) {
            updates.push(`car_ids = $${paramIndex++}`);
            params.push(JSON.stringify(entity.car_ids));
        }

        if (updates.length === 0) return this.findById(id);

        params.push(id);
        const returningClause = this.getReturningClause(db);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex}${returningClause}`;

        // PostgreSQL returns updated row directly, SQLite needs separate query
        if (db.getDialect() === 'postgres') {
            const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
            return result.rows[0] ? this.normalize(result.rows[0]) : null;
        }

        await db.execute(this.convertPlaceholders(db, sql), params);
        const updated = await this.findById(id);
        return updated ? this.normalize(updated) : null;
    }

    public async findByBufferId(bufferId: string, limit?: number): Promise<IBufferState[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE buffer_id = $1 ORDER BY timestamp DESC`;
        const params: any[] = [bufferId];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findLatestByBufferId(bufferId: string): Promise<IBufferState | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE buffer_id = $1 ORDER BY timestamp DESC LIMIT 1`;

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), [bufferId]);
        return result.rows[0] ? this.normalize(result.rows[0]) : null;
    }

    public async findByStatus(status: string, limit?: number): Promise<IBufferState[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE status = $1 ORDER BY timestamp DESC`;
        const params: any[] = [status];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findLatestPerBuffer(limit?: number): Promise<IBufferState[]> {
        const db = await this.getDb();

        let sql = `
            SELECT b.*
            FROM ${this.tableName} b
            JOIN (
                SELECT buffer_id, MAX(timestamp) AS max_ts
                FROM ${this.tableName}
                GROUP BY buffer_id
            ) m
              ON b.buffer_id = m.buffer_id AND b.timestamp = m.max_ts
            ORDER BY b.timestamp DESC
        `;

        const params: any[] = [];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $1`;
            params.push(safeLimit);
        }

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findBySessionId(sessionId: string, limit?: number): Promise<IBufferState[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE session_id = $1 ORDER BY timestamp DESC`;
        const params: any[] = [sessionId];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findLatestPerBufferBySession(sessionId: string, limit?: number): Promise<IBufferState[]> {
        const db = await this.getDb();

        let sql = `
            SELECT b.*
            FROM ${this.tableName} b
            JOIN (
                SELECT buffer_id, MAX(timestamp) AS max_ts
                FROM ${this.tableName}
                WHERE session_id = $1
                GROUP BY buffer_id
            ) m
              ON b.buffer_id = m.buffer_id AND b.timestamp = m.max_ts AND b.session_id = $1
            ORDER BY b.timestamp DESC
        `;

        const params: any[] = [sessionId];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IBufferState>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }
}
