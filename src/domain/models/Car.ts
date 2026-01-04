export interface ICarTrace {
    shop: string;
    line: string;
    station: string;
    enter: number;
    leave?: number;
}

export interface ICarShopLeadtime {
    shop: string;
    enteredAt: number;
    exitedAt?: number;
    leadtimeMs?: number;
}

export interface ICarConfig {
    id: string;
    sequenceNumber: number;
    model: string;
    color: string[];
    createdAt: number;
    completedAt?: number;
    metadata?: Record<string, any>;
    trace: ICarTrace[];
    hasDefect: boolean;
    defects?: string[];
    inRework: boolean;
    reworkEnteredAt?: number;
    reworkCompletedAt?: number;
    shopLeadtimes: ICarShopLeadtime[];
    totalLeadtimeMs?: number;
    // Part Line fields
    isPart: boolean;
    partName?: string;
}

export interface ICar extends ICarConfig {
    addTrace(trace: ICarTrace): void;
    closeLastTrace(timestamp: number): void;
    addDefect(defectId: string): void;
    toggleRework(timestamp: number): void;
    addShopLeadtime(item: ICarShopLeadtime): void;
    complete(timestamp: number): void;
    // Part Line fields
    isPart: boolean;
    partName?: string;
}

export class Car implements ICar {
    public id: string;
    public sequenceNumber: number;
    public model: string;
    public color: string[];
    public createdAt: number;
    public completedAt?: number;
    public metadata?: Record<string, any>;
    public trace: ICarTrace[];
    public hasDefect: boolean;
    public defects: string[];
    public inRework: boolean;
    public reworkEnteredAt?: number;
    public reworkCompletedAt?: number;
    public shopLeadtimes: ICarShopLeadtime[];
    public totalLeadtimeMs?: number;
    // Part Line fields
    public isPart: boolean;
    public partName?: string;

    constructor(config: ICarConfig) {
        this.id = config.id;
        this.sequenceNumber = config.sequenceNumber;
        this.model = config.model;
        this.color = config.color;
        this.createdAt = config.createdAt;
        this.hasDefect = config.hasDefect;
        this.defects = config.defects || [];
        this.trace = config.trace || [];
        this.shopLeadtimes = config.shopLeadtimes || [];
        this.inRework = config.inRework || false;
        this.isPart = config.isPart || false;
        this.partName = config.partName;
    }

    public addTrace(trace: ICarTrace): void {
        this.trace.push(trace);
    }

    public closeLastTrace(timestamp: number): void {
        const len = this.trace.length;
        if (len > 0) {
            const last = this.trace[len - 1];
            if (!last.leave) {
                last.leave = timestamp;
            }
        }
    }

    public addDefect(defectId: string): void {
        this.defects.push(defectId);
        this.hasDefect = true;
    }

    public toggleRework(timestamp: number): void {
        this.inRework = !this.inRework;
        if (this.inRework) {
            this.reworkEnteredAt = timestamp;
            this.reworkCompletedAt = undefined;
        } else {
            this.reworkCompletedAt = timestamp;
        }
    }

    public addShopLeadtime(item: ICarShopLeadtime): void {
        this.shopLeadtimes.push(item);
    }

    public complete(timestamp: number): void {
        this.completedAt = timestamp;
        this.totalLeadtimeMs = timestamp - this.createdAt;
    }
}