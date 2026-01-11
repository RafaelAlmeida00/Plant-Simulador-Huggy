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

export class ServiceLocator {
    // Services
    private static plantService: PlantService;
    private static stopLineService: StopLineService;
    private static bufferService: BufferService;
    private static carService: CarService;
    private static oeeService: OEEService;
    private static mttrMtbfService: MTTRMTBFService;

    // Factories (gerenciadores de dados)
    private static plantFactory: PlantFactory;
    private static stopLineFactory: StopLineFactory;
    private static carFactory: CarFactory;
    private static bufferFactory: BufferFactory;
    private static oeeFactory: OEEFactory;
    private static mttrMtbfFactory: MTTRMTBFFactory;

    public static async initialize(): Promise<void> {
        logger().debug('[ServiceLocator] Starting initialization...');
        await loadDefaultPlantConfig();

        logger().debug('[ServiceLocator] Creating factories...');
        this.plantFactory = new PlantFactory();
        this.carFactory = new CarFactory();
        this.bufferFactory = new BufferFactory();
        this.oeeFactory = new OEEFactory();
        this.mttrMtbfFactory = new MTTRMTBFFactory();
        this.stopLineFactory = new StopLineFactory();

        logger().debug('[ServiceLocator] Populating factory maps...');

        this.plantFactory.createAllShops();
        logger().debug(`[ServiceLocator] PlantFactory shops: ${this.plantFactory.shops.size}, lines: ${this.plantFactory.lines.size}, stations: ${this.plantFactory.stations.size}`);

        this.bufferFactory.createAllBuffers();
        logger().debug(`[ServiceLocator] BufferFactory buffers: ${this.bufferFactory.buffers.size}`);

        this.stopLineFactory.createPlannedStops();
        this.stopLineFactory.createRandomStops();
        logger().debug(`[ServiceLocator] StopLineFactory stops: ${this.stopLineFactory.stopsMap.size}`);

        logger().debug('[ServiceLocator] Creating services...');

        this.plantService = new PlantService(this.plantFactory);
        logger().debug(`[ServiceLocator] PlantService created. Shops: ${this.plantService.getShops().size}`);

        this.oeeFactory.setPlantService(this.plantService);
        this.carFactory.setPlantService(this.plantService);

        this.stopLineService = new StopLineService(this.plantService, this.stopLineFactory);
        logger().debug(`[ServiceLocator] StopLineService created. Stops: ${this.stopLineService.getStops().size}`);

        this.bufferService = new BufferService(this.bufferFactory);
        logger().debug(`[ServiceLocator] BufferService created. Buffers: ${this.bufferService.getBuffers().size}`);

        logger().debug('[ServiceLocator] Creating CarService...');
        this.carService = new CarService(this.plantService, this.bufferService, this.carFactory);
        this.oeeFactory.setCarService(this.carService);

        logger().debug('[ServiceLocator] Creating OEEService...');
        this.oeeService = new OEEService(this.oeeFactory, this.carService, this.plantService);

        logger().debug('[ServiceLocator] Creating MTTRMTBFService...');
        this.mttrMtbfService = new MTTRMTBFService(this.mttrMtbfFactory);

        logger().debug('[ServiceLocator] Initialization complete!');
    }

    public static getPlantService(): PlantService {
        if (!this.plantService) {
            throw new Error('DEBUG 5 ServiceLocator not initialized. Call initialize() first.');
        }
        return this.plantService;
    }

    public static getStopLineService(): StopLineService {
        if (!this.stopLineService) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return this.stopLineService;
    }

    public static getBufferService(): BufferService {
        if (!this.bufferService) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return this.bufferService;
    }

    public static getCarService(): CarService {
        if (!this.carService) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return this.carService;
    }

    public static getOEEService(): OEEService {
        if (!this.oeeService) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return this.oeeService;
    }

    public static getMTTRMTBFService(): MTTRMTBFService {
        if (!this.mttrMtbfService) {
            throw new Error('ServiceLocator not initialized. Call initialize() first.');
        }
        return this.mttrMtbfService;
    }

    public static isInitialized(): boolean {
        return this.plantService !== undefined &&
            this.stopLineService !== undefined &&
            this.bufferService !== undefined &&
            this.carService !== undefined &&
            this.oeeService !== undefined &&
            this.mttrMtbfService !== undefined;
    }
}
