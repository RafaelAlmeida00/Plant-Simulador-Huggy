// src/adapters/database/index.ts

export { IDatabase, IRepository, QueryResult } from './IDatabase';
export { DatabaseConfigFactory, IDatabaseConfig, DatabaseType } from './DatabaseConfig';
export { DatabaseFactory } from './DatabaseFactory';
export { SQLiteDatabase } from './SQLiteDatabase';
export { PostgresDatabase } from './PostgresDatabase';
export * from './repositories';
