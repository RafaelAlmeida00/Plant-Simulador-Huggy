// src/adapters/http/controllers/OEEController.ts

import { Request, Response } from 'express';
import { OEERepository, IOEE } from '../../database/repositories/OEERepository';

export class OEEController {
    private repository: OEERepository;

    constructor() {
        this.repository = new OEERepository();
    }

    // GET /api/oee - Lista todos os registros de OEE com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { date, shop, line, start_time, end_time } = req.query;

            // Filtro por range de tempo
            if (start_time && end_time) {
                const records = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por data, shop e linha
            if (date && shop && line) {
                const record = await this.repository.findByDateShopLine(
                    date as string,
                    shop as string,
                    line as string
                );
                res.json({ success: true, data: record ? [record] : [], count: record ? 1 : 0 });
                return;
            }

            // Filtro por data e shop
            if (date && shop) {
                const records = await this.repository.findByDateAndShop(date as string, shop as string);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por data
            if (date) {
                const records = await this.repository.findByDate(date as string);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por shop
            if (shop) {
                const records = await this.repository.findByShop(shop as string);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Sem filtros - retorna todos
            const records = await this.repository.findAll();
            res.json({ success: true, data: records, count: records.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/oee/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const record = await this.repository.findById(parseInt(id, 10));
            
            if (!record) {
                res.status(404).json({ success: false, error: 'OEE record not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/oee
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const data: Partial<IOEE> = req.body;
            
            if (!data.date || !data.shop || !data.line || 
                data.production_time === undefined || data.cars_production === undefined ||
                data.takt_time === undefined || data.diff_time === undefined || 
                data.oee === undefined) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: date, shop, line, production_time, cars_production, takt_time, diff_time, oee' 
                });
                return;
            }

            const record = await this.repository.create(data);
            res.status(201).json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/oee/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const data: Partial<IOEE> = req.body;
            
            const record = await this.repository.update(parseInt(id, 10), data);
            
            if (!record) {
                res.status(404).json({ success: false, error: 'OEE record not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/oee/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(id, 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'OEE record not found' });
                return;
            }

            res.json({ success: true, message: 'OEE record deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new OEEController();
