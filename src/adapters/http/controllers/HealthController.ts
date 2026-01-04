// src/adapters/http/controllers/HealthController.ts

import { Request, Response } from 'express';

export interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    serverTimestamp: number;
    serverTimeString: string;
    simulatorStatus: 'running' | 'stopped' | 'paused' | 'unknown';
    simulatorTimestamp: number | null;
    simulatorTimeString: string | null;
    uptime: number;
    database: 'connected' | 'disconnected' | 'unknown';
    version: string;
}

export class HealthController {
    private startTime: number;
    private simulatorClock: any = null;

    constructor() {
        this.startTime = Date.now();
    }

    public setSimulatorClock(clock: any): void {
        this.simulatorClock = clock;
    }

    // GET /api/health
    public async handle(req: Request, res: Response): Promise<void> {
        try {
            const now = Date.now();
            const uptime = now - this.startTime;

            let simulatorStatus: 'running' | 'stopped' | 'paused' | 'unknown' = 'unknown';
            let simulatorTimestamp: number | null = null;
            let simulatorTimeString: string | null = null;

            if (this.simulatorClock) {
                try {
                    const state = this.simulatorClock.state;
                    simulatorStatus = state === 'running' ? 'running' : 
                                     state === 'paused' ? 'paused' : 'stopped';
                    simulatorTimestamp = this.simulatorClock.simulatedTimestamp;
                    simulatorTimeString = this.simulatorClock.getSimulatedTimeString();
                } catch {
                    simulatorStatus = 'unknown';
                }
            }

            // Verificar conexão do banco
            let databaseStatus: 'connected' | 'disconnected' | 'unknown' = 'unknown';
            try {
                const { DatabaseFactory } = await import('../../database/DatabaseFactory');
                const db = await DatabaseFactory.getDatabase();
                databaseStatus = db.isConnected() ? 'connected' : 'disconnected';
            } catch {
                databaseStatus = 'disconnected';
            }

            const health: HealthStatus = {
                status: databaseStatus === 'connected' ? 'healthy' : 'unhealthy',
                serverTimestamp: now,
                serverTimeString: new Date(now).toISOString(),
                simulatorStatus,
                simulatorTimestamp,
                simulatorTimeString,
                uptime,
                database: databaseStatus,
                version: '1.0.0'
            };

            res.json({ success: true, data: health });
        } catch (error: any) {
            res.status(500).json({ 
                success: false, 
                error: error.message,
                data: {
                    status: 'unhealthy',
                    serverTimestamp: Date.now(),
                    uptime: Date.now() - this.startTime
                }
            });
        }
    }

    // GET /api/health/detailed - Informações detalhadas
    public async handleDetailed(req: Request, res: Response): Promise<void> {
        try {
            const now = Date.now();
            const uptime = now - this.startTime;

            const memoryUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();

            // Coleta informações do simulador
            let simulatorStatus: 'running' | 'stopped' | 'paused' | 'unknown' = 'unknown';
            let simulatorTimestamp: number | null = null;
            let simulatorTimeString: string | null = null;
            let simulatorDateString: string | null = null;
            let currentTick: number | null = null;
            let speedFactor: number | null = null;

            if (this.simulatorClock) {
                try {
                    const state = this.simulatorClock.state;
                    simulatorStatus = state === 'running' ? 'running' : 
                                     state === 'paused' ? 'paused' : 'stopped';
                    simulatorTimestamp = this.simulatorClock.simulatedTimestamp;
                    simulatorTimeString = this.simulatorClock.getSimulatedTimeString();
                    simulatorDateString = this.simulatorClock.getSimulatedDateString();
                    currentTick = this.simulatorClock.currentTick;
                    speedFactor = this.simulatorClock.speedFactor;
                } catch {
                    simulatorStatus = 'unknown';
                }
            }

            const detailed = {
                status: 'healthy',
                timestamp: now,
                uptime,
                simulator: {
                    status: simulatorStatus,
                    timestamp: simulatorTimestamp,
                    timeString: simulatorTimeString,
                    dateString: simulatorDateString,
                    currentTick,
                    speedFactor
                },
                memory: {
                    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
                    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                    external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB',
                    rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB'
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                },
                nodeVersion: process.version,
                platform: process.platform,
                env: process.env.NODE_ENV || 'development'
            };

            res.json({ success: true, data: detailed });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new HealthController();
