// src/adapters/http/controllers/BuffersController.ts

import { Request, Response } from 'express';
import { BufferStateRepository, IBufferState } from '../../database/repositories/BufferStateRepository';

export class BuffersController {
    private repository: BufferStateRepository;

    constructor() {
        this.repository = new BufferStateRepository();
    }

    private deriveBetweenShopOrLine(fromLocation: string, toLocation: string): 'shop' | 'line' {
        const fromShop = (fromLocation || '').split('-')[0] || '';
        const toShop = (toLocation || '').split('-')[0] || '';
        return fromShop && toShop && fromShop === toShop ? 'line' : 'shop';
    }

    private enrich(buffer: IBufferState): IBufferState & { between_shop_or_line: 'shop' | 'line' } {
        return {
            ...buffer,
            between_shop_or_line: this.deriveBetweenShopOrLine(buffer.from_location, buffer.to_location)
        };
    }

    // GET /api/buffers - Lista todos os estados de buffer com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { buffer_id, status, type, from_location, to_location, start_time, end_time } = req.query;

            // Filtro por range de tempo
            if (start_time && end_time) {
                const buffers = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                const data = buffers.map(b => this.enrich(b));
                res.json({ success: true, data, count: data.length });
                return;
            }

            // Filtros específicos
            if (buffer_id) {
                const buffers = await this.repository.findByBufferId(buffer_id as string);
                const data = buffers.map(b => this.enrich(b));
                res.json({ success: true, data, count: data.length });
                return;
            }

            if (status) {
                const buffers = await this.repository.findByStatus(status as string);
                const data = buffers.map(b => this.enrich(b));
                res.json({ success: true, data, count: data.length });
                return;
            }

            // Filtros genéricos
            const filters: Record<string, any> = {};
            if (type) filters.type = type;
            if (from_location) filters.from_location = from_location;
            if (to_location) filters.to_location = to_location;

            const buffers = await this.repository.findAll(Object.keys(filters).length > 0 ? filters : undefined);
            const data = buffers.map(b => this.enrich(b));
            res.json({ success: true, data, count: data.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/buffers/latest - Retorna o último estado de cada buffer
    public async getLatest(req: Request, res: Response): Promise<void> {
        try {
            const { buffer_id } = req.query;
            
            if (buffer_id) {
                const buffer = await this.repository.findLatestByBufferId(buffer_id as string);
                const data = buffer ? [this.enrich(buffer)] : [];
                res.json({ success: true, data, count: data.length });
                return;
            }

            // Retorna todos os buffers (último estado)
            const data = await this.repository.findLatestPerBuffer();
            const enriched = data.map(b => this.enrich(b));
            res.json({ success: true, data: enriched, count: enriched.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/buffers/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const buffer = await this.repository.findById(parseInt(id, 10));
            
            if (!buffer) {
                res.status(404).json({ success: false, error: 'Buffer state not found' });
                return;
            }

            res.json({ success: true, data: this.enrich(buffer) });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/buffers
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const bufferData: Partial<IBufferState> = req.body;
            
            if (!bufferData.buffer_id || !bufferData.from_location || !bufferData.to_location || 
                bufferData.capacity === undefined || bufferData.current_count === undefined ||
                !bufferData.status || !bufferData.type || !bufferData.timestamp) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: buffer_id, from_location, to_location, capacity, current_count, status, type, timestamp' 
                });
                return;
            }

            const buffer = await this.repository.create(bufferData);
            res.status(201).json({ success: true, data: this.enrich(buffer) });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/buffers/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const bufferData: Partial<IBufferState> = req.body;
            
            const buffer = await this.repository.update(parseInt(id, 10), bufferData);
            
            if (!buffer) {
                res.status(404).json({ success: false, error: 'Buffer state not found' });
                return;
            }

            res.json({ success: true, data: this.enrich(buffer) });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/buffers/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(id, 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'Buffer state not found' });
                return;
            }

            res.json({ success: true, message: 'Buffer state deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new BuffersController();
