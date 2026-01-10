import { BufferStatus, BufferType, IBuffer, ICar } from "../../utils/shared";

export class Buffer implements IBuffer {
    public id: string;
    public betweenShopOrLine: "shop" | "line";
    public to: string;
    public from: string;
    public type: BufferType;
    public capacity: number;
    public currentCount: number;
    public cars: ICar[];
    public status?: BufferStatus;
    
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