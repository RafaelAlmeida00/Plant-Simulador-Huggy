// src/adapters/database/PostgresDatabase.ts

import { Pool, PoolClient } from 'pg';
import { IDatabase, QueryResult } from './IDatabase';
import { IDatabaseConfig } from './DatabaseConfig';

export class PostgresDatabase implements IDatabase {
    private pool: Pool | null = null;
    private config: IDatabaseConfig;
    private connected: boolean = false;

    constructor(config: IDatabaseConfig) {
        this.config = config;
    }

    public async connect(): Promise<void> {
        if (this.connected && this.pool) return;

        const poolConfig = this.config.connectionString
            ? { connectionString: this.config.connectionString, ssl: { rejectUnauthorized: false } }
            : {
                host: this.config.host,
                port: this.config.port,
                database: this.config.database,
                user: this.config.user,
                password: this.config.password,
                ssl: this.config.ssl ? { rejectUnauthorized: false } : false
            };

        this.pool = new Pool(poolConfig);
        this.connected = true;

        await this.initializeTables();
    }

    public async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.connected = false;
        }
    }

    public async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
        if (!this.pool) throw new Error('Database not connected');

        const result = await this.pool.query(sql, params);
        return {
            rows: result.rows as T[],
            rowCount: result.rowCount || 0
        };
    }

    public async execute(sql: string, params: any[] = []): Promise<number> {
        if (!this.pool) throw new Error('Database not connected');

        const result = await this.pool.query(sql, params);
        return result.rowCount || 0;
    }

    public async transaction<T>(callback: (db: IDatabase) => Promise<T>): Promise<T> {
        if (!this.pool) throw new Error('Database not connected');

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const transactionalDb: IDatabase = {
                connect: async () => {},
                disconnect: async () => {},
                isConnected: () => true,
                getDialect: () => 'postgres',
                query: async <T = any>(sql: string, params: any[] = []) => {
                    const result = await client.query(sql, params);
                    return { rows: result.rows as T[], rowCount: result.rowCount || 0 };
                },
                execute: async (sql: string, params: any[] = []) => {
                    const result = await client.query(sql, params);
                    return result.rowCount || 0;
                },
                transaction: async <T = any>(_cb: (db: IDatabase) => Promise<T>) => {
                    throw new Error('Nested transactions are not supported');
                }
            };

            const result = await callback(transactionalDb);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public getDialect(): 'sqlite' | 'postgres' {
        return 'postgres';
    }

    private async initializeTables(): Promise<void> {
        if (!this.pool) return;

        // Tabela de eventos (movimentações de carros)
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS car_events (
                id SERIAL PRIMARY KEY,
                car_id VARCHAR(50) NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                shop VARCHAR(100) NOT NULL,
                line VARCHAR(100) NOT NULL,
                station VARCHAR(100) NOT NULL,
                timestamp BIGINT NOT NULL,
                data JSONB,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de paradas
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS stop_events (
                id SERIAL PRIMARY KEY,
                stop_id VARCHAR(50) NOT NULL,
                shop VARCHAR(100) NOT NULL,
                line VARCHAR(100) NOT NULL,
                station VARCHAR(100) NOT NULL,
                reason TEXT,
                severity VARCHAR(20),
                type VARCHAR(50),
                category VARCHAR(50),
                start_time BIGINT NOT NULL,
                end_time BIGINT,
                status VARCHAR(20) NOT NULL,
                duration_ms BIGINT,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de estado dos buffers
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS buffer_states (
                id SERIAL PRIMARY KEY,
                buffer_id VARCHAR(100) NOT NULL,
                from_location VARCHAR(100) NOT NULL,
                to_location VARCHAR(100) NOT NULL,
                capacity INTEGER NOT NULL,
                current_count INTEGER NOT NULL,
                status VARCHAR(20) NOT NULL,
                type VARCHAR(50) NOT NULL,
                car_ids JSONB,
                timestamp BIGINT NOT NULL,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de snapshots da planta
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS plant_snapshots (
                id SERIAL PRIMARY KEY,
                timestamp BIGINT NOT NULL,
                total_stations INTEGER NOT NULL,
                total_occupied INTEGER NOT NULL,
                total_free INTEGER NOT NULL,
                total_stopped INTEGER NOT NULL,
                snapshot_data JSONB NOT NULL,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de OEE
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS oee (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                shop VARCHAR(100) NOT NULL,
                line VARCHAR(100) NOT NULL,
                production_time DECIMAL(10,2) NOT NULL,
                cars_production INTEGER NOT NULL,
                takt_time DECIMAL(10,2) NOT NULL,
                diff_time DECIMAL(10,2) NOT NULL,
                oee DECIMAL(10,2) NOT NULL,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de MTTR/MTBF
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS mttr_mtbf (
                id SERIAL PRIMARY KEY,
                date VARCHAR(20) NOT NULL,
                shop VARCHAR(100) NOT NULL,
                line VARCHAR(100) NOT NULL,
                station VARCHAR(100) NOT NULL,
                mttr DECIMAL(10,2) NOT NULL,
                mtbf DECIMAL(10,2) NOT NULL,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Tabela de configuração da planta
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS config_plant (
                id VARCHAR(100) PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                config TEXT NOT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
            )
        `);

        // Índices
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_car_events_timestamp ON car_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_car_events_car_id ON car_events(car_id);
            CREATE INDEX IF NOT EXISTS idx_stop_events_timestamp ON stop_events(start_time);
            CREATE INDEX IF NOT EXISTS idx_buffer_states_timestamp ON buffer_states(timestamp);
            CREATE INDEX IF NOT EXISTS idx_plant_snapshots_timestamp ON plant_snapshots(timestamp);
            CREATE INDEX IF NOT EXISTS idx_oee_date ON oee(date);
            CREATE INDEX IF NOT EXISTS idx_oee_shop ON oee(shop);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_date ON mttr_mtbf(date);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_shop ON mttr_mtbf(shop);
            CREATE INDEX IF NOT EXISTS idx_config_plant_name ON config_plant(name);
            CREATE INDEX IF NOT EXISTS idx_config_plant_default ON config_plant(is_default);
        `);
    }
}
