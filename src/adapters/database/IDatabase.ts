// src/adapters/database/IDatabase.ts

export interface QueryResult<T = any> {
    rows: T[];
    rowCount: number;
}

export interface IDatabase {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
    execute(sql: string, params?: any[]): Promise<number>;
    transaction<T>(callback: (db: IDatabase) => Promise<T>): Promise<T>;
    isConnected(): boolean;
    getDialect(): 'sqlite' | 'postgres';
}

export interface IRepository<T> {
    findAll(filters?: Record<string, any>): Promise<T[]>;
    findById(id: string | number): Promise<T | null>;
    findByTimeRange(startTime: number, endTime: number): Promise<T[]>;
    create(entity: Partial<T>): Promise<T>;
    update(id: string | number, entity: Partial<T>): Promise<T | null>;
    delete(id: string | number): Promise<boolean>;
}
