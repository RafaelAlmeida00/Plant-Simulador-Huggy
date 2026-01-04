// src/adapters/http/controllers/EventsController.ts

import { Request, Response } from 'express';
import { CarEventRepository, ICarEvent } from '../../database/repositories/CarEventRepository';

export class EventsController {
    private repository: CarEventRepository;

    constructor() {
        this.repository = new CarEventRepository();
    }

    // GET /api/events - Lista todos os eventos com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { car_id, shop, line, station, event_type, start_time, end_time } = req.query;

            // Filtro por range de tempo
            if (start_time && end_time) {
                const events = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                res.json({ success: true, data: events, count: events.length });
                return;
            }

            // Filtros específicos
            if (car_id) {
                const events = await this.repository.findByCarId(car_id as string);
                res.json({ success: true, data: events, count: events.length });
                return;
            }

            if (shop && line) {
                const events = await this.repository.findByLine(shop as string, line as string);
                res.json({ success: true, data: events, count: events.length });
                return;
            }

            if (shop) {
                const events = await this.repository.findByShop(shop as string);
                res.json({ success: true, data: events, count: events.length });
                return;
            }

            // Filtros genéricos
            const filters: Record<string, any> = {};
            if (event_type) filters.event_type = event_type;
            if (station) filters.station = station;

            const events = await this.repository.findAll(Object.keys(filters).length > 0 ? filters : undefined);
            res.json({ success: true, data: events, count: events.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/events/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const event = await this.repository.findById(parseInt(id, 10));
            
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
            
            const event = await this.repository.update(parseInt(id, 10), eventData);
            
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
            const deleted = await this.repository.delete(parseInt(id, 10));
            
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
