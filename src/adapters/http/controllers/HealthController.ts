// src/adapters/http/controllers/HealthController.ts

import { Request, Response } from 'express';
import { SessionManager } from '../../../sessions/SessionManager';

export interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    serverTimestamp: number;
    serverTimeString: string;
    uptime: number;
    database: 'connected' | 'disconnected' | 'unknown';
    version: string;
    sessions: {
        active: number;
        limit: number;
    };
}

export class HealthController {
    private startTime: number;
    private sessionManager: SessionManager | null = null;

    constructor() {
        this.startTime = Date.now();
    }

    public setSessionManager(manager: SessionManager): void {
        this.sessionManager = manager;
    }

    // GET /api/health
    public async handle(req: Request, res: Response): Promise<void> {
        try {
            const now = Date.now();
            const uptime = now - this.startTime;

            // Verificar conexão do banco
            let databaseStatus: 'connected' | 'disconnected' | 'unknown' = 'unknown';
            try {
                const { DatabaseFactory } = await import('../../database/DatabaseFactory');
                const db = await DatabaseFactory.getDatabase();
                databaseStatus = db.isConnected() ? 'connected' : 'disconnected';
            } catch {
                databaseStatus = 'disconnected';
            }

            // Session stats
            let sessions = { active: 0, limit: 20 };
            if (this.sessionManager) {
                try {
                    const stats = await this.sessionManager.getSessionStats('global');
                    sessions = {
                        active: stats.globalActive,
                        limit: stats.limits.maxGlobalSessions
                    };
                } catch {
                    // Keep default values
                }
            }

            const health: HealthStatus = {
                status: databaseStatus === 'connected' ? 'healthy' : 'unhealthy',
                serverTimestamp: now,
                serverTimeString: new Date(now).toISOString(),
                uptime,
                database: databaseStatus,
                version: '2.0.0',
                sessions
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

            // Session stats
            let sessions = { active: 0, limit: 20, perUser: 2 };
            if (this.sessionManager) {
                try {
                    const stats = await this.sessionManager.getSessionStats('global');
                    sessions = {
                        active: stats.globalActive,
                        limit: stats.limits.maxGlobalSessions,
                        perUser: stats.limits.maxSessionsPerUser
                    };
                } catch {
                    // Keep default values
                }
            }

            const detailed = {
                status: 'healthy',
                timestamp: now,
                uptime,
                sessions,
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
