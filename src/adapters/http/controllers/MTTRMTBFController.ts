// src/adapters/http/controllers/MTTRMTBFController.ts

import { Request, Response } from 'express';
import { MTTRMTBFRepository, IMTTRMTBF } from '../repositories/MTTRMTBFRepository';

export class MTTRMTBFController {
    private repository: MTTRMTBFRepository;

    constructor() {
        this.repository = new MTTRMTBFRepository();
    }

    // GET /api/mttr-mtbf - Lista todos os registros de MTTR/MTBF com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { date, shop, line, station, start_time, end_time } = req.query;

            // Helper to apply session filter to results
            const applySessionFilter = (records: IMTTRMTBF[]): IMTTRMTBF[] => {
                if (req.validatedSessionId) {
                    return records.filter(r => r.session_id === req.validatedSessionId);
                }
                return records;
            };

            // Filtro por range de tempo
            if (start_time && end_time) {
                // For time range queries, use session-specific query if available
                if (req.validatedSessionId) {
                    const result = await this.repository.findBySessionId(req.validatedSessionId);
                    const filtered = result.filter(r =>
                        (r.created_at ?? 0) >= parseInt(start_time as string, 10) &&
                        (r.created_at ?? 0) <= parseInt(end_time as string, 10)
                    );
                    res.json({ success: true, data: filtered, count: filtered.length, truncated: false });
                } else {
                    const result = await this.repository.findByTimeRange(
                        parseInt(start_time as string, 10),
                        parseInt(end_time as string, 10)
                    );
                    res.json({ success: true, data: result.data, count: result.data.length, truncated: result.truncated });
                }
                return;
            }

            // Filtro por station específica
            if (shop && line && station) {
                let records = await this.repository.findByStation(
                    shop as string,
                    line as string,
                    station as string
                );
                records = applySessionFilter(records);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por linha
            if (shop && line) {
                let records = await this.repository.findByLine(shop as string, line as string);
                records = applySessionFilter(records);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por data e shop
            if (date && shop) {
                let records = await this.repository.findByDateAndShop(date as string, shop as string);
                records = applySessionFilter(records);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por data
            if (date) {
                let records = await this.repository.findByDate(date as string);
                records = applySessionFilter(records);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Filtro por shop
            if (shop) {
                let records = await this.repository.findByShop(shop as string);
                records = applySessionFilter(records);
                res.json({ success: true, data: records, count: records.length });
                return;
            }

            // Sem filtros específicos - use session filter if available
            let records: IMTTRMTBF[];
            if (req.validatedSessionId) {
                records = await this.repository.findBySessionId(req.validatedSessionId);
            } else {
                records = await this.repository.findAll();
            }
            res.json({ success: true, data: records, count: records.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/mttr-mtbf/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const record = await this.repository.findById(parseInt(String(id), 10));
            
            if (!record) {
                res.status(404).json({ success: false, error: 'MTTR/MTBF record not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/mttr-mtbf
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const data: Partial<IMTTRMTBF> = req.body;
            
            if (!data.date || !data.shop || !data.line || !data.station ||
                data.mttr === undefined || data.mtbf === undefined) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: date, shop, line, station, mttr, mtbf' 
                });
                return;
            }

            const record = await this.repository.create(data);
            res.status(201).json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/mttr-mtbf/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const data: Partial<IMTTRMTBF> = req.body;
            
            const record = await this.repository.update(parseInt(String(id), 10), data);
            
            if (!record) {
                res.status(404).json({ success: false, error: 'MTTR/MTBF record not found' });
                return;
            }

            res.json({ success: true, data: record });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/mttr-mtbf/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(String(id), 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'MTTR/MTBF record not found' });
                return;
            }

            res.json({ success: true, message: 'MTTR/MTBF record deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new MTTRMTBFController();
