// src/adapters/http/middleware/socketAuth.ts

import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { DecodedToken, AuthenticatedUser } from './auth';

const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || '';

// Extend Socket type to include user
declare module 'socket.io' {
    interface Socket {
        user?: AuthenticatedUser;
    }
}

/**
 * Socket.IO Authentication Middleware
 * Validates JWT token from handshake auth object
 * Uses NextAuth HS256 algorithm for token verification
 *
 * @param io - Socket.IO Server instance
 */
export function setupSocketAuth(io: Server): void {
    io.use((socket: Socket, next) => {
        // Skip auth if NEXTAUTH_SECRET is not configured (development mode)
        if (!NEXTAUTH_SECRET) {
            console.warn('[SOCKET AUTH] NEXTAUTH_SECRET not configured - skipping authentication');
            next();
            return;
        }

        const { token } = socket.handshake.auth;

        if (!token) {
            console.warn(`[SOCKET AUTH] Connection attempt without token from ${socket.handshake.address}`);
            next(new Error('Autenticação necessária'));
            return;
        }

        try {
            const decoded = jwt.verify(token, NEXTAUTH_SECRET, {
                algorithms: ['HS256'],
            }) as DecodedToken;

            // Attach user data to socket
            socket.user = {
                id: decoded.id,
                email: decoded.email,
                name: decoded.name,
            };

            console.log(`[SOCKET AUTH] Authenticated user: ${decoded.email}`);
            next();
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                console.warn(`[SOCKET AUTH] Token expired for connection from ${socket.handshake.address}`);
                next(new Error('Token expirado'));
                return;
            }
            if (error instanceof jwt.JsonWebTokenError) {
                console.warn(`[SOCKET AUTH] Invalid token for connection from ${socket.handshake.address}`);
                next(new Error('Token inválido'));
                return;
            }
            console.error(`[SOCKET AUTH] Error validating token:`, error);
            next(new Error('Erro ao validar token'));
        }
    });
}

/**
 * Optional Socket.IO Authentication Middleware
 * Allows connections without token but attaches user if token is valid
 *
 * @param io - Socket.IO Server instance
 */
export function setupOptionalSocketAuth(io: Server): void {
    io.use((socket: Socket, next) => {
        // Skip auth if NEXTAUTH_SECRET is not configured
        if (!NEXTAUTH_SECRET) {
            next();
            return;
        }

        const { token } = socket.handshake.auth;

        if (!token) {
            // No token provided, continue without user
            next();
            return;
        }

        try {
            const decoded = jwt.verify(token, NEXTAUTH_SECRET, {
                algorithms: ['HS256'],
            }) as DecodedToken;

            socket.user = {
                id: decoded.id,
                email: decoded.email,
                name: decoded.name,
            };

            console.log(`[SOCKET AUTH] Authenticated user: ${decoded.email}`);
        } catch {
            // Token invalid, continue without user
            console.warn(`[SOCKET AUTH] Invalid token provided, continuing without auth`);
        }

        next();
    });
}
