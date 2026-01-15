// src/adapters/http/server.ts

import express, { Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import AppRouter from './router/router';
import { socketServer } from './websocket/SocketServer';
import { DatabaseFactory } from '../database/DatabaseFactory';
import HealthController from './controllers/HealthController';

// Swagger imports
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

export class Server {
    private app: express.Application;
    private httpServer: HttpServer;
    private port: number | string;
    private simulatorClock: any = null;

    constructor() {
        this.app = express();
        this.httpServer = createServer(this.app);
        this.port = process.env.PORT || 3001;
        this.initializeMiddlewares();
        this.initializeRoutes();
        this.initializeWebSocket();
        this.initializeSwagger();
        this.initializeAsyncApiDocs();
    }
    private initializeAsyncApiDocs() {
        // Serve a documentação AsyncAPI gerada em /api-docs-websocket
        const path = require('path');
        const docsPath = path.resolve(__dirname, 'output');
        this.app.use('/api-docs-websocket', express.static(docsPath));
    }

    private initializeMiddlewares() {
        // CORS - allow all origins for development
        this.app.use(cors({
            origin: ['http://localhost:3000', 'http://localhost:3001', 'https://simulador-ui.vercel.app'],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
        }));

        // Compression - compress responses > 1KB with level 6
        this.app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req: express.Request, res: express.Response) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));

        // Rate limiting - Global: 100 requests per minute
        const globalLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many requests, please try again later.' },
            skip: (req: Request) => req.path.startsWith('/api/health')
        });

        // Rate limiting - Write operations: 30 requests per minute
        const writeLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 30,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: 'Too many write requests, please try again later.' }
        });

        // Rate limiting - Health endpoint: 300 requests per minute (more permissive)
        const healthLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 300,
            standardHeaders: true,
            legacyHeaders: false
        });

        // Apply rate limiters
        this.app.use('/api/health', healthLimiter);
        this.app.use('/api', globalLimiter);

        // Apply write limiter to mutation endpoints
        this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
            if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
                return writeLimiter(req, res, next);
            }
            next();
        });

        // Body parsers
        this.app.use(express.json({ limit: '1mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    }

    private initializeSwagger() {
        // Carrega o arquivo swagger.yaml manualmente
        const fs = require('fs');
        const yaml = require('js-yaml');
        const swaggerPath = require('path').resolve(__dirname, 'swagger.yaml');
        const swaggerSpec = yaml.load(fs.readFileSync(swaggerPath, 'utf8'));
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    }

    private initializeRoutes() {
        this.app.use(AppRouter);
    }

    private initializeWebSocket() {
        socketServer.initialize(this.httpServer);
        console.log('[SERVER] WebSocket initialized');
    }

    public setSimulatorClock(clock: any): void {
        this.simulatorClock = clock;
        HealthController.setSimulatorClock(clock);
    }

    public getSocketServer() {
        return socketServer;
    }

    public getHttpServer(): HttpServer {
        return this.httpServer;
    }

    public async listen(): Promise<void> {
        // Inicializa o banco de dados
        try {
            await DatabaseFactory.getDatabase();
            console.log('[SERVER] Database connected');
        } catch (error) {
            console.error('[SERVER] Database connection failed:', error);
        }

        return new Promise((resolve) => {
            this.httpServer.listen(this.port, () => {
                console.log(`[SERVER] HTTP Server running on port ${this.port}`);
                console.log(`[SERVER] WebSocket available at ws://localhost:${this.port}`);
                console.log(`[SERVER] API available at http://localhost:${this.port}/api`);
                console.log(`[SERVER] API available at http://localhost:${this.port}/api-docs`);
                console.log(`[SERVER] API available at http://localhost:${this.port}/api-docs-websocket`);
                resolve();
            });
        });
    }

    public async close(): Promise<void> {
        socketServer.close();
        await DatabaseFactory.disconnect();
        
        return new Promise((resolve) => {
            this.httpServer.close(() => {
                console.log('[SERVER] Server closed');
                resolve();
            });
        });
    }
}
