// src/adapters/database/repositories/PlantSnapshotRepository.ts

import { BaseRepository } from './BaseRepository';
import { PlantSnapshot } from '../../../domain/services/PlantQueryService';

export interface IPlantSnapshotRecord {
    id?: number;
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
            (timestamp, total_stations, total_occupied, total_free, total_stopped, snapshot_data)
            VALUES ($1, $2, $3, $4, $5, $6)
            ${this.getReturningClause(db)}
        `;
        
        const snapshotJson = typeof entity.snapshot_data === 'string' 
            ? entity.snapshot_data 
            : JSON.stringify(entity.snapshot_data);
            
        const params = [
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
}
