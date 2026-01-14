// src/adapters/database/repositories/BaseRepository.ts

import { IDatabase, IRepository, QueryResult } from '../IDatabase';
import { DatabaseFactory } from '../DatabaseFactory';
import { PaginationParams, PaginatedResult, QueryOptions, TimeRangeResult } from '../../../utils/shared';

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

    public async findByTimeRange(startTime: number, endTime: number, limit: number = 10000): Promise<TimeRangeResult<T>> {
        const db = await this.getDb();
        const safeLimit = Math.min(Math.max(limit, 1), 10000);

        // Query with limit + 1 to detect truncation
        const sql = `SELECT * FROM ${this.tableName} WHERE ${this.timestampColumn} >= $1 AND ${this.timestampColumn} <= $2 ORDER BY ${this.timestampColumn} DESC LIMIT $3`;

        const result = await db.query<T>(this.convertPlaceholders(db, sql), [startTime, endTime, safeLimit + 1]);
        const truncated = result.rows.length > safeLimit;
        const data = truncated ? result.rows.slice(0, safeLimit) : result.rows;

        return {
            data: data.map(r => this.normalize(r)),
            truncated
        };
    }

    /**
     * Paginated find with filters
     * @param pagination - page (1-based) and limit (max 100)
     * @param filters - optional filter key-value pairs
     * @returns Paginated result with metadata
     */
    public async findAllPaginated(
        pagination: PaginationParams,
        filters?: Record<string, any>
    ): Promise<PaginatedResult<T>> {
        const db = await this.getDb();

        // Sanitize pagination params
        const page = Math.max(1, pagination.page || 1);
        const limit = Math.min(Math.max(1, pagination.limit || 50), 100);
        const offset = (page - 1) * limit;

        let whereClause = '';
        const params: any[] = [];
        let paramIndex = 1;

        if (filters && Object.keys(filters).length > 0) {
            const whereClauses: string[] = [];
            const allowed = new Set(this.allowedFilterColumns());

            for (const [key, value] of Object.entries(filters)) {
                if (value !== undefined && value !== null && allowed.has(key)) {
                    whereClauses.push(`${key} = $${paramIndex}`);
                    params.push(value);
                    paramIndex++;
                }
            }

            if (whereClauses.length > 0) {
                whereClause = ` WHERE ${whereClauses.join(' AND ')}`;
            }
        }

        // Count total records
        const countSql = `SELECT COUNT(*) as count FROM ${this.tableName}${whereClause}`;
        const countResult = await db.query<{ count: number }>(this.convertPlaceholders(db, countSql), params);
        const total = Number(countResult.rows[0]?.count || 0);

        // Fetch paginated data
        const dataSql = `SELECT * FROM ${this.tableName}${whereClause} ORDER BY ${this.timestampColumn} DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const dataParams = [...params, limit, offset];
        const dataResult = await db.query<T>(this.convertPlaceholders(db, dataSql), dataParams);

        const totalPages = Math.ceil(total / limit);

        return {
            data: dataResult.rows.map(r => this.normalize(r)),
            total,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        };
    }

    /**
     * Find with custom options (column projection, custom limit/offset)
     */
    public async findWithOptions(
        filters?: Record<string, any>,
        options?: QueryOptions
    ): Promise<T[]> {
        const db = await this.getDb();

        const columns = options?.columns?.length ? options.columns.join(', ') : '*';
        const orderBy = options?.orderBy || this.timestampColumn;
        const orderDir = options?.orderDir || 'DESC';
        const limit = options?.limit ? Math.min(options.limit, 10000) : 1000;
        const offset = options?.offset || 0;

        let sql = `SELECT ${columns} FROM ${this.tableName}`;
        const params: any[] = [];
        let paramIndex = 1;

        if (filters && Object.keys(filters).length > 0) {
            const whereClauses: string[] = [];
            const allowed = new Set(this.allowedFilterColumns());

            for (const [key, value] of Object.entries(filters)) {
                if (value !== undefined && value !== null && allowed.has(key)) {
                    whereClauses.push(`${key} = $${paramIndex}`);
                    params.push(value);
                    paramIndex++;
                }
            }

            if (whereClauses.length > 0) {
                sql += ` WHERE ${whereClauses.join(' AND ')}`;
            }
        }

        sql += ` ORDER BY ${orderBy} ${orderDir} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await db.query<T>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public abstract create(entity: Partial<T>): Promise<T>;
    public abstract update(id: string | number, entity: Partial<T>): Promise<T | null>;

    /**
     * Batch insert multiple entities in a single transaction
     * Override in subclasses for optimized batch inserts
     * Default implementation uses individual creates within a transaction
     */
    public async createBatch(entities: Partial<T>[]): Promise<T[]> {
        if (entities.length === 0) return [];

        const db = await this.getDb();

        return db.transaction(async () => {
            const results: T[] = [];
            for (const entity of entities) {
                const created = await this.create(entity);
                results.push(created);
            }
            return results;
        });
    }

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
