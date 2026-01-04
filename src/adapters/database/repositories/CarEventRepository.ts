// src/adapters/database/repositories/CarEventRepository.ts

import { BaseRepository } from './BaseRepository';

export interface ICarEvent {
    id?: number;
    car_id: string;
    event_type: string;
    shop: string;
    line: string;
    station: string;
    timestamp: number;
    data?: any;
    created_at?: number;
}

export class CarEventRepository extends BaseRepository<ICarEvent> {
    protected tableName = 'car_events';
    protected idColumn = 'id';
    protected timestampColumn = 'timestamp';

    protected allowedFilterColumns(): readonly string[] {
        return ['id', 'car_id', 'event_type', 'shop', 'line', 'station', 'timestamp', 'created_at'] as const;
    }

    protected override normalize(event: ICarEvent): ICarEvent {
        if (event && typeof event.data === 'string') {
            try {
                event.data = JSON.parse(event.data);
            } catch {
                // keep as-is
            }
        }
        return event;
    }

    public async create(entity: Partial<ICarEvent>): Promise<ICarEvent> {
        const db = await this.getDb();
        
        const sql = `
            INSERT INTO ${this.tableName} 
            (car_id, event_type, shop, line, station, timestamp, data)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ${this.getReturningClause(db)}
        `;
        
        const dataJson = entity.data ? JSON.stringify(entity.data) : null;
        const params = [
            entity.car_id,
            entity.event_type,
            entity.shop,
            entity.line,
            entity.station,
            entity.timestamp,
            dataJson
        ];

        const result = await db.query<ICarEvent>(this.convertPlaceholders(db, sql), params);
        
        if (result.rows.length > 0) {
            return this.normalize(result.rows[0]);
        }
        
        // Para SQLite que não suporta RETURNING
        const lastId = await db.query<{ id: number }>(
            'SELECT last_insert_rowid() as id'
        );
        return this.normalize({ ...(entity as any), id: lastId.rows[0]?.id } as ICarEvent);
    }

    public async update(id: string | number, entity: Partial<ICarEvent>): Promise<ICarEvent | null> {
        const db = await this.getDb();
        
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (entity.event_type !== undefined) {
            updates.push(`event_type = $${paramIndex++}`);
            params.push(entity.event_type);
        }
        if (entity.data !== undefined) {
            updates.push(`data = $${paramIndex++}`);
            params.push(JSON.stringify(entity.data));
        }

        if (updates.length === 0) return this.findById(id);

        params.push(id);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex} ${this.getReturningClause(db)}`;

        await db.execute(this.convertPlaceholders(db, sql), params);
        const updated = await this.findById(id);
        return updated ? this.normalize(updated) : null;
    }

    public async findByCarId(carId: string): Promise<ICarEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE car_id = $1 ORDER BY timestamp DESC`;

        const result = await db.query<ICarEvent>(this.convertPlaceholders(db, sql), [carId]);
        return result.rows.map(r => this.normalize(r));
    }

    public async findByShop(shop: string): Promise<ICarEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 ORDER BY timestamp DESC`;

        const result = await db.query<ICarEvent>(this.convertPlaceholders(db, sql), [shop]);
        return result.rows.map(r => this.normalize(r));
    }

    public async findByLine(shop: string, line: string): Promise<ICarEvent[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 AND line = $2 ORDER BY timestamp DESC`;

        const result = await db.query<ICarEvent>(this.convertPlaceholders(db, sql), [shop, line]);
        return result.rows.map(r => this.normalize(r));
    }
}
