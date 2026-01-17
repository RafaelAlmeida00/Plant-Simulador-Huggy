    // src/adapters/http/middleware/auth.ts

    import { Request, Response, NextFunction } from 'express';
    import jwt from 'jsonwebtoken';

    const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;

    export interface DecodedToken {
        id: string;
        email: string;
        name?: string;
        provider?: string;
        iat: number;
        exp: number;
    }

    export interface AuthenticatedUser {
        id: string;
        email: string;
        name?: string;
    }

    // Extend Express Request type to include user
    declare global {
        namespace Express {
            interface Request {
                user?: AuthenticatedUser;
            }
        }
    }

    /**
     * HTTP Authentication Middleware
     * Validates JWT token from Authorization header (Bearer token)
     * Uses NextAuth HS512 algorithm for token verification
     */
    export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
        // Skip auth if NEXTAUTH_SECRET is not configured (development mode)
        if (!NEXTAUTH_SECRET) {
            console.warn('[AUTH] NEXTAUTH_SECRET not configured - skipping authentication');
            next();
            return;
        }

        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Token não fornecido' });
            return;
        }

        const token = authHeader.substring(7); // Remove "Bearer "

        try {
            // NextAuth uses HS256 by default
            const decoded = jwt.verify(token, NEXTAUTH_SECRET, {
                algorithms: ['HS256'],
            }) as DecodedToken;

            // Add user data to request
            req.user = {
                id: decoded.id,
                email: decoded.email,
                name: decoded.name,
            };

            next();
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                res.status(401).json({ error: 'Token expirado' });
                return;
            }
            if (error instanceof jwt.JsonWebTokenError) {
                res.status(401).json({ error: 'Token inválido' });
                return;
            }
            res.status(500).json({ error: 'Erro ao validar token' });
        }
    }
