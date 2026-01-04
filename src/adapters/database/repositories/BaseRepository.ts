// src/adapters/database/repositories/BaseRepository.ts

import { IDatabase, IRepository, QueryResult } from '../IDatabase';
import { DatabaseFactory } from '../DatabaseFactory';

export abstract class BaseRepository<T> implements IRepository<T> {
    protected abstract tableName: string;
    protected abstract idColumn: string;
    protected abstract timestampColumn: string;

    protected normalize(entity: T): T {
        return entity;
    }

    protected allowedFilterColumns(): readonly string[] {
        return [];
    }

    protected async getDb(): Promise<IDatabase> {
        return DatabaseFactory.getDatabase();
    }

    public async findAll(filters?: Record<string, any>): Promise<T[]> {
        const db = await this.getDb();
        
        let sql = `SELECT * FROM ${this.tableName}`;
        const params: any[] = [];
        
        if (filters && Object.keys(filters).length > 0) {
            const whereClauses: string[] = [];
            let paramIndex = 1;

            const allowed = new Set(this.allowedFilterColumns());
            
            for (const [key, value] of Object.entries(filters)) {
                if (value !== undefined && value !== null) {
                    if (!allowed.has(key)) {
                        continue;
                    }
                    whereClauses.push(`${key} = $${paramIndex}`);
                    params.push(value);
                    paramIndex++;
                }
            }
            
            if (whereClauses.length > 0) {
                sql += ` WHERE ${whereClauses.join(' AND ')}`;
            }
        }
        
        sql += ` ORDER BY ${this.timestampColumn} DESC`;

        const result = await db.query<T>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findById(id: string | number): Promise<T | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE ${this.idColumn} = $1`;

        const result = await db.query<T>(this.convertPlaceholders(db, sql), [id]);
        const row = result.rows[0] || null;
        return row ? this.normalize(row) : null;
    }

    public async findByTimeRange(startTime: number, endTime: number): Promise<T[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE ${this.timestampColumn} >= $1 AND ${this.timestampColumn} <= $2 ORDER BY ${this.timestampColumn} DESC`;

        const result = await db.query<T>(this.convertPlaceholders(db, sql), [startTime, endTime]);
        return result.rows.map(r => this.normalize(r));
    }

    public abstract create(entity: Partial<T>): Promise<T>;
    public abstract update(id: string | number, entity: Partial<T>): Promise<T | null>;

    public async delete(id: string | number): Promise<boolean> {
        const db = await this.getDb();
        const sql = `DELETE FROM ${this.tableName} WHERE ${this.idColumn} = $1`;

        const changes = await db.execute(this.convertPlaceholders(db, sql), [id]);
        return changes > 0;
    }

    protected convertPlaceholders(db: IDatabase, sql: string): string {
        // SQLite usa ? enquanto Postgres usa $1, $2...
        return db.getDialect() === 'sqlite' ? sql.replace(/\$\d+/g, '?') : sql;
    }

    protected getReturningClause(db: IDatabase): string {
        return db.getDialect() === 'sqlite' ? '' : ' RETURNING *';
    }
}
