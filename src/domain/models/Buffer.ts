import { ICar } from "./Car";

export interface IBuffer {
    id: string;
    betweenShopOrLine: "shop" | "line";
    to: string;
    from: string;
    capacity: number;
    currentCount: number;
    cars: ICar[];
    type: "BUFFER" | "REWORK_BUFFER" | "PART_BUFFER";
    status?: "EMPTY" | "AVAILABLE" | "FULL";
}

export class Buffer implements IBuffer {
    public id: string;
    public betweenShopOrLine: "shop" | "line";
    public to: string;
    public from: string;
    public type: "BUFFER" | "REWORK_BUFFER" | "PART_BUFFER";
    public capacity: number;
    public currentCount: number;
    public cars: ICar[];
    public status?: "EMPTY" | "AVAILABLE" | "FULL";

    constructor(config: IBuffer) {
        this.id = config.id;
        this.betweenShopOrLine = config.betweenShopOrLine;
        this.to = config.to;
        this.from = config.from;
        this.capacity = config.capacity;
        this.currentCount = config.currentCount;
        this.cars = config.cars;
        this.type = config.type;
        this.status = config.status;
    }
    
}