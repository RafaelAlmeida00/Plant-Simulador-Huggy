// src/adapters/http/controllers/SessionController.ts

import { Request, Response } from 'express';
import { SessionManager, CreateSessionOptions } from '../../../sessions/SessionManager';
import { logger } from '../../../utils/logger';

/**
 * SessionController handles HTTP endpoints for session management.
 *
 * Endpoints:
 * - POST   /api/sessions              - Create new session (idle state)
 * - GET    /api/sessions              - List user's sessions
 * - GET    /api/sessions/stats        - Get session count statistics
 * - GET    /api/sessions/interrupted  - List interrupted sessions (for recovery)
 * - GET    /api/sessions/:id          - Get session details
 * - GET    /api/sessions/:id/can-recover - Check if session can be recovered
 * - POST   /api/sessions/:id/start    - Start session (spawn worker)
 * - POST   /api/sessions/:id/pause    - Pause running session
 * - POST   /api/sessions/:id/resume   - Resume paused session
 * - POST   /api/sessions/:id/stop     - Stop session (keep data)
 * - POST   /api/sessions/:id/recover  - Recover interrupted session
 * - POST   /api/sessions/:id/discard  - Discard interrupted session
 * - DELETE /api/sessions/:id          - Delete session and all data
 */
export class SessionController {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    /**
     * Helper to get user ID from request
     * Falls back to 'anonymous' if auth is disabled
     */
    private getUserId(req: Request): string {
        return req.user?.id ?? 'anonymous';
    }

    /**
     * Helper to extract session ID from request params
     */
    private getSessionId(req: Request): string {
        const id = req.params.id;
        return Array.isArray(id) ? id[0] : id;
    }

    /**
     * POST /api/sessions - Create a new session in idle state
     */
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const { name, configId, durationDays, speedFactor } = req.body;

            const options: CreateSessionOptions = {
                userId,
                name,
                configId,
                durationDays: durationDays ? Number(durationDays) : undefined,
                speedFactor: speedFactor ? Number(speedFactor) : undefined
            };

            const session = await this.sessionManager.createSession(options);

            res.status(201).json({
                success: true,
                data: session,
                message: 'Session created in idle state. Call POST /api/sessions/:id/start to begin simulation.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('limit') ? 429 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/sessions - List all sessions for the authenticated user
     */
    public async list(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const sessions = await this.sessionManager.listUserSessions(userId);

            res.json({
                success: true,
                data: sessions,
                count: sessions.length
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/sessions/stats - Get session count statistics
     */
    public async getStats(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const stats = await this.sessionManager.getSessionStats(userId);

            res.json({
                success: true,
                data: {
                    userActiveSessions: stats.userActive,
                    globalActiveSessions: stats.globalActive,
                    maxSessionsPerUser: stats.limits.maxSessionsPerUser,
                    maxGlobalSessions: stats.limits.maxGlobalSessions,
                    userCanCreate: stats.userActive < stats.limits.maxSessionsPerUser && stats.globalActive < stats.limits.maxGlobalSessions
                }
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/sessions/:id - Get session details
     */
    public async getById(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.getSession(id, userId);

            if (!session) {
                res.status(404).json({ success: false, error: 'Session not found' });
                return;
            }

            res.json({ success: true, data: session });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/start - Start a session (spawn worker)
     */
    public async start(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.startSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session started. Simulation is now running.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('limit') ? 429 :
                              error.message.includes('Cannot') ? 400 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/pause - Pause a running session
     */
    public async pause(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.pauseSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session paused.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('Cannot') ? 400 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/resume - Resume a paused session
     */
    public async resume(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.resumeSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session resumed.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('Cannot') ? 400 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/stop - Stop a session (terminate worker, keep data)
     */
    public async stop(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.stopSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session stopped. Data is preserved.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('Cannot') ? 400 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * DELETE /api/sessions/:id - Delete a session and all its data
     */
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            await this.sessionManager.deleteSession(id, userId);

            res.json({
                success: true,
                message: 'Session and all associated data deleted.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    // ==================== RECOVERY ENDPOINTS ====================

    /**
     * GET /api/sessions/interrupted - List all interrupted sessions for the user
     */
    public async listInterrupted(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const sessions = await this.sessionManager.getInterruptedSessions(userId);

            res.json({
                success: true,
                data: sessions,
                count: sessions.length,
                message: sessions.length > 0
                    ? 'Interrupted sessions available for recovery.'
                    : 'No interrupted sessions found.'
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/recover - Recover an interrupted session
     */
    public async recover(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            logger().info(`Attempting to recover session ${id} for user ${userId}`);

            const session = await this.sessionManager.recoverSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session recovered successfully. Simulation is now running.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('Cannot') ? 400 :
                              error.message.includes('limit') ? 429 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/sessions/:id/discard - Discard an interrupted session (mark as stopped)
     */
    public async discard(req: Request, res: Response): Promise<void> {
        try {
            const userId = this.getUserId(req);
            const id = this.getSessionId(req);

            const session = await this.sessionManager.discardInterruptedSession(id, userId);

            res.json({
                success: true,
                data: session,
                message: 'Session discarded. Data is preserved but session will not be recovered.'
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                              error.message.includes('Cannot') ? 400 : 500;
            res.status(statusCode).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/sessions/:id/can-recover - Check if a session can be recovered
     */
    public async canRecover(req: Request, res: Response): Promise<void> {
        try {
            const id = this.getSessionId(req);

            const canRecover = await this.sessionManager.canRecoverSession(id);

            res.json({
                success: true,
                data: { canRecover },
                message: canRecover
                    ? 'Session can be recovered.'
                    : 'Session cannot be recovered (missing snapshot data or not in interrupted state).'
            });
        } catch (error: any) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}
