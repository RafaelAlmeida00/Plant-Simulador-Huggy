// src/adapters/http/server.ts

import express, { Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
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
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
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
