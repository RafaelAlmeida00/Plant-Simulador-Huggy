// src/domain/services/ServiceLocator.ts

import { PlantService } from "./PlantService";
import { StopLineService } from "./StopLineService";
import { BufferService } from "./BufferService";
import { CarService } from "./CarService";
import { OEEService } from "./OEEService";
import { MTTRMTBFService } from "./MTTRMTBFService";
import { loadDefaultPlantConfig, PlantFactory } from "../factories/plantFactory";
import { CarFactory } from "../factories/carFactory";
import { BufferFactory } from "../factories/BufferFactory";
import { OEEFactory } from "../factories/OEEFactory";
import { MTTRMTBFFactory } from "../factories/MTTRMTBFFactory";
import { StopLineFactory } from "../factories/StopLineFactory";
import { logger } from "../../utils/logger";

/**
 * ServiceLocator manages all domain services and factories.
 *
 * This class supports two modes:
 * 1. Static mode (legacy): Call ServiceLocator.initialize() and use static getters
 * 2. Instance mode (session-based): Create new ServiceLocator(sessionId) for isolated instances
 *
 * For Worker Thread sessions, use instance mode to ensure proper session isolation.
 */
export class ServiceLocator {
    // ==========================================================================
    // INSTANCE MEMBERS (for session-based mode)
    // ==========================================================================
    private readonly sessionId: string;
    private _initialized: boolean = false;

    // Services (instance)
    private plantService!: PlantService;
    private stopLineService!: StopLineService;
    private bufferService!: BufferService;
    private carService!: CarService;
    private oeeService!: OEEService;
    private mttrMtbfService!: MTTRMTBFService;

    // Factories (instance)
    private plantFactory!: PlantFactory;
    private stopLineFactory!: StopLineFactory;
    private carFactory!: CarFactory;
    private bufferFactory!: BufferFactory;
    private oeeFactory!: OEEFactory;
    private mttrMtbfFactory!: MTTRMTBFFactory;

    // ==========================================================================
    // STATIC MEMBERS (for legacy/singleton mode)
    // ==========================================================================
    private static _instance: ServiceLocator | null = null;

    /**
     * Create a new ServiceLocator instance for a session.
     * @param sessionId - Unique identifier for the session (used for logging)
     */
    constructor(sessionId: string = 'default') {
        this.sessionId = sessionId;
    }

