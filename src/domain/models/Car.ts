import { ICar, ICarShopLeadtime, ICarTrace } from "../../utils/shared";

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

    constructor(config: ICar) {
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
}