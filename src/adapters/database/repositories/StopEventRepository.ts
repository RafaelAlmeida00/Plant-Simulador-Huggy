// src/adapters/database/repositories/StopEventRepository.ts

import { BaseRepository } from './BaseRepository';

export interface IStopEvent {
    id?: number;
    stop_id: string;
    shop: string;
    line: string;
    station: string;
    reason?: string;
    severity?: string;
    type?: string;
    category?: string;
    start_time: number;
    end_time?: number;
    status: string;
    duration_ms?: number;
    created_at?: number;
}

export class StopEventRepository extends BaseRepository<IStopEvent> {
    protected tableName = 'stop_events';
    protected idColumn = 'id';
    protected timestampColumn = 'start_time';

    protected allowedFilterColumns(): readonly string[] {
        return [
            'id',
            'stop_id',
            'shop',
            'line',
            'station',
            'reason',
            'severity',
            'type',
            'category',
            'start_time',
            'end_time',
            'status',
            'duration_ms',
            'created_at'
        ] as const;
    }

    public async create(entity: Partial<IStopEvent>): Promise<IStopEvent> {
        const db = await this.getDb();
        
        const sql = `
            INSERT INTO ${this.tableName} 
            (stop_id, shop, line, station, reason, severity, type, category, start_time, end_time, status, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ${this.getReturningClause(db)}
        `;
        
        const params = [
            entity.stop_id,
            entity.shop,
            entity.line,
            entity.station,
            entity.reason,
            entity.severity,
            entity.type,
            entity.category,
            entity.start_time,
            entity.end_time,
            entity.status,
            entity.duration_ms
        ];

        const result = await db.query<IStopEvent>(this.convertPlaceholders(db, sql), params);
        
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        
        const lastId = await db.query<{ id: number }>('SELECT last_insert_rowid() as id');
        return { ...entity, id: lastId.rows[0]?.id } as IStopEvent;
    }

    public async update(id: string | number, entity: Partial<IStopEvent>): Promise<IStopEvent | null> {
        const db = await this.getDb();
        
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        const fields = ['status', 'end_time', 'duration_ms', 'reason', 'severity'];
        for (const field of fields) {
            if ((entity as any)[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                params.push((entity as any)[field]);
            }
        }

        if (updates.length === 0) return this.findById(id);

        params.push(id);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex} ${this.getReturningClause(db)}`;

        await db.execute(this.convertPlaceholders(db, sql), params);
        return this.findById(id);
    }

    public async findByStopId(stopId: string): Promise<IStopEvent | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE stop_id = $1 ORDER BY start_time DESC LIMIT 1`;

        const result = await db.query<IStopEvent>(this.convertPlaceholders(db, sql), [stopId]);
        return result.rows[0] || null;
    }

    public async findActiveStops(): Promise<IStopEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE status = $1 ORDER BY start_time DESC`;

        const result = await db.query<IStopEvent>(this.convertPlaceholders(db, sql), ['IN_PROGRESS']);
        return result.rows;
    }

    public async findByShop(shop: string): Promise<IStopEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 ORDER BY start_time DESC`;

        const result = await db.query<IStopEvent>(this.convertPlaceholders(db, sql), [shop]);
        return result.rows;
    }

    public async findBySeverity(severity: string): Promise<IStopEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE severity = $1 ORDER BY start_time DESC`;

        const result = await db.query<IStopEvent>(this.convertPlaceholders(db, sql), [severity]);
        return result.rows;
    }
}
