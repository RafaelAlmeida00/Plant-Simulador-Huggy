import { logger } from "../../utils/logger";
import { ICar, ICarShopLeadtime, ICarTrace, IStation } from "../../utils/shared";
import { Car } from "../models/Car";
import { BufferFactory } from "./BufferFactory";
import { getActiveFlowPlant, PlantFactory } from "./plantFactory";
import { StopLineFactory } from "./StopLineFactory";

export class CarFactory {

    private cars: Map<string, ICar> = new Map();
    private parts: Map<string, ICar> = new Map();
    private currentSequence: number = 0;
    private idCounter: number = 0;
    private partIdCounter: number = 0;
    private config = getActiveFlowPlant();
    private plantFactory: PlantFactory;
    private bufferFactory: BufferFactory;
    private stopLineFactory: StopLineFactory;
    private static readonly idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    private static readonly idCharsLen = 36;

    constructor(plantFactory?: PlantFactory, bufferFactory?: BufferFactory, stopLineFactory?: StopLineFactory) {
        this.plantFactory = plantFactory as PlantFactory;
        this.bufferFactory = bufferFactory as BufferFactory;
        this.stopLineFactory = stopLineFactory as StopLineFactory;
    }
    // Cache para evitar recalcular o número de linhas de nascimento a cada chamada
    private cachedStartLinesCount: number | null = null;

    public createRandomCar(currentSimulatorTime: number): Car {
        this.currentSequence++;

        const newCar = new Car({
            id: this.generateId(),
            sequenceNumber: this.currentSequence,
            model: this.getPlannedModel(),
            color: this.getRandomColor(),
            createdAt: currentSimulatorTime,
            hasDefect: Math.random() * 100 < (this.config?.DPHU ?? 0),
            inRework: false,
            trace: [],
            shopLeadtimes: [],
            defects: [],
            isPart: false,
            partName: undefined
        });
        logger().debug(`Carro criado: ID=${newCar.id}, Modelo=${newCar.model}`);
        this.cars.set(newCar.id, newCar);
        return newCar;
    }

    public createPart(currentSimulatorTime: number, partType: string, model: string): Car {
        this.currentSequence++;

        const newPart = new Car({
            id: this.generatePartId(partType),
            sequenceNumber: this.currentSequence,
            model: model ? model : this.getPlannedModel(),  // Peça herda modelo aleatório
            color: [],  // Peças não têm cor
            createdAt: currentSimulatorTime,
            hasDefect: false,  // Peças não têm defeito (simplificação)
            inRework: false,
            trace: [],
            shopLeadtimes: [],
            defects: [],
            isPart: true,
            partName: partType
        });
        logger().debug(`Peça criada: ID=${newPart.id}, Tipo=${partType}, Modelo=${newPart.model}`);
        this.parts.set(newPart.id, newPart);
        return newPart;
    }

    public createCarWithModel(currentSimulatorTime: number, model: string): Car {
        this.currentSequence++;

        const newCar = new Car({
            id: this.generateId(),
            sequenceNumber: this.currentSequence,
            model: model,
            color: this.getRandomColor(),
            createdAt: currentSimulatorTime,
            hasDefect: Math.random() * 100 < (this.config?.DPHU ?? 0),
            inRework: false,
            trace: [],
            shopLeadtimes: [],
            defects: [],
            isPart: false,
            partName: undefined
        });
        logger().debug(`Carro criado: ID=${newCar.id}, Modelo=${newCar.model}`);
        this.cars.set(newCar.id, newCar);

        return newCar;
    }

    private generateId(): string {
        return `Car${++this.idCounter}`;
    }
    private generatePartId(partType: string): string {
        return `PART-${partType}-${++this.partIdCounter}`;
    }

    private getPlannedModel(): string {
        if (this.cachedStartLinesCount == null) {
            this.cachedStartLinesCount = this.plantFactory.getStartStations().length;
        }

        const numStartLines = this.cachedStartLinesCount;
        const blockSize = numStartLines * (this.config?.MIX_ITEMS_PER_LINE || 10);
        const cycleSize = blockSize * this.config!.models.length;
        const positionInCycle = ((this.currentSequence - 1) % cycleSize);
        const modelIndex = Math.floor(positionInCycle / blockSize);

        return this.config!.models[modelIndex];
    }

    private getRandomColor(): string[] {
        const colors = this.config!.colors;
        const len = this.config!.colors.length;
        const color1 = colors[(Math.random() * len) | 0];

        if (Math.random() >= 0.15) {
            return [color1];
        }

        let color2 = colors[(Math.random() * len) | 0];
        while (color1 === color2) {
            color2 = colors[(Math.random() * len) | 0];
        }
        return [color1, color2];
    }

    //Public methods to access cars map
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

    public getCompletedCarsCount(): number {
        let count = 0;
        for (const car of this.cars.values()) {
            if (car.completedAt) {
                count++;
            }
        }
        return count;
    }

    public getDefectiveCarsCount(): number {
        let count = 0;
        for (const car of this.cars.values()) {
            if (car.hasDefect) {
                count++;
            }
        }
        return count;
    }

