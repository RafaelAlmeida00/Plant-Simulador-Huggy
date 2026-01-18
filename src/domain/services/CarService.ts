// src/domain/services/CarService.ts

import { logger } from "../../utils/logger";
import { ICar, ICarShopLeadtime, ICarTrace, ILine, IShop, IStation } from "../../utils/shared";
import { CarFactory } from "../factories/carFactory";
import { getActiveFlowPlant } from "../factories/plantFactory";
import { Car } from "../models/Car";
import { BufferService } from "./BufferService";
import { PlantService } from "./PlantService";

export class CarService {

    private config = getActiveFlowPlant();
    private plantService: PlantService;
    private bufferService: BufferService;
    private static readonly idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    private static readonly idCharsLen = 36;
    private carFactory: CarFactory;

    constructor(plantService: PlantService, bufferService: BufferService, carFactory: CarFactory) {
        this.plantService = plantService;
        this.bufferService = bufferService;
        this.carFactory = carFactory;
        this.bufferService.setCarCompletionCallback((carId, completeAt, stationId) => {
            this.completeCar(carId, completeAt, stationId);
        });
    }

    private get cars(): Map<string, ICar> {
        return this.carFactory.cars;
    }

    private get parts(): Map<string, ICar> {
        return this.carFactory.parts;
    }

    private get currentSequence(): number {
        return this.carFactory.currentSequence;
    }

    public createRandomCar(currentTime: number): ICar {
        return this.carFactory.createRandomCar(currentTime);
    } 
    public createPart(currentTime: number, partType: string, model: string): ICar {
        return this.carFactory.createPart(currentTime, partType, model);
    }

    public createCarWithModel(currentTime: number, model: string): ICar {
        return this.carFactory.createCarWithModel(currentTime, model);
    }

    public getCarById(id: string): ICar | undefined {
        return this.cars.get(id);
    }

    public getPartById(id: string): ICar | undefined {
        return this.parts.get(id);
    }

    public getAllCars(): Map<string, ICar> {
        return this.cars
    }

    public getAllParts(): Map<string, ICar> {
        return this.parts
    }

    public getCarsCount(): number {
        return this.cars.size;
    }

    public getPartsCount(): number {
        return this.parts.size;
    }

    public getCurrentSequence(): number {
        return this.currentSequence;
    }

    /**
     * O(1) - Uses pre-computed counter instead of O(n) iteration
     */
    public getCompletedCarsCount(): number {
        return this.carFactory.completedCount;
    }

    /**
     * O(1) - Uses pre-computed counter instead of O(n) iteration
     */
    public getDefectiveCarsCount(): number {
        return this.carFactory.defectiveCount;
    }

    /**
     * O(1) - Uses pre-computed counter instead of O(n*m) iteration
     */
    public getCompletedCardByLineCount(line: ILine): number {
        if (!line.id || !line.shop) {
            return 0;
        }
        const lineName = line.id.split("-")[1];
        return this.carFactory.getCompletedByLineCount(line.shop, lineName);
    }

    /**
     * O(1) - Uses pre-computed counter instead of O(n*m) iteration
     */
    public getCompletedCardByShopCount(shop: IShop): number {
        if (!shop || !shop.name) {
            return 0;
        }
        return this.carFactory.getCompletedByShopCount(shop.name);
    }

    public moveCarToNextStation(carId: string, currentStationId: string, nextStationId: string, timeTs: number): void {
        let isCar = true;
        let car = this.cars.get(carId) as ICar;
        if (!car) {
            car = this.parts.get(carId) as ICar;
            isCar = false;
            if (!car) {
                logger().error(`Car/Part not found: ID=${carId}`);
                return;
            }
        }

        const currentStation = this.plantService.getById("station", currentStationId) as IStation;
        const nextStation = this.plantService.getById("station", nextStationId) as IStation;

        if (!currentStation) {
            logger().error(`Current station not found: ID=${currentStationId}`);
            return;
        }
        if (!nextStation) {
            logger().error(`Next station not found: ID=${nextStationId}`);
            return;
        }

        const existingTrace = car.trace.find(t => t.station === currentStation.id);
        if (existingTrace) {
            existingTrace.leave = timeTs;
        }

        car.trace.push({
            shop: nextStation.shop,
            line: nextStation.line,
            station: nextStation.id,
            enter: timeTs
        });

        // Note: shopLeadtimes are created in moverCarToFirstStation when car enters the line
        // No need to duplicate here when moving from first station to next

        this.plantService.removeCarFromStation(currentStationId);
        this.plantService.addCarToStation(nextStationId, car);

        if (isCar) {
            this.cars.set(carId, car);
        } else {
            this.parts.set(carId, car);
        }

        logger().debug(`✓ Car ${carId} moved: ${currentStationId} → ${nextStationId}`);
    }

