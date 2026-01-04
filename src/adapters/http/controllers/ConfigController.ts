// src/adapters/http/controllers/ConfigController.ts

import { Request, Response } from 'express';
import { ConfigPlantRepository, IConfigPlant } from '../../database/repositories/ConfigPlantRepository';
import { randomUUID } from 'crypto';

export class ConfigController {
    private repository: ConfigPlantRepository;

    constructor() {
        this.repository = new ConfigPlantRepository();
    }

    // GET /api/config - Lista todas as configurações
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const records = await this.repository.findAll();
            res.json({ success: true, data: records, count: records.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/config/default - Retorna a configuração padrão
    public async getDefault(req: Request, res: Response): Promise<void> {
        try {
            const record = await this.repository.getDefault();
            
            if (!record) {
                res.status(404).json({ success: false, error: 'No default configuration found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/config/:id - Busca configuração por ID
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const record = await this.repository.findById(id);
            
            if (!record) {
                res.status(404).json({ success: false, error: 'Configuration not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/config/name/:name - Busca configuração por nome
    public async getByName(req: Request, res: Response): Promise<void> {
        try {
            const { name } = req.params;
            const record = await this.repository.findByName(name);
            
            if (!record) {
                res.status(404).json({ success: false, error: 'Configuration not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/config - Cria nova configuração
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const data = req.body;
            
            if (!data.name || !data.config) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: name, config' 
                });
                return;
            }

            // Verifica se já existe uma configuração com o mesmo nome
            const existing = await this.repository.findByName(data.name);
            if (existing) {
                res.status(409).json({ 
                    success: false, 
                    error: 'A configuration with this name already exists' 
                });
                return;
            }

            // Valida se o config é um JSON válido
            try {
                if (typeof data.config === 'string') {
                    JSON.parse(data.config);
                } else {
                    // Se for objeto, converte para string
                    data.config = JSON.stringify(data.config);
                }
            } catch {
                res.status(400).json({ 
                    success: false, 
                    error: 'Invalid config: must be a valid JSON string' 
                });
                return;
            }

            const newConfig: Omit<IConfigPlant, 'created_at'> = {
                id: data.id || randomUUID(),
                name: data.name,
                config: typeof data.config === 'string' ? data.config : JSON.stringify(data.config),
                isDefault: data.isDefault === true || data.isDefault === 'true'
            };

            const created = await this.repository.create(newConfig);
            res.status(201).json({ success: true, data: created });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/config/:id - Atualiza configuração existente
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const data = req.body;

            const existing = await this.repository.findById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Configuration not found' });
                return;
            }

            // Verifica se o nome já existe em outra configuração
            if (data.name && data.name !== existing.name) {
                const nameExists = await this.repository.findByName(data.name);
                if (nameExists) {
                    res.status(409).json({ 
                        success: false, 
                        error: 'A configuration with this name already exists' 
                    });
                    return;
                }
            }

            // Valida se o config é um JSON válido
            if (data.config) {
                try {
                    if (typeof data.config === 'string') {
                        JSON.parse(data.config);
                    } else {
                        data.config = JSON.stringify(data.config);
                    }
                } catch {
                    res.status(400).json({ 
                        success: false, 
                        error: 'Invalid config: must be a valid JSON string' 
                    });
                    return;
                }
            }

            const updateData: Partial<Omit<IConfigPlant, 'id' | 'created_at'>> = {};
            
            if (data.name !== undefined) updateData.name = data.name;
            if (data.config !== undefined) {
                updateData.config = typeof data.config === 'string' ? data.config : JSON.stringify(data.config);
            }
            if (data.isDefault !== undefined) {
                updateData.isDefault = data.isDefault === true || data.isDefault === 'true';
            }

            const updated = await this.repository.update(id, updateData);
            res.json({ success: true, data: updated });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/config/:id - Deleta configuração
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const existing = await this.repository.findById(id);
            if (!existing) {
                res.status(404).json({ success: false, error: 'Configuration not found' });
                return;
            }

            const deleted = await this.repository.delete(id);
            
            if (deleted) {
                res.json({ success: true, message: 'Configuration deleted successfully' });
            } else {
                res.status(500).json({ success: false, error: 'Failed to delete configuration' });
            }
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/config/:id/set-default - Define uma configuração como padrão
    public async setAsDefault(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;

            const updated = await this.repository.setAsDefault(id);
            
            if (!updated) {
                res.status(404).json({ success: false, error: 'Configuration not found' });
                return;
            }

            res.json({ success: true, data: updated, message: 'Configuration set as default' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new ConfigController();
