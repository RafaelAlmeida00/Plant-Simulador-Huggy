// src/adapters/http/controllers/StopsController.ts

import { Request, Response } from 'express';
import { StopEventRepository, IStopEvent } from '../../database/repositories/StopEventRepository';

export class StopsController {
    private repository: StopEventRepository;

    constructor() {
        this.repository = new StopEventRepository();
    }

    // GET /api/stops - Lista todas as paradas com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { stop_id, shop, line, station, severity, status, type, start_time, end_time } = req.query;

            // Filtro por range de tempo
            if (start_time && end_time) {
                const stops = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                res.json({ success: true, data: stops, count: stops.length });
                return;
            }

            // Filtros específicos
            if (stop_id) {
                const stop = await this.repository.findByStopId(stop_id as string);
                res.json({ success: true, data: stop ? [stop] : [], count: stop ? 1 : 0 });
                return;
            }

            if (status === 'IN_PROGRESS') {
                const stops = await this.repository.findActiveStops();
                res.json({ success: true, data: stops, count: stops.length });
                return;
            }

            if (severity) {
                const stops = await this.repository.findBySeverity(severity as string);
                res.json({ success: true, data: stops, count: stops.length });
                return;
            }

            if (shop) {
                const stops = await this.repository.findByShop(shop as string);
                res.json({ success: true, data: stops, count: stops.length });
                return;
            }

            // Filtros genéricos
            const filters: Record<string, any> = {};
            if (line) filters.line = line;
            if (station) filters.station = station;
            if (type) filters.type = type;
            if (status) filters.status = status;

            const stops = await this.repository.findAll(Object.keys(filters).length > 0 ? filters : undefined);
            res.json({ success: true, data: stops, count: stops.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/stops/active - Retorna apenas paradas ativas
    public async getActive(req: Request, res: Response): Promise<void> {
        try {
            const stops = await this.repository.findActiveStops();
            res.json({ success: true, data: stops, count: stops.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/stops/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const stop = await this.repository.findById(parseInt(id, 10));
            
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
            
            const stop = await this.repository.update(parseInt(id, 10), stopData);
            
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
            const deleted = await this.repository.delete(parseInt(id, 10));
            
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