    public moverCarToFirstStation(carId: string, stationId: string, timeTs: number): void {
        let isCar = true;
        let car = this.cars.get(carId) as ICar;
        if (!car) {
            car = this.parts.get(carId) as ICar;
            isCar = false;
            if (!car) {
                logger().error(`Carro/Peça não encontrado: ID=${carId}`);
                return;
            }
        }
        const station = this.plantService.getById("station", stationId) as IStation;
        if (!station) {
            logger().error(`Estação não encontrada: ID=${stationId}`);
            return;
        }
        car.trace.push({
            shop: station.id.split('-')[0],
            line: station.id.split('-')[1],
            station: station.id,
            enter: timeTs
        });
        car.shopLeadtimes.push({
            shop: station.shop,
            enteredAt: timeTs,
        });
        car.shopLeadtimes.push({
            shop: station.shop,
            line: station.line,
            enteredAt: timeTs,
        });

        if (isCar) {
            this.cars.set(carId, car);
        }
        if (!isCar) {
            this.parts.set(carId, car);
        }
        this.plantService.addCarToStation(stationId, car);

    }

    public exitStationToBuffer(
        carId: string,
        stationId: string,
        bufferId: string,
        timeTs: number
    ): boolean {
        let isCar = true;
        let car = this.cars.get(carId) as ICar;
        if (!car) {
            car = this.parts.get(carId) as ICar;
            isCar = false;
            if (!car) {
                logger().error(`Car/Part not found: ID=${carId}`);
                return false;
            }
        }

        const station = this.plantService.getById("station", stationId) as IStation;
        if (!station) {
            logger().error(`Station not found: ID=${stationId}`);
            return false;
        }

        const trace = car.trace?.find(t => t.station === station.id);
        if (trace) {
            trace.leave = timeTs;
        }

        const existingShopLeadTime = car.shopLeadtimes.find(
            t => t.shop === station.shop && !t.exitedAt && !t.line
        );
        if (existingShopLeadTime) {
            existingShopLeadTime.exitedAt = timeTs;
            existingShopLeadTime.leadtimeMs = timeTs - (existingShopLeadTime.enteredAt || car.createdAt);
            // Increment shop exit counter - O(1) tracking
            this.carFactory.incrementShopExit(station.shop);
        }

        const existingLineLeadTime = car.shopLeadtimes.find(
            t => t.shop === station.shop && t.line === station.line && !t.exitedAt
        );
        if (existingLineLeadTime) {
            existingLineLeadTime.exitedAt = timeTs;
            existingLineLeadTime.leadtimeMs = timeTs - (existingLineLeadTime.enteredAt || car.createdAt);
            // Increment line exit counter - O(1) tracking
            this.carFactory.incrementLineExit(station.shop, station.line);
        }

        const success = this.bufferService.addCarToBuffer(bufferId, car);
        if (!success) {
            logger().error(`Failed to add car ${carId} to buffer ${bufferId}`);
            return false;
        }

        this.plantService.removeCarFromStation(stationId);

        if (isCar) {
            this.cars.set(carId, car);
        } else {
            this.parts.set(carId, car);
        }

        logger().debug(`✓ Car ${carId} exited station ${stationId} to buffer ${bufferId}`);
        return true;
    }

    public enterStationFromBuffer(
        bufferId: string,
        carId: string | null,
        stationId: string,
        timeTs: number
    ): ICar | null {
        const station = this.plantService.getById("station", stationId) as IStation;
        if (!station) {
            logger().error(`Station not found: ID=${stationId}`);
            return null;
        }

        let car: ICar | null = null;
        if (carId) {
            car = this.bufferService.removeCarFromBuffer(bufferId, carId);
        } else {
            car = this.bufferService.removeFirstCarFromBuffer(bufferId);
        }

        if (!car) {
            logger().debug(`No car available in buffer ${bufferId}`);
            return null;
        }

        car.trace.push({
            shop: station.shop,
            line: station.line,
            station: station.id,
            enter: timeTs
        });

        car.shopLeadtimes.push({
            shop: station.shop,
            enteredAt: timeTs,
        });

        car.shopLeadtimes.push({
            shop: station.shop,
            line: station.line,
            enteredAt: timeTs,
        });

        this.plantService.addCarToStation(stationId, car);

        const isCar = !car.isPart;
        if (isCar) {
            this.cars.set(car.id, car);
        } else {
            this.parts.set(car.id, car);
        }

        logger().debug(`✓ Car ${car.id} entered station ${stationId} from buffer ${bufferId}`);
        return car;
    }

    public completeCar(carId: string, completeAt: number, stationId: string): void {
        const car = this.cars.get(carId);
        if (!car) return;
        car.completedAt = completeAt;

        // Increment completed counter - O(1) tracking
        // stationId format: "SHOP-LINE-STATION"
        const [shop, line] = stationId.split('-');
        this.carFactory.incrementCompleted(shop, line);

        this.plantService.removeCarFromStation(stationId);
        this.cars.set(carId, car);
    }

    public cleanCarsCompleted(): void {
        this.carFactory.cleanCarsCompleted();
    }

}
