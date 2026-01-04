import { Car } from "../models/Car";

export class CarFactory {
    // Estado interno da Factory para garantir que a sequência incremente corretamente
    private currentSequence: number = 0;
    private idCounter: number = 0;
    private partIdCounter: number = 0;

    // Configurações estáticas para evitar alocações
    private static readonly models = ['P19', 'P20', 'P35'];
    private static readonly modelsLen = 3;
    private static readonly colors = ['Red', 'Blue', 'Green', 'Black', 'White', 'Silver', 'Yellow', 'Orange', 'Purple', 'Gray'];
    private static readonly colorsLen = 10;
    private static readonly idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    private static readonly idCharsLen = 36;

    /**
     * Cria um carro com dados aleatórios baseados nas regras de negócio
     * @param currentSimulatorTime O tempo atual do relógio do simulador (não Date.now())
     * @param dphu Target de defeitos por 100 unidades
     */
    public createRandomCar(currentSimulatorTime: number, dphu: number): Car {
        this.currentSequence++;

        return new Car({
            id: this.generateId(),
            sequenceNumber: this.currentSequence,
            model: this.getRandomModel(),
            color: this.getRandomColor(),
            createdAt: currentSimulatorTime,
            hasDefect: Math.random() * 100 < dphu,
            inRework: false,
            trace: [],
            shopLeadtimes: [],
            defects: [],
            isPart: false,
            partName: undefined
        });
    }

    /**
     * Cria uma peça (representada como Car) para uma Part Line
     * @param currentSimulatorTime O tempo atual do relógio do simulador
     * @param partType Tipo da peça (e.g., "DOOR", "ENGINE")
     */
    public createPart(currentSimulatorTime: number, partType: string): Car {
        this.currentSequence++;

        return new Car({
            id: this.generatePartId(partType),
            sequenceNumber: this.currentSequence,
            model: this.getRandomModel(),  // Peça herda modelo aleatório
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
    }

    /**
     * Cria um carro com um modelo específico (usado quando precisamos garantir match de peças)
     * @param currentSimulatorTime O tempo atual do relógio do simulador
     * @param dphu Target de defeitos por 100 unidades
     * @param model O modelo específico do carro
     */
    public createCarWithModel(currentSimulatorTime: number, dphu: number, model: string): Car {
        this.currentSequence++;

        return new Car({
            id: this.generateId(),
            sequenceNumber: this.currentSequence,
            model: model,
            color: this.getRandomColor(),
            createdAt: currentSimulatorTime,
            hasDefect: Math.random() * 100 < dphu,
            inRework: false,
            trace: [],
            shopLeadtimes: [],
            defects: [],
            isPart: false,
            partName: undefined
        });
    }

    private generateId(): string {
        // ID incremental com prefixo para unicidade - mais rápido que Math.random().toString(36)
        return `C${++this.idCounter}`;
    }

    private generatePartId(partType: string): string {
        // ID incremental para peças com prefixo do tipo de peça
        return `PART-${partType}-${++this.partIdCounter}`;
    }

    public getRandomModel(): string {
        return CarFactory.models[(Math.random() * CarFactory.modelsLen) | 0];
    }

    private getRandomColor(): string[] {
        const colors = CarFactory.colors;
        const len = CarFactory.colorsLen;
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