    /**
     * Get the session ID for this ServiceLocator instance.
     */
    public getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Initialize this ServiceLocator instance.
     * Creates all factories and services for the session.
     */
    public async initializeInstance(): Promise<void> {
        if (this._initialized) {
            logger().warn(`[ServiceLocator:${this.sessionId}] Already initialized`);
            return;
        }

        logger().debug(`[ServiceLocator:${this.sessionId}] Starting initialization...`);
        await loadDefaultPlantConfig();

        logger().debug(`[ServiceLocator:${this.sessionId}] Creating factories...`);
        this.plantFactory = new PlantFactory();
        this.carFactory = new CarFactory();
        this.bufferFactory = new BufferFactory();
        this.oeeFactory = new OEEFactory();
        this.mttrMtbfFactory = new MTTRMTBFFactory();
        this.stopLineFactory = new StopLineFactory();

        logger().debug(`[ServiceLocator:${this.sessionId}] Populating factory maps...`);

        this.plantFactory.createAllShops();
        logger().debug(`[ServiceLocator:${this.sessionId}] PlantFactory shops: ${this.plantFactory.shops.size}, lines: ${this.plantFactory.lines.size}, stations: ${this.plantFactory.stations.size}`);

        this.bufferFactory.createAllBuffers();
        logger().debug(`[ServiceLocator:${this.sessionId}] BufferFactory buffers: ${this.bufferFactory.buffers.size}`);

        this.stopLineFactory.createPlannedStops();
        this.stopLineFactory.createRandomStops();
        logger().debug(`[ServiceLocator:${this.sessionId}] StopLineFactory stops: ${this.stopLineFactory.stopsMap.size}`);

        logger().debug(`[ServiceLocator:${this.sessionId}] Creating services...`);

        this.plantService = new PlantService(this.plantFactory);
        logger().debug(`[ServiceLocator:${this.sessionId}] PlantService created. Shops: ${this.plantService.getShops().size}`);

        this.oeeFactory.setPlantService(this.plantService);
        this.carFactory.setPlantService(this.plantService);

        this.stopLineService = new StopLineService(this.plantService, this.stopLineFactory);
        logger().debug(`[ServiceLocator:${this.sessionId}] StopLineService created. Stops: ${this.stopLineService.getStops().size}`);

        this.bufferService = new BufferService(this.bufferFactory);
        logger().debug(`[ServiceLocator:${this.sessionId}] BufferService created. Buffers: ${this.bufferService.getBuffers().size}`);

        logger().debug(`[ServiceLocator:${this.sessionId}] Creating CarService...`);
        this.carService = new CarService(this.plantService, this.bufferService, this.carFactory);
        this.oeeFactory.setCarService(this.carService);

        logger().debug(`[ServiceLocator:${this.sessionId}] Creating OEEService...`);
        this.oeeService = new OEEService(this.oeeFactory, this.carService, this.plantService);

        logger().debug(`[ServiceLocator:${this.sessionId}] Creating MTTRMTBFService...`);
        this.mttrMtbfService = new MTTRMTBFService(this.mttrMtbfFactory);

        this._initialized = true;
        logger().debug(`[ServiceLocator:${this.sessionId}] Initialization complete!`);
    }

    // ==========================================================================
    // INSTANCE GETTERS (for session-based mode)
    // ==========================================================================
    public getPlantServiceInstance(): PlantService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.plantService;
    }

    public getStopLineServiceInstance(): StopLineService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.stopLineService;
    }

    public getBufferServiceInstance(): BufferService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.bufferService;
    }

    public getCarServiceInstance(): CarService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.carService;
    }

    public getOEEServiceInstance(): OEEService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.oeeService;
    }

    public getMTTRMTBFServiceInstance(): MTTRMTBFService {
        if (!this._initialized) {
            throw new Error(`ServiceLocator:${this.sessionId} not initialized. Call initializeInstance() first.`);
        }
        return this.mttrMtbfService;
    }

    public isInstanceInitialized(): boolean {
        return this._initialized;
    }

    // ==========================================================================
    // STATIC METHODS (for legacy/singleton mode - backwards compatible)
    // ==========================================================================

    /**
     * Initialize the static/singleton ServiceLocator.
     * This is the legacy method for backwards compatibility.
     */
    public static async initialize(): Promise<void> {
        if (!ServiceLocator._instance) {
            ServiceLocator._instance = new ServiceLocator('default');
        }
        await ServiceLocator._instance.initializeInstance();
    }

    public static getPlantService(): PlantService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.plantService;
    }

    public static getStopLineService(): StopLineService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.stopLineService;
    }

    public static getBufferService(): BufferService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.bufferService;
    }

    public static getCarService(): CarService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.carService;
    }

    public static getOEEService(): OEEService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.oeeService;
    }

    public static getMTTRMTBFService(): MTTRMTBFService {
        if (!ServiceLocator._instance || !ServiceLocator._instance._initialized) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return ServiceLocator._instance.mttrMtbfService;
    }

    public static isInitialized(): boolean {
        return ServiceLocator._instance !== null && ServiceLocator._instance._initialized;
    }

    /**
     * Get the static instance (for legacy code that needs the instance).
     */
    public static getInstance(): ServiceLocator | null {
        return ServiceLocator._instance;
    }

    /**
     * Reset the static instance (useful for testing).
     */
    public static resetInstance(): void {
        ServiceLocator._instance = null;
    }
}
