// src/adapters/http/controllers/EventsController.ts

import { Request, Response } from 'express';
import { CarEventRepository, ICarEvent } from '../repositories/CarEventRepository';
import { parsePaginationParams, formatPaginatedResponse, createPaginatedResponse, paginateArray } from '../../../utils/pagination';

export class EventsController {
    private repository: CarEventRepository;

    constructor() {
        this.repository = new CarEventRepository();
    }

    // GET /api/events - Lista todos os eventos com filtros opcionais e paginação
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { car_id, shop, line, station, event_type, start_time, end_time } = req.query;
            const pagination = parsePaginationParams(req.query);

            // Build filters object for paginated query
            const filters: Record<string, any> = {};

            // Session filtering - if validatedSessionId is present, filter by it
            if (req.validatedSessionId) {
                filters.session_id = req.validatedSessionId;
            }

            // Filtro por range de tempo (with pagination)
            if (start_time && end_time) {
                // For time range queries, we need session-aware filtering
                if (req.validatedSessionId) {
                    const result = await this.repository.findBySessionId(req.validatedSessionId);
                    const filtered = result.filter(e =>
                        e.timestamp >= parseInt(start_time as string, 10) &&
                        e.timestamp <= parseInt(end_time as string, 10)
                    );
                    const paginatedData = paginateArray(filtered, pagination);
                    res.json(createPaginatedResponse(paginatedData, pagination, filtered.length));
                } else {
                    const result = await this.repository.findByTimeRange(
                        parseInt(start_time as string, 10),
                        parseInt(end_time as string, 10)
                    );
                    const paginatedData = paginateArray(result.data, pagination);
                    res.json(createPaginatedResponse(paginatedData, pagination, result.data.length));
                }
                return;
            }

            if (car_id) filters.car_id = car_id;
            if (shop) filters.shop = shop;
            if (line) filters.line = line;
            if (station) filters.station = station;
            if (event_type) filters.event_type = event_type;

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

    // GET /api/events/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const event = await this.repository.findById(parseInt(String(id), 10));
            
            if (!event) {
                res.status(404).json({ success: false, error: 'Event not found' });
                return;
            }

            res.json({ success: true, data: event });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/events
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const eventData: Partial<ICarEvent> = req.body;
            
            if (!eventData.car_id || !eventData.event_type || !eventData.shop || 
                !eventData.line || !eventData.station || !eventData.timestamp) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: car_id, event_type, shop, line, station, timestamp' 
                });
                return;
            }

            const event = await this.repository.create(eventData);
            res.status(201).json({ success: true, data: event });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/events/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const eventData: Partial<ICarEvent> = req.body;
            
            const event = await this.repository.update(parseInt(String(id), 10), eventData);
            
            if (!event) {
                res.status(404).json({ success: false, error: 'Event not found' });
                return;
            }

            res.json({ success: true, data: event });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/events/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(String(id), 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'Event not found' });
                return;
            }

            res.json({ success: true, message: 'Event deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new EventsController();
