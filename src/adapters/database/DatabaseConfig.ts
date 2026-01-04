// src/adapters/database/DatabaseConfig.ts

export type DatabaseType = 'sqlite' | 'postgres' | 'aws' | 'gcp' | 'local';

export interface IDatabaseConfig {
    type: DatabaseType;
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
}

export class DatabaseConfigFactory {
    private static instance: IDatabaseConfig | null = null;

    public static getConfig(): IDatabaseConfig {
        if (this.instance) return this.instance;

        const nodeEnv = process.env.NODE_ENV || 'test';
        const dbType = (process.env.DATABASE_TYPE || 'sqlite').toLowerCase();

        switch (nodeEnv) {
            case 'production':
                this.instance = this.getProductionConfig(dbType);
                break;
            default:
                this.instance = this.getTestConfig();
                break;
        }

        return this.instance;
    }

    private static getTestConfig(): IDatabaseConfig {
        return {
            type: 'sqlite',
            connectionString: './src/adapters/database/test/database.db'
        };
    }

    private static getProductionConfig(dbType: string): IDatabaseConfig {
        switch (dbType) {
            case 'aws':
                return {
                    type: 'aws',
                    host: process.env.AWS_RDS_HOST || '',
                    port: parseInt(process.env.AWS_RDS_PORT || '5432', 10),
                    database: process.env.AWS_RDS_DATABASE || '',
                    user: process.env.AWS_RDS_USER || '',
                    password: process.env.AWS_RDS_PASSWORD || '',
                    ssl: true
                };

            case 'gcp':
                return {
                    type: 'gcp',
                    connectionString: process.env.GCP_SQL_CONNECTION || '',
                    database: process.env.GCP_SQL_DATABASE || '',
                    user: process.env.GCP_SQL_USER || '',
                    password: process.env.GCP_SQL_PASSWORD || ''
                };

            case 'local':
                return {
                    type: 'local',
                    host: 'localhost',
                    port: 5432,
                    database: process.env.LOCAL_DB_NAME || 'simulator',
                    user: 'root',
                    password: ''
                };

            case 'postgres':
            case 'sql':
            default:
                return {
                    type: 'postgres',
                    connectionString: process.env.DATABASE_URL || ''
                };
        }
    }

    public static reset(): void {
        this.instance = null;
    }
}
