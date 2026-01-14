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
        const returningClause = this.getReturningClause(db);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex}${returningClause}`;

        // PostgreSQL returns updated row directly, SQLite needs separate query
        if (db.getDialect() === 'postgres') {
            const result = await db.query<ICarEvent>(this.convertPlaceholders(db, sql), params);
            return result.rows[0] ? this.normalize(result.rows[0]) : null;
        }

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

    /**
     * Optimized batch insert - uses multi-row INSERT for better performance
     * Significantly faster than individual inserts for large batches
     */
    public override async createBatch(entities: Partial<ICarEvent>[]): Promise<ICarEvent[]> {
        if (entities.length === 0) return [];

        const db = await this.getDb();

        return db.transaction(async () => {
            const results: ICarEvent[] = [];
            const batchSize = 100;

            for (let i = 0; i < entities.length; i += batchSize) {
                const batch = entities.slice(i, i + batchSize);

                if (db.getDialect() === 'postgres') {
                    // PostgreSQL: Use multi-row VALUES clause
                    const valuesClauses: string[] = [];
                    const params: any[] = [];
                    let paramIndex = 1;

                    for (const entity of batch) {
                        valuesClauses.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
                        params.push(
                            entity.car_id,
                            entity.event_type,
                            entity.shop,
                            entity.line,
                            entity.station,
                            entity.timestamp,
                            entity.data ? JSON.stringify(entity.data) : null
                        );
                    }

                    const sql = `
                        INSERT INTO ${this.tableName}
                        (car_id, event_type, shop, line, station, timestamp, data)
                        VALUES ${valuesClauses.join(', ')}
                        RETURNING *
                    `;

                    const result = await db.query<ICarEvent>(sql, params);
                    results.push(...result.rows.map(r => this.normalize(r)));
                } else {
                    // SQLite: Use individual inserts within transaction (still fast due to transaction)
                    for (const entity of batch) {
                        const created = await this.create(entity);
                        results.push(created);
                    }
                }
            }

            return results;
        });
    }
}
