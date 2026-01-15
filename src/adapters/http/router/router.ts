// src/adapters/http/router/router.ts

import express from 'express';
import cookie from 'cookie-parser';
import cors from 'cors';

import ControllerRoot from '../controllers/controllerRoot';
import EventsController from '../controllers/EventsController';
import StopsController from '../controllers/StopsController';
import BuffersController from '../controllers/BuffersController';
import PlantStateController from '../controllers/PlantStateController';
import HealthController from '../controllers/HealthController';
import OEEController from '../controllers/OEEController';
import MTTRMTBFController from '../controllers/MTTRMTBFController';
import ConfigController from '../controllers/ConfigController';
import { authMiddleware } from '../middleware';

class AppRouter {
    router: express.Router;

    constructor() {
        this.router = express.Router();
        this.initializeGlobalMiddlewares();
        this.initializeRoutes();
    }

    initializeGlobalMiddlewares() {
        this.router.use(cookie());
        this.router.use(cors());
    }

    initializeRoutes() {
        // Root
        this.router.get('/', ControllerRoot.handle);

        // Events API - CRUD completo
        // GET routes use optional auth (work with or without token)
        this.router.get('/api/events', authMiddleware, (req, res) => EventsController.getAll(req, res));
        this.router.get('/api/events/:id', authMiddleware, (req, res) => EventsController.getById(req, res));
        // Write routes require auth
        this.router.post('/api/events', authMiddleware, (req, res) => EventsController.create(req, res));
        this.router.put('/api/events/:id', authMiddleware, (req, res) => EventsController.update(req, res));
        this.router.delete('/api/events/:id', authMiddleware, (req, res) => EventsController.delete(req, res));

        // Stops API - CRUD completo
        this.router.get('/api/stops', authMiddleware, (req, res) => StopsController.getAll(req, res));
        this.router.get('/api/stops/active', authMiddleware, (req, res) => StopsController.getActive(req, res));
        this.router.get('/api/stops/:id', authMiddleware, (req, res) => StopsController.getById(req, res));
        this.router.post('/api/stops', authMiddleware, (req, res) => StopsController.create(req, res));
        this.router.put('/api/stops/:id', authMiddleware, (req, res) => StopsController.update(req, res));
        this.router.delete('/api/stops/:id', authMiddleware, (req, res) => StopsController.delete(req, res));

        // Buffers API - CRUD completo
        this.router.get('/api/buffers', authMiddleware, (req, res) => BuffersController.getAll(req, res));
        this.router.get('/api/buffers/latest', authMiddleware, (req, res) => BuffersController.getLatest(req, res));
        this.router.get('/api/buffers/:id', authMiddleware, (req, res) => BuffersController.getById(req, res));
        this.router.post('/api/buffers', authMiddleware, (req, res) => BuffersController.create(req, res));
        this.router.put('/api/buffers/:id', authMiddleware, (req, res) => BuffersController.update(req, res));
        this.router.delete('/api/buffers/:id', authMiddleware, (req, res) => BuffersController.delete(req, res));

        // Plant State API - CRUD completo
        this.router.get('/api/plantstate', authMiddleware, (req, res) => PlantStateController.getAll(req, res));
        this.router.get('/api/plantstate/latest', authMiddleware, (req, res) => PlantStateController.getLatest(req, res));
        this.router.get('/api/plantstate/:id', authMiddleware, (req, res) => PlantStateController.getById(req, res));
        this.router.post('/api/plantstate', authMiddleware, (req, res) => PlantStateController.create(req, res));
        this.router.put('/api/plantstate/:id', authMiddleware, (req, res) => PlantStateController.update(req, res));
        this.router.delete('/api/plantstate/:id', authMiddleware, (req, res) => PlantStateController.delete(req, res));

        // Health API - No auth required
        this.router.get('/api/health', (req, res) => HealthController.handle(req, res));
        this.router.get('/api/health/detailed', (req, res) => HealthController.handleDetailed(req, res));

        // OEE API - CRUD completo
        this.router.get('/api/oee', authMiddleware, (req, res) => OEEController.getAll(req, res));
        this.router.get('/api/oee/:id', authMiddleware, (req, res) => OEEController.getById(req, res));
        this.router.post('/api/oee', authMiddleware, (req, res) => OEEController.create(req, res));
        this.router.put('/api/oee/:id', authMiddleware, (req, res) => OEEController.update(req, res));
        this.router.delete('/api/oee/:id', authMiddleware, (req, res) => OEEController.delete(req, res));

        // MTTR/MTBF API - CRUD completo
        this.router.get('/api/mttr-mtbf', authMiddleware, (req, res) => MTTRMTBFController.getAll(req, res));
        this.router.get('/api/mttr-mtbf/:id', authMiddleware, (req, res) => MTTRMTBFController.getById(req, res));
        this.router.post('/api/mttr-mtbf', authMiddleware, (req, res) => MTTRMTBFController.create(req, res));
        this.router.put('/api/mttr-mtbf/:id', authMiddleware, (req, res) => MTTRMTBFController.update(req, res));
        this.router.delete('/api/mttr-mtbf/:id', authMiddleware, (req, res) => MTTRMTBFController.delete(req, res));

        // Config API - CRUD completo para configuração da planta
        this.router.get('/api/config', authMiddleware, (req, res) => ConfigController.getAll(req, res));
        this.router.get('/api/config/default', authMiddleware, (req, res) => ConfigController.getDefault(req, res));
        this.router.get('/api/config/name/:name', authMiddleware, (req, res) => ConfigController.getByName(req, res));
        this.router.get('/api/config/:id', authMiddleware, (req, res) => ConfigController.getById(req, res));
        this.router.post('/api/config', authMiddleware, (req, res) => ConfigController.create(req, res));
        this.router.put('/api/config/:id/set-default', authMiddleware, (req, res) => ConfigController.setAsDefault(req, res));
        this.router.put('/api/config/:id', authMiddleware, (req, res) => ConfigController.update(req, res));
        this.router.delete('/api/config/:id', authMiddleware, (req, res) => ConfigController.delete(req, res));
    }

    getRouter() {
        return this.router;
    }
}

export default new AppRouter().getRouter();