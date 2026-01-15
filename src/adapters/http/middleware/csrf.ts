// src/adapters/http/middleware/csrf.ts

import { Request, Response, NextFunction } from 'express';

// Cache for CSRF token validation
interface CsrfCache {
    token: string;
    expiresAt: number;
}

let csrfCache: CsrfCache | null = null;
const CSRF_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// NextAuth CSRF endpoint
const NEXTAUTH_CSRF_URL = process.env.NEXTAUTH_CSRF_URL || 'https://simulador-ui.vercel.app/api/auth/csrf';

/**
 * Fetches the current valid CSRF token from NextAuth
 * Uses caching to avoid excessive requests
 */
async function fetchValidCsrfToken(): Promise<string | null> {
    // Check cache first
    if (csrfCache && Date.now() < csrfCache.expiresAt) {
        return csrfCache.token;
    }

    try {
        const response = await fetch(NEXTAUTH_CSRF_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`[CSRF] Failed to fetch CSRF token: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const token = data.csrfToken;

        if (token) {
            // Update cache
            csrfCache = {
                token,
                expiresAt: Date.now() + CSRF_CACHE_TTL,
            };
            return token;
        }

        return null;
    } catch (error) {
        console.error('[CSRF] Error fetching CSRF token:', error);
        return null;
    }
}

/**
 * CSRF Validation Middleware
 * Validates the X-CSRF-Token header against NextAuth's CSRF token
 */
export async function csrfMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip CSRF validation for GET, HEAD, OPTIONS requests (they should be safe)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }

    // Skip if NEXTAUTH_CSRF_URL is not configured
    if (!NEXTAUTH_CSRF_URL) {
        console.warn('[CSRF] NEXTAUTH_CSRF_URL not configured - skipping CSRF validation');
        next();
        return;
    }

    const csrfToken = req.headers['x-csrf-token'] as string;

    if (!csrfToken) {
        res.status(403).json({ error: 'CSRF token ausente' });
        return;
    }

    try {
        const validToken = await fetchValidCsrfToken();

        if (!validToken) {
            console.error('[CSRF] Could not fetch valid CSRF token for validation');
            // In case of failure to fetch, we might want to allow the request
            // depending on security requirements. For now, we'll block it.
            res.status(500).json({ error: 'Erro ao validar CSRF token' });
            return;
        }

        if (csrfToken !== validToken) {
            console.warn(`[CSRF] Invalid CSRF token received`);
            res.status(403).json({ error: 'CSRF token inválido' });
            return;
        }

        next();
    } catch (error) {
        console.error('[CSRF] Error during CSRF validation:', error);
        res.status(500).json({ error: 'Erro ao validar CSRF token' });
    }
}

/**
 * Optional CSRF Middleware - logs warning but doesn't block
 * Useful for development or gradual rollout
 */
export async function optionalCsrfMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }

    const csrfToken = req.headers['x-csrf-token'] as string;

    if (!csrfToken) {
        console.warn('[CSRF] Request without CSRF token - allowing in optional mode');
        next();
        return;
    }

    try {
        const validToken = await fetchValidCsrfToken();

        if (validToken && csrfToken !== validToken) {
            console.warn('[CSRF] Invalid CSRF token received - allowing in optional mode');
        }
    } catch (error) {
        console.warn('[CSRF] Error during optional CSRF validation:', error);
    }

    next();
}

/**
 * Clears the CSRF cache - useful for testing
 */
export function clearCsrfCache(): void {
    csrfCache = null;
}
