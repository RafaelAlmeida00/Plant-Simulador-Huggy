// src/adapters/http/middleware/sessionFilter.ts

import { Request, Response, NextFunction } from 'express';
import { SessionRepository } from '../repositories/SessionRepository';

// Extend Express Request type to include validatedSessionId
declare global {
    namespace Express {
        interface Request {
            validatedSessionId?: string;
        }
    }
}

const sessionRepo = new SessionRepository();

/**
 * Session Filter Middleware
 * Validates that session_id query param exists and user has access to it.
 * If validation passes, attaches validatedSessionId to the request.
 */
export function sessionFilterMiddleware(req: Request, res: Response, next: NextFunction): void {
    const sessionId = req.query.session_id as string;

    if (!sessionId) {
        res.status(400).json({
            success: false,
            error: 'session_id query parameter is required'
        });
        return;
    }

    // Get user ID from authenticated request or use anonymous
    const userId = req.user?.id ?? 'anonymous';

    // Validate session ownership
    sessionRepo.findByIdForUser(sessionId, userId)
        .then(session => {
            if (!session) {
                res.status(403).json({
                    success: false,
                    error: 'Session not found or access denied'
                });
                return;
            }

            // Attach validated session ID to request
            req.validatedSessionId = sessionId;
            next();
        })
        .catch(err => {
            console.error('[SessionFilter] Error validating session:', err);
            res.status(500).json({
                success: false,
                error: 'Error validating session access'
            });
        });
}

/**
 * Optional Session Filter Middleware
 * Same as sessionFilterMiddleware but allows requests without session_id.
 * If session_id is provided, validates it and attaches to request.
 * If not provided, continues without attaching validatedSessionId.
 */
export function optionalSessionFilterMiddleware(req: Request, res: Response, next: NextFunction): void {
    const sessionId = req.query.session_id as string;

    // If no session_id provided, continue without validation
    if (!sessionId) {
        next();
        return;
    }

    // Get user ID from authenticated request or use anonymous
    const userId = req.user?.id ?? 'anonymous';

    // Validate session ownership
    sessionRepo.findByIdForUser(sessionId, userId)
        .then(session => {
            if (!session) {
                res.status(403).json({
                    success: false,
                    error: 'Session not found or access denied'
                });
                return;
            }

            // Attach validated session ID to request
            req.validatedSessionId = sessionId;
            next();
        })
        .catch(err => {
            console.error('[SessionFilter] Error validating session:', err);
            res.status(500).json({
                success: false,
                error: 'Error validating session access'
            });
        });
}
