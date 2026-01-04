// src/adapters/database/repositories/ConfigPlantRepository.ts

import { IDatabase } from '../IDatabase';
import { DatabaseFactory } from '../DatabaseFactory';

export interface IConfigPlant {
    id: string;
    name: string;
    config: string;
    isDefault: boolean;
    created_at?: number;
}

export class ConfigPlantRepository {
    protected tableName = 'config_plant';
    protected idColumn = 'id';

    protected async getDb(): Promise<IDatabase> {
        return DatabaseFactory.getDatabase();
    }

    protected convertPlaceholders(db: IDatabase, sql: string): string {
        return db.getDialect() === 'sqlite' ? sql.replace(/\$\d+/g, '?') : sql;
    }

    protected getReturningClause(db: IDatabase): string {
        return db.getDialect() === 'sqlite' ? '' : ' RETURNING *';
    }

    protected normalize(row: any): IConfigPlant {
        return {
            id: row.id,
            name: row.name,
            config: row.config,
            isDefault: row.is_default === 1 || row.is_default === true || row.is_default === 'true',
            created_at: row.created_at
        };
    }

    // Busca todas as configurações
    public async findAll(): Promise<IConfigPlant[]> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} ORDER BY created_at DESC`;
        const result = await db.query<any>(sql);
        return result.rows.map(r => this.normalize(r));
    }

    // Busca por ID
    public async findById(id: string): Promise<IConfigPlant | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE ${this.idColumn} = $1`;
        const result = await db.query<any>(this.convertPlaceholders(db, sql), [id]);
        const row = result.rows[0] || null;
        return row ? this.normalize(row) : null;
    }

    // Busca por nome
    public async findByName(name: string): Promise<IConfigPlant | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE name = $1`;
        const result = await db.query<any>(this.convertPlaceholders(db, sql), [name]);
        const row = result.rows[0] || null;
        return row ? this.normalize(row) : null;
    }

    // Busca a configuração padrão
    public async getDefault(): Promise<IConfigPlant | null> {
        const db = await this.getDb();
        const sql = `SELECT * FROM ${this.tableName} WHERE is_default = $1 LIMIT 1`;
        const isDefaultValue = db.getDialect() === 'sqlite' ? 1 : true;
        const result = await db.query<any>(this.convertPlaceholders(db, sql), [isDefaultValue]);
        const row = result.rows[0] || null;
        return row ? this.normalize(row) : null;
    }

    // Remove o default atual (se existir)
    private async clearCurrentDefault(): Promise<void> {
        const db = await this.getDb();
        const isDefaultFalse = db.getDialect() === 'sqlite' ? 0 : false;
        const isDefaultTrue = db.getDialect() === 'sqlite' ? 1 : true;
        const sql = `UPDATE ${this.tableName} SET is_default = $1 WHERE is_default = $2`;
        await db.execute(this.convertPlaceholders(db, sql), [isDefaultFalse, isDefaultTrue]);
    }

    // Cria uma nova configuração
    public async create(entity: Omit<IConfigPlant, 'created_at'>): Promise<IConfigPlant> {
        const db = await this.getDb();

        // Se está sendo criado como default, limpa o default atual
        if (entity.isDefault) {
            await this.clearCurrentDefault();
        }

        const isDefaultValue = db.getDialect() === 'sqlite' 
            ? (entity.isDefault ? 1 : 0) 
            : entity.isDefault;

        const sql = `INSERT INTO ${this.tableName} (id, name, config, is_default) VALUES ($1, $2, $3, $4)`;
        await db.execute(this.convertPlaceholders(db, sql), [
            entity.id,
            entity.name,
            entity.config,
            isDefaultValue
        ]);

        const created = await this.findById(entity.id);
        if (!created) throw new Error('Failed to create config plant');
        return created;
    }

    // Atualiza uma configuração existente
    public async update(id: string, entity: Partial<Omit<IConfigPlant, 'id' | 'created_at'>>): Promise<IConfigPlant | null> {
        const db = await this.getDb();
        const existing = await this.findById(id);
        if (!existing) return null;

        // Se está sendo atualizado para default, limpa o default atual
        if (entity.isDefault === true) {
            await this.clearCurrentDefault();
        }

        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (entity.name !== undefined) {
            updates.push(`name = $${paramIndex++}`);
            params.push(entity.name);
        }

        if (entity.config !== undefined) {
            updates.push(`config = $${paramIndex++}`);
            params.push(entity.config);
        }

        if (entity.isDefault !== undefined) {
            const isDefaultValue = db.getDialect() === 'sqlite' 
                ? (entity.isDefault ? 1 : 0) 
                : entity.isDefault;
            updates.push(`is_default = $${paramIndex++}`);
            params.push(isDefaultValue);
        }

        if (updates.length === 0) {
            return existing;
        }

        params.push(id);
        const sql = `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE ${this.idColumn} = $${paramIndex}`;
        await db.execute(this.convertPlaceholders(db, sql), params);

        return this.findById(id);
    }

    // Deleta uma configuração
    public async delete(id: string): Promise<boolean> {
        const db = await this.getDb();
        const sql = `DELETE FROM ${this.tableName} WHERE ${this.idColumn} = $1`;
        const changes = await db.execute(this.convertPlaceholders(db, sql), [id]);
        return changes > 0;
    }

    // Define uma configuração como padrão
    public async setAsDefault(id: string): Promise<IConfigPlant | null> {
        const existing = await this.findById(id);
        if (!existing) return null;

        await this.clearCurrentDefault();
        return this.update(id, { isDefault: true });
    }
}
