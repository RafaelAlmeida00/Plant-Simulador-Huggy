// src/adapters/database/repositories/PlantSnapshotRepository.ts

import { PlantSnapshot } from '../../../utils/shared';
import { BaseRepository } from './BaseRepository';

export interface IPlantSnapshotRecord {
    id?: number;
    session_id?: string;
    timestamp: number;
    total_stations: number;
    total_occupied: number;
    total_free: number;
    total_stopped: number;
    snapshot_data: string | PlantSnapshot;
    created_at?: number;
}

export class PlantSnapshotRepository extends BaseRepository<IPlantSnapshotRecord> {
    protected tableName = 'plant_snapshots';
    protected idColumn = 'id';
    protected timestampColumn = 'timestamp';

    protected allowedFilterColumns(): readonly string[] {
        return [
            'id',
            'session_id',
            'timestamp',
            'total_stations',
            'total_occupied',
            'total_free',
            'total_stopped',
            'snapshot_data',
            'created_at'
        ] as const;
    }

    protected override normalize(record: IPlantSnapshotRecord): IPlantSnapshotRecord {
        if (record && typeof record.snapshot_data === 'string') {
            try {
                record.snapshot_data = JSON.parse(record.snapshot_data);
            } catch {
                // keep as-is
            }
        }
        return record;
    }

    public async create(entity: Partial<IPlantSnapshotRecord>): Promise<IPlantSnapshotRecord> {
        const db = await this.getDb();

        const sql = `
            INSERT INTO ${this.tableName}
            (session_id, timestamp, total_stations, total_occupied, total_free, total_stopped, snapshot_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ${this.getReturningClause(db)}
        `;

        const snapshotJson = typeof entity.snapshot_data === 'string'
            ? entity.snapshot_data
            : JSON.stringify(entity.snapshot_data);

        const params = [
            entity.session_id ?? null,
            entity.timestamp,
            entity.total_stations,
            entity.total_occupied,
            entity.total_free,
            entity.total_stopped,
            snapshotJson
        ];

        const result = await db.query<IPlantSnapshotRecord>(this.convertPlaceholders(db, sql), params);

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        const lastId = await db.query<{ id: number }>('SELECT last_insert_rowid() as id');
        return { ...entity, id: lastId.rows[0]?.id } as IPlantSnapshotRecord;
    }

    public async update(id: string | number, entity: Partial<IPlantSnapshotRecord>): Promise<IPlantSnapshotRecord | null> {
        const db = await this.getDb();
        
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (entity.snapshot_data !== undefined) {
            updates.push(`snapshot_data = $${paramIndex++}`);
            params.push(typeof entity.snapshot_data === 'string' 
                ? entity.snapshot_data 
                : JSON.stringify(entity.snapshot_data));
        }

        if (updates.length === 0) return this.findById(id);

        params.push(id);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = $${paramIndex} ${this.getReturningClause(db)}`;

        await db.execute(this.convertPlaceholders(db, sql), params);
        return this.findById(id);
    }

    public async findLatest(): Promise<IPlantSnapshotRecord | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} ORDER BY timestamp DESC LIMIT 1`;

        const result = await db.query<IPlantSnapshotRecord>(sql);
        if (result.rows.length > 0) {
            return this.normalize(result.rows[0]);
        }
        return null;
    }

    public async findBySessionId(sessionId: string, limit?: number): Promise<IPlantSnapshotRecord[]> {
        const db = await this.getDb();
        let sql = `SELECT * FROM ${this.tableName} WHERE session_id = $1 ORDER BY timestamp DESC`;
        const params: any[] = [sessionId];

        if (limit !== undefined && limit > 0) {
            const safeLimit = Math.min(limit, 10000);
            sql += ` LIMIT $2`;
            params.push(safeLimit);
        }

        const result = await db.query<IPlantSnapshotRecord>(this.convertPlaceholders(db, sql), params);
        return result.rows.map(r => this.normalize(r));
    }

    public async findLatestBySessionId(sessionId: string): Promise<IPlantSnapshotRecord | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE session_id = $1 ORDER BY timestamp DESC LIMIT 1`;

        const result = await db.query<IPlantSnapshotRecord>(this.convertPlaceholders(db, sql), [sessionId]);
        if (result.rows.length > 0) {
            return this.normalize(result.rows[0]);
        }
        return null;
    }
}
