// src/adapters/database/DatabaseFactory.ts

import { IDatabase } from './IDatabase';
import { DatabaseConfigFactory, IDatabaseConfig } from './DatabaseConfig';
import { SQLiteDatabase } from './SQLiteDatabase';
import { PostgresDatabase } from './PostgresDatabase';

export class DatabaseFactory {
    private static instance: IDatabase | null = null;
    private static initializing: Promise<IDatabase> | null = null;

    public static async getDatabase(): Promise<IDatabase> {
        if (this.instance && this.instance.isConnected()) return this.instance;

        // Se já existe uma inicialização em andamento, aguarda a mesma.
        if (this.initializing) return this.initializing;

        this.initializing = (async () => {
            const config = DatabaseConfigFactory.getConfig();
            const db = this.createDatabase(config);
            await db.connect();
            this.instance = db;
            return db;
        })();

        try {
            return await this.initializing;
        } finally {
            // Libera a trava para futuras reconexões (em caso de disconnect/reset).
            this.initializing = null;
        }
    }

    private static createDatabase(config: IDatabaseConfig): IDatabase {
        switch (config.type) {
            case 'sqlite':
                return new SQLiteDatabase(config);

            case 'postgres':
            case 'aws':
            case 'gcp':
            case 'local':
                return new PostgresDatabase(config);

            default:
                throw new Error(`Unsupported database type: ${config.type}`);
        }
    }

    public static async disconnect(): Promise<void> {
        if (this.instance) {
            await this.instance.disconnect();
            this.instance = null;
        }
        this.initializing = null;
    }

    public static reset(): void {
        this.instance = null;
        this.initializing = null;
        DatabaseConfigFactory.reset();
    }
}
