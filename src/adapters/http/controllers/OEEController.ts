// src/adapters/http/controllers/OEEController.ts

import { Request, Response } from 'express';
import { OEERepository, IOEE } from '../repositories/OEERepository';
import { parsePaginationParams, formatPaginatedResponse, createPaginatedResponse, paginateArray } from '../../../utils/pagination';

export class OEEController {
    private repository: OEERepository;

    constructor() {
        this.repository = new OEERepository();
    }

    // GET /api/oee - Lista todos os registros de OEE com filtros opcionais e paginação
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { date, shop, line, start_time, end_time } = req.query;
            const pagination = parsePaginationParams(req.query);

            // Filtro por range de tempo (with pagination)
            if (start_time && end_time) {
                const result = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                // Apply in-memory pagination to time range results
                const paginatedData = paginateArray(result.data, pagination);
                res.json(createPaginatedResponse(paginatedData, pagination, result.data.length));
                return;
            }

            // Filtro por data, shop e linha (single result, no pagination needed)
            if (date && shop && line) {
                const record = await this.repository.findByDateShopLine(
                    date as string,
                    shop as string,
                    line as string
                );
                res.json(createPaginatedResponse(record ? [record] : [], pagination, record ? 1 : 0));
                return;
            }

            // Build filters object for paginated query
            const filters: Record<string, any> = {};
            if (date) filters.date = date;
            if (shop) filters.shop = shop;
            if (line) filters.line = line;

            // Use paginated query with all filters
            const result = await this.repository.findAllPaginated(
                pagination,
                Object.keys(filters).length > 0 ? filters : undefined
            );
            res.json(formatPaginatedResponse(result));
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
