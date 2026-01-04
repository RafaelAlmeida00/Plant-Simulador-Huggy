// src/adapters/database/SQLiteDatabase.ts

import Database from 'better-sqlite3';
import { IDatabase, QueryResult } from './IDatabase';
import { IDatabaseConfig } from './DatabaseConfig';
import * as fs from 'fs';
import * as path from 'path';

export class SQLiteDatabase implements IDatabase {
    private db: Database.Database | null = null;
    private config: IDatabaseConfig;
    private connected: boolean = false;

    constructor(config: IDatabaseConfig) {
        this.config = config;
    }

    public async connect(): Promise<void> {
        if (this.connected && this.db) return;

        const dbPath = this.config.connectionString || './database.db';
        const dir = path.dirname(dbPath);
        
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.connected = true;
        
        await this.initializeTables();
    }

    public async disconnect(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.connected = false;
        }
    }

    public async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
        if (!this.db) throw new Error('Database not connected');

        const stmt = this.db.prepare(sql);

        // better-sqlite3: stmt.reader indica se há resultado (SELECT/PRAGMA/CTE)
        if (stmt.reader) {
            const rows = stmt.all(...params) as T[];
            return { rows, rowCount: rows.length };
        }

        // INSERT/UPDATE/DELETE: executa e retorna apenas contagem
        const result = stmt.run(...params);
        return { rows: [], rowCount: result.changes };
    }

    public async execute(sql: string, params: any[] = []): Promise<number> {
        if (!this.db) throw new Error('Database not connected');
        
        const stmt = this.db.prepare(sql);
        const result = stmt.run(...params);
        
        return result.changes;
    }

    public async transaction<T>(callback: (db: IDatabase) => Promise<T>): Promise<T> {
        if (!this.db) throw new Error('Database not connected');

        // Implementação async-safe: BEGIN/COMMIT/ROLLBACK explícitos
        this.db.exec('BEGIN');
        try {
            const result = await callback(this);
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            try {
                this.db.exec('ROLLBACK');
            } catch {
                // ignore rollback error
            }
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
        if (!this.db) return;

        // Tabela de eventos (movimentações de carros)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS car_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS stop_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS buffer_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS plant_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS oee (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mttr_mtbf (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS config_plant (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                config TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            )
        `);

        // Índices para performance
        this.db.exec(`
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
