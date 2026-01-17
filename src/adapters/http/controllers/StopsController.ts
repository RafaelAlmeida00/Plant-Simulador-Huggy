// src/adapters/http/controllers/StopsController.ts

import { Request, Response } from 'express';
import { StopEventRepository, IStopEvent } from '../repositories/StopEventRepository';
import { parsePaginationParams, formatPaginatedResponse, createPaginatedResponse, paginateArray } from '../../../utils/pagination';

export class StopsController {
    private repository: StopEventRepository;

    constructor() {
        this.repository = new StopEventRepository();
    }

    // GET /api/stops - Lista todas as paradas com filtros opcionais e paginação
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { stop_id, shop, line, station, severity, status, type, start_time, end_time } = req.query;
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

            // Filtro por stop_id específico (retorna single result, no pagination needed)
            if (stop_id) {
                const stop = await this.repository.findByStopId(stop_id as string);
                res.json(createPaginatedResponse(stop ? [stop] : [], pagination, stop ? 1 : 0));
                return;
            }

            // Build filters object for paginated query
            const filters: Record<string, any> = {};
            if (shop) filters.shop = shop;
            if (line) filters.line = line;
            if (station) filters.station = station;
            if (severity) filters.severity = severity;
            if (status) filters.status = status;
            if (type) filters.type = type;

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

    // GET /api/stops/active - Retorna apenas paradas ativas com paginação
    public async getActive(req: Request, res: Response): Promise<void> {
        try {
            const pagination = parsePaginationParams(req.query);
            // Use paginated query with status filter
            const result = await this.repository.findAllPaginated(
                pagination,
                { status: 'IN_PROGRESS' }
            );
            res.json(formatPaginatedResponse(result));
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/stops/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const stop = await this.repository.findById(parseInt(String(id), 10));
            
            if (!stop) {
                res.status(404).json({ success: false, error: 'Stop not found' });
                return;
            }

            res.json({ success: true, data: stop });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/stops
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const stopData: Partial<IStopEvent> = req.body;
            
            if (!stopData.stop_id || !stopData.shop || !stopData.line || 
                !stopData.station || !stopData.start_time || !stopData.status) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: stop_id, shop, line, station, start_time, status' 
                });
                return;
            }

            const stop = await this.repository.create(stopData);
            res.status(201).json({ success: true, data: stop });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/stops/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const stopData: Partial<IStopEvent> = req.body;
            
            const stop = await this.repository.update(parseInt(String(id), 10), stopData);
            
            if (!stop) {
                res.status(404).json({ success: false, error: 'Stop not found' });
                return;
            }

            res.json({ success: true, data: stop });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/stops/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(String(id), 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'Stop not found' });
                return;
            }

            res.json({ success: true, message: 'Stop deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new StopsController();
