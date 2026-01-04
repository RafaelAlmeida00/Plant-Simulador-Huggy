// src/adapters/database/repositories/MTTRMTBFRepository.ts

import { BaseRepository } from './BaseRepository';

export interface IMTTRMTBF {
    id?: number;
    date: string;
    shop: string;
    line: string;
    station: string;
    mttr: number;
    mtbf: number;
    created_at?: number;
}

export class MTTRMTBFRepository extends BaseRepository<IMTTRMTBF> {
    protected tableName = 'mttr_mtbf';
    protected idColumn = 'id';
    protected timestampColumn = 'created_at';

    protected allowedFilterColumns(): readonly string[] {
        return ['id', 'date', 'shop', 'line', 'station', 'mttr', 'mtbf', 'created_at'] as const;
    }

    public async create(entity: Partial<IMTTRMTBF>): Promise<IMTTRMTBF> {
        const db = await this.getDb();
        
        const sql = `
            INSERT INTO ${this.tableName} 
            (date, shop, line, station, mttr, mtbf)
            VALUES ($1, $2, $3, $4, $5, $6)
            ${this.getReturningClause(db)}
        `;
        
        const params = [
            entity.date,
            entity.shop,
            entity.line,
            entity.station,
            entity.mttr,
            entity.mtbf
        ];

        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), params);
        
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        
        const lastId = await db.query<{ id: number }>('SELECT last_insert_rowid() as id');
        return { ...entity, id: lastId.rows[0]?.id } as IMTTRMTBF;
    }

    public async update(id: string | number, entity: Partial<IMTTRMTBF>): Promise<IMTTRMTBF | null> {
        const db = await this.getDb();
        
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        const fields = ['date', 'shop', 'line', 'station', 'mttr', 'mtbf'];
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

    public async findByDate(date: string): Promise<IMTTRMTBF[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE date = $1 ORDER BY shop, line, station`;
        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), [date]);
        return result.rows;
    }

    public async findByShop(shop: string): Promise<IMTTRMTBF[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 ORDER BY date DESC, line, station`;
        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), [shop]);
        return result.rows;
    }

    public async findByDateAndShop(date: string, shop: string): Promise<IMTTRMTBF[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE date = $1 AND shop = $2 ORDER BY line, station`;
        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), [date, shop]);
        return result.rows;
    }

    public async findByLine(shop: string, line: string): Promise<IMTTRMTBF[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 AND line = $2 ORDER BY date DESC, station`;
        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), [shop, line]);
        return result.rows;
    }

    public async findByStation(shop: string, line: string, station: string): Promise<IMTTRMTBF[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE shop = $1 AND line = $2 AND station = $3 ORDER BY date DESC`;
        const result = await db.query<IMTTRMTBF>(this.convertPlaceholders(db, sql), [shop, line, station]);
        return result.rows;
    }
}