    public getCompletedCardByLineCount(lineId: string): number {
        let count = 0;
        for (const car of this.cars.values()) {
            if (car.trace.length === 0) continue;
            const lastTrace = car.trace[car.trace.length - 1]; {
                if (lastTrace.line === lineId && lastTrace.leave) {
                    count++;
                }
            }
        }
        return count;
    }

    public getCompletedCardByShopCount(shopId: string): number {
        let count = 0;
        for (const car of this.cars.values()) {
            if (car.trace.length === 0) continue;
            const lastTrace = car.trace[car.trace.length - 1]; {
                if (lastTrace.shop === shopId && lastTrace.leave) {
                    count++;
                }
            }
        }
        return count;
    }

    //Public methods to manipulate cars
    public moveCarToNextStation(bufferId: string, carId: string, stationId: string, nextStationId: string, timeTs: number): void {
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

        const prevStation = this.plantFactory.getById("station", stationId) as IStation;
        const nextStation = this.plantFactory.getById("station", nextStationId) as IStation;
        if (!prevStation) {
            logger().error(`Estação anterior não encontrada: ID=${stationId}`);
            return;
        }
        if (!nextStation) {
            logger().error(`Próxima estação não encontrada: ID=${nextStationId}`);
            return;
        }

        const existingTrace = car.trace.find(t => t.station === prevStation.id);
        if (existingTrace) {
            existingTrace.leave = timeTs;
        }

        if (!bufferId) {
            car.trace.push({
                shop: nextStation.shop,
                line: nextStation.line,
                station: nextStation.id,
                enter: timeTs
            });

            if (prevStation.isFirstStation) {
                car.shopLeadtimes.push({
                    shop: nextStation.shop,
                    enteredAt: timeTs,
                });
                car.shopLeadtimes.push({
                    shop: nextStation.shop,
                    line: nextStation.line,
                    enteredAt: timeTs,
                });
            }

            this.plantFactory.removeCarFromStation(stationId);
            this.plantFactory.addCarToStation(nextStationId, car);
        }
        if (bufferId) {
            let result = this.bufferFactory.addCarToBuffer(bufferId, car);
            if (!result) {
                this.stopLineFactory.startStop(timeTs, prevStation.shop, prevStation.line, prevStation.id, "NEXT_FULL", "PROPAGATION", "PROPAGATION");
                setTimeout(() => {
                    timeTs += 1000;
                    logger().info(`Buffer cheio ao mover carro ${carId} para o buffer ${bufferId}. Iniciando parada na estação ${prevStation.id} para liberar espaço.`);
                    const updatedPrevStation = this.plantFactory.getById("station", stationId) as IStation;
                    this.stopLineFactory.endStop(Number(updatedPrevStation.stopId), timeTs);
                    this.moveCarToNextStation(bufferId, carId, stationId, nextStationId, timeTs);
                }, 1000);
                return;
            }

            const existingShopLeadTime = car.shopLeadtimes.find(t => t.shop === prevStation.shop);
            if (existingShopLeadTime) {
                existingShopLeadTime.exitedAt = timeTs;
                existingShopLeadTime.leadtimeMs = timeTs - (existingShopLeadTime.enteredAt || car.createdAt);
            }

            const existingLineLeadTime = car.shopLeadtimes.find(t => t.line === prevStation.line);
            if (existingLineLeadTime && existingLineLeadTime !== existingShopLeadTime) {
                existingLineLeadTime.exitedAt = timeTs;
                existingLineLeadTime.leadtimeMs = timeTs - (existingLineLeadTime.enteredAt || car.createdAt);
            }

            this.plantFactory.removeCarFromStation(stationId);
        }

        if (isCar) {
            this.cars.set(carId, car);
        }
        if (!isCar) {
            this.parts.set(carId, car);
        }
    }

    public moverCarToFirstStation(carId: string, stationId: string, timeTs: number): void {
        let isCar = true;
        let car = this.cars.get(carId) as ICar;
        if (!car) {
            car = this.parts.get(carId) as ICar;
            let isCar = false;
            if (!car) {
                logger().error(`Carro/Peça não encontrado: ID=${carId}`);
                return;
            }
        };
        const station = this.plantFactory.getById("station", stationId) as IStation;
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
        this.plantFactory.addCarToStation(stationId, car);

    }


    public completeCar(carId: string, completeAt: number, stationId: string): void {
        const car = this.cars.get(carId);
        if (!car) return;
        car.completedAt = completeAt;
        this.plantFactory.removeCarFromStation(stationId);
        this.cars.set(carId, car);
    }

    public cleanCarsCompleted(): void {
        for (const [carId, car] of this.cars) {
            if (car.completedAt !== undefined || car.completedAt !== null) {
                this.cars.delete(carId);
            }
        }
    }

    public reset(): void {
        this.cars.clear();
        this.parts.clear();
        this.currentSequence = 0;
        this.idCounter = 0;
        this.partIdCounter = 0;
        this.cachedStartLinesCount = null;
    }

}