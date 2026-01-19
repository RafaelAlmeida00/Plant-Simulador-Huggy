// src/adapters/database/repositories/OEERepository.ts

import { BaseRepository } from './BaseRepository';

export interface IOEE {
    id?: number;
    session_id?: string;
    date: string;
    shop: string;
    line: string;
    production_time: number;
    cars_production: number;
    takt_time: number;
    diff_time: number;
    oee: number;
    created_at?: number;
}

export class OEERepository extends BaseRepository<IOEE> {
    protected tableName = 'oee';
    protected idColumn = 'id';
    protected timestampColumn = 'created_at';

    protected allowedFilterColumns(): readonly string[] {
        return ['id', 'session_id', 'date', 'shop', 'line', 'production_time', 'cars_production', 'takt_time', 'diff_time', 'oee', 'created_at'] as const;
    }

    public async create(entity: Partial<IOEE>): Promise<IOEE> {
        const db = await this.getDb();

        const sql = `
            INSERT INTO ${this.tableName}
            (session_id, date, shop, line, production_time, cars_production, takt_time, diff_time, oee)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ${this.getReturningClause(db)}
        `;

        const params = [
            entity.session_id ?? null,
            entity.date,
            entity.shop,
            entity.line,
            entity.production_time,
            entity.cars_production,
            entity.takt_time,
            entity.diff_time,
            entity.oee
        ];

        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
        
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        
        const lastId = await db.query<{ id: number }>('SELECT last_insert_rowid() as id');
        return { ...entity, id: lastId.rows[0]?.id } as IOEE;
    }

    public async update(id: string | number, entity: Partial<IOEE>): Promise<IOEE | null> {
        const db = await this.getDb();

        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        const fields = ['date', 'shop', 'line', 'production_time', 'cars_production', 'takt_time', 'diff_time', 'oee'];
        for (const field of fields) {
            if ((entity as any)[field] !== undefined) {
                updates.push(`${field} = $${paramIndex++}`);
                params.push((entity as any)[field]);
            }
        }

        if (updates.length === 0) return this.findById(id);

        params.push(id);
        const returningClause = this.getReturningClause(db);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex}${returningClause}`;

        // PostgreSQL returns updated row directly, SQLite needs separate query
        if (db.getDialect() === 'postgres') {
            const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
            return result.rows[0] || null;
        }

        await db.execute(this.convertPlaceholders(db, sql), params);
        return this.findById(id);
    }

    public async findByDate(date: string, limit?: number): Promise<IOEE[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE date = $1 ORDER BY shop, line`;
        const params: any[] = [date];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
        return result.rows;
    }

    public async findByShop(shop: string, limit?: number): Promise<IOEE[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 ORDER BY date DESC, line`;
        const params: any[] = [shop];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
        return result.rows;
    }

    public async findByDateAndShop(date: string, shop: string, limit?: number): Promise<IOEE[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE date = $1 AND shop = $2 ORDER BY line`;
        const params: any[] = [date, shop];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $3`;
            params.push(safeLimit);
        }

        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
        return result.rows;
    }

    public async findByDateShopLine(date: string, shop: string, line: string): Promise<IOEE | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE date = $1 AND shop = $2 AND line = $3`;
        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), [date, shop, line]);
        return result.rows[0] || null;
    }

    public async findBySessionId(sessionId: string, limit?: number): Promise<IOEE[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE session_id = $1 ORDER BY date DESC, shop, line`;
        const params: any[] = [sessionId];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IOEE>(this.convertPlaceholders(db, sql), params);
        return result.rows;
    }
}
