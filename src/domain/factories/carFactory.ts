import { logger } from "../../utils/logger";
import { ICar, ICarShopLeadtime, ICarTrace, ILine, IShop, IStation } from "../../utils/shared";
import { Car } from "../models/Car";
import { BufferService } from "../services/BufferService";
import { PlantService } from "../services/PlantService";
import { getActiveFlowPlant, PlantFactory } from "./plantFactory";

export class CarFactory {

    private config = getActiveFlowPlant();
    public cars: Map<string, ICar> = new Map();
    public parts: Map<string, ICar> = new Map();
    public currentSequence: number = 0;
    private idCounter: number = 0;
    private partIdCounter: number = 0;
    private plantService: PlantService = null as any;
    private static readonly idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    private static readonly idCharsLen = 36;

    public setPlantService(plantService: PlantService): void {
        this.plantService = plantService;
    }

    public cleanCarsCompleted(): void {
        for (const [carId, car] of this.cars) {
            if (car.completedAt !== undefined && car.completedAt !== null) {
                this.cars.delete(carId);
            }
        }
        for (const [carId, car] of this.parts) {
            if (car.completedAt !== undefined && car.completedAt !== null) {
                this.parts.delete(carId);
            }
        }
    }

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
            this.cachedStartLinesCount = this.plantService.getStartStations().length;
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

}