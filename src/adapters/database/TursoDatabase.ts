// src/adapters/database/TursoDatabase.ts

import { createClient, Client } from '@libsql/client';
import { IDatabase, QueryResult } from './IDatabase';
import { IDatabaseConfig } from './DatabaseConfig';

export class TursoDatabase implements IDatabase {
    private client: Client | null = null;
    private config: IDatabaseConfig;
    private connected: boolean = false;

    constructor(config: IDatabaseConfig) {
        this.config = config;
    }

    public async connect(): Promise<void> {
        if (this.connected && this.client) return;

        this.client = createClient({
            url: this.config.connectionString || '',
            authToken: this.config.authToken
        });

        this.connected = true;
        await this.initializeTables();
    }

    public async disconnect(): Promise<void> {
        if (this.client) {
            this.client.close();
            this.client = null;
            this.connected = false;
        }
    }

    public async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
        if (!this.client) throw new Error('Database not connected');

        const result = await this.client.execute({ sql, args: params });
        return {
            rows: result.rows as unknown as T[],
            rowCount: result.rows.length
        };
    }

    public async execute(sql: string, params: any[] = []): Promise<number> {
        if (!this.client) throw new Error('Database not connected');

        const result = await this.client.execute({ sql, args: params });
        return result.rowsAffected;
    }

    public async transaction<T>(callback: (db: IDatabase) => Promise<T>): Promise<T> {
        if (!this.client) throw new Error('Database not connected');

        const tx = await this.client.transaction('write');
        try {
            const transactionalDb: IDatabase = {
                connect: async () => {},
                disconnect: async () => {},
                isConnected: () => true,
                getDialect: () => 'sqlite',
                query: async <T = any>(sql: string, params: any[] = []) => {
                    const result = await tx.execute({ sql, args: params });
                    return { rows: result.rows as unknown as T[], rowCount: result.rows.length };
                },
                execute: async (sql: string, params: any[] = []) => {
                    const result = await tx.execute({ sql, args: params });
                    return result.rowsAffected;
                },
                transaction: async <T = any>(_cb: (db: IDatabase) => Promise<T>) => {
                    throw new Error('Nested transactions are not supported');
                }
            };

            const result = await callback(transactionalDb);
            await tx.commit();
            return result;
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public getDialect(): 'sqlite' | 'postgres' {
        return 'sqlite';
    }

    private async initializeTables(): Promise<void> {
        if (!this.client) return;

        // Tabela de eventos (movimentações de carros)
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT,
                config_id TEXT,
                config_snapshot TEXT,
                duration_days INTEGER NOT NULL DEFAULT 7,
                speed_factor INTEGER NOT NULL DEFAULT 60,
                status TEXT NOT NULL DEFAULT 'idle',
                started_at INTEGER,
                expires_at INTEGER,
                stopped_at INTEGER,
                simulated_timestamp INTEGER,
                current_tick INTEGER DEFAULT 0,
                last_snapshot_at INTEGER,
                interrupted_at INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de eventos (movimentações de carros)
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS car_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                car_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                shop TEXT NOT NULL,
                line TEXT NOT NULL,
                station TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                data TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de paradas
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS stop_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                stop_id TEXT NOT NULL,
                shop TEXT NOT NULL,
                line TEXT NOT NULL,
                station TEXT NOT NULL,
                reason TEXT,
                severity TEXT,
                type TEXT,
                category TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                status TEXT NOT NULL,
                duration_ms INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de estado dos buffers
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS buffer_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                buffer_id TEXT NOT NULL,
                from_location TEXT NOT NULL,
                to_location TEXT NOT NULL,
                capacity INTEGER NOT NULL,
                current_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                type TEXT NOT NULL,
                car_ids TEXT,
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de snapshots da planta
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS plant_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                timestamp INTEGER NOT NULL,
                total_stations INTEGER NOT NULL,
                total_occupied INTEGER NOT NULL,
                total_free INTEGER NOT NULL,
                total_stopped INTEGER NOT NULL,
                snapshot_data TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de OEE
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS oee (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                date TEXT NOT NULL,
                shop TEXT NOT NULL,
                line TEXT NOT NULL,
                production_time REAL NOT NULL,
                cars_production INTEGER NOT NULL,
                takt_time REAL NOT NULL,
                diff_time REAL NOT NULL,
                oee REAL NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de MTTR/MTBF
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS mttr_mtbf (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                date TEXT NOT NULL,
                shop TEXT NOT NULL,
                line TEXT NOT NULL,
                station TEXT NOT NULL,
                mttr REAL NOT NULL,
                mtbf REAL NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Tabela de configuração da planta
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS config_plant (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                config TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Índices para tabela de sessões
        await this.client.executeMultiple(`
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON sessions(user_id, status)
        `);

        // Índices básicos para performance
         await this.client.executeMultiple(`
            CREATE INDEX IF NOT EXISTS idx_car_events_timestamp ON car_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_car_events_car_id ON car_events(car_id);
            CREATE INDEX IF NOT EXISTS idx_car_events_session_id ON car_events(session_id);
            CREATE INDEX IF NOT EXISTS idx_stop_events_timestamp ON stop_events(start_time);
            CREATE INDEX IF NOT EXISTS idx_stop_events_session_id ON stop_events(session_id);
            CREATE INDEX IF NOT EXISTS idx_buffer_states_timestamp ON buffer_states(timestamp);
            CREATE INDEX IF NOT EXISTS idx_buffer_states_session_id ON buffer_states(session_id);
            CREATE INDEX IF NOT EXISTS idx_plant_snapshots_timestamp ON plant_snapshots(timestamp);
            CREATE INDEX IF NOT EXISTS idx_plant_snapshots_session_id ON plant_snapshots(session_id);
            CREATE INDEX IF NOT EXISTS idx_oee_date ON oee(date);
            CREATE INDEX IF NOT EXISTS idx_oee_shop ON oee(shop);
            CREATE INDEX IF NOT EXISTS idx_oee_session_id ON oee(session_id);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_date ON mttr_mtbf(date);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_shop ON mttr_mtbf(shop);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_session_id ON mttr_mtbf(session_id);
            CREATE INDEX IF NOT EXISTS idx_config_plant_name ON config_plant(name);
            CREATE INDEX IF NOT EXISTS idx_config_plant_default ON config_plant(is_default)
        `);

        // Índices compostos para queries otimizadas
        await this.client.executeMultiple(`
            -- car_events: queries por shop+line
            CREATE INDEX IF NOT EXISTS idx_car_events_shop_line ON car_events(shop, line);
            CREATE INDEX IF NOT EXISTS idx_car_events_shop_line_ts ON car_events(shop, line, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_car_events_event_type ON car_events(event_type);
            CREATE INDEX IF NOT EXISTS idx_car_events_session_ts ON car_events(session_id, timestamp DESC);

            -- stop_events: queries por status e shop+line
            CREATE INDEX IF NOT EXISTS idx_stop_events_status ON stop_events(status);
            CREATE INDEX IF NOT EXISTS idx_stop_events_status_start ON stop_events(status, start_time DESC);
            CREATE INDEX IF NOT EXISTS idx_stop_events_shop_line ON stop_events(shop, line);
            CREATE INDEX IF NOT EXISTS idx_stop_events_shop_line_status ON stop_events(shop, line, status);
            CREATE INDEX IF NOT EXISTS idx_stop_events_severity ON stop_events(severity);
            CREATE INDEX IF NOT EXISTS idx_stop_events_session_ts ON stop_events(session_id, start_time DESC);

            -- buffer_states: queries por buffer_id
            CREATE INDEX IF NOT EXISTS idx_buffer_states_buffer_id ON buffer_states(buffer_id);
            CREATE INDEX IF NOT EXISTS idx_buffer_states_buffer_ts ON buffer_states(buffer_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_buffer_states_session_ts ON buffer_states(session_id, timestamp DESC);

            -- plant_snapshots: queries por sessão
            CREATE INDEX IF NOT EXISTS idx_plant_snapshots_session_ts ON plant_snapshots(session_id, timestamp DESC);

            -- oee: queries compostas
            CREATE INDEX IF NOT EXISTS idx_oee_date_shop ON oee(date, shop);
            CREATE INDEX IF NOT EXISTS idx_oee_date_shop_line ON oee(date, shop, line);
            CREATE INDEX IF NOT EXISTS idx_oee_session_date ON oee(session_id, date);

            -- mttr_mtbf: queries compostas
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_date_shop ON mttr_mtbf(date, shop);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_shop_line ON mttr_mtbf(shop, line);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_shop_line_station ON mttr_mtbf(shop, line, station);
            CREATE INDEX IF NOT EXISTS idx_mttr_mtbf_session_date ON mttr_mtbf(session_id, date)
        `);
    }
}
