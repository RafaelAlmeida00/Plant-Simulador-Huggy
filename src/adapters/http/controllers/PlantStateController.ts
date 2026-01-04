// src/adapters/http/controllers/PlantStateController.ts

import { Request, Response } from 'express';
import { PlantSnapshotRepository, IPlantSnapshotRecord } from '../../database/repositories/PlantSnapshotRepository';

export class PlantStateController {
    private repository: PlantSnapshotRepository;

    constructor() {
        this.repository = new PlantSnapshotRepository();
    }

    // GET /api/plantstate - Lista todos os snapshots com filtros opcionais
    public async getAll(req: Request, res: Response): Promise<void> {
        try {
            const { start_time, end_time } = req.query;

            // Filtro por range de tempo
            if (start_time && end_time) {
                const snapshots = await this.repository.findByTimeRange(
                    parseInt(start_time as string, 10),
                    parseInt(end_time as string, 10)
                );
                res.json({ success: true, data: snapshots, count: snapshots.length });
                return;
            }

            const snapshots = await this.repository.findAll();
            
            res.json({ success: true, data: snapshots, count: snapshots.length });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/plantstate/latest - Retorna o snapshot mais recente
    public async getLatest(req: Request, res: Response): Promise<void> {
        try {
            const snapshot = await this.repository.findLatest();
            
            if (!snapshot) {
                res.status(404).json({ success: false, error: 'No plant snapshot found' });
                return;
            }

            res.json({ success: true, data: snapshot });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // GET /api/plantstate/:id
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const snapshot = await this.repository.findById(parseInt(id, 10));
            
            if (!snapshot) {
                res.status(404).json({ success: false, error: 'Plant snapshot not found' });
                return;
            }

            // Parse snapshot_data se for string
            if (typeof snapshot.snapshot_data === 'string') {
                snapshot.snapshot_data = JSON.parse(snapshot.snapshot_data);
            }

            res.json({ success: true, data: snapshot });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // POST /api/plantstate
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const snapshotData: Partial<IPlantSnapshotRecord> = req.body;
            
            if (!snapshotData.timestamp || snapshotData.total_stations === undefined || 
                snapshotData.total_occupied === undefined || snapshotData.total_free === undefined ||
                snapshotData.total_stopped === undefined || !snapshotData.snapshot_data) {
                res.status(400).json({ 
                    success: false, 
                    error: 'Missing required fields: timestamp, total_stations, total_occupied, total_free, total_stopped, snapshot_data' 
                });
                return;
            }

            const snapshot = await this.repository.create(snapshotData);
            res.status(201).json({ success: true, data: snapshot });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // PUT /api/plantstate/:id
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const snapshotData: Partial<IPlantSnapshotRecord> = req.body;
            
            const snapshot = await this.repository.update(parseInt(id, 10), snapshotData);
            
            if (!snapshot) {
                res.status(404).json({ success: false, error: 'Plant snapshot not found' });
                return;
            }

            res.json({ success: true, data: snapshot });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // DELETE /api/plantstate/:id
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.repository.delete(parseInt(id, 10));
            
            if (!deleted) {
                res.status(404).json({ success: false, error: 'Plant snapshot not found' });
                return;
            }

            res.json({ success: true, message: 'Plant snapshot deleted successfully' });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new PlantStateController();
