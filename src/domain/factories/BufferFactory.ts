import { FlowPlant } from "../config/flowPlant";
import { Buffer, IBuffer } from "../models/Buffer";
import { ICar } from "../models/Car";
import { getActiveFlowPlant } from "./plantFactory";

export class BufferFactory {
    private buffers: Map<string, IBuffer> = new Map();

    constructor() {
        this.createAllBuffers();
    }

    private createAllBuffers(): void {
        const flowPlant = getActiveFlowPlant();
        const flowPlantShopsEntries: [string, any][] = Object.entries(flowPlant.shops);

        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries(shopConfig.lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName, lineConfig] = linesEntries[i] as [string, any];
                if (lineConfig.buffers) {
                    const buffersLen = lineConfig.buffers.length;
                    for (let j = 0; j < buffersLen; j++) {
                        const bufferConfig = lineConfig.buffers[j];
                        
                        // Check if this is a part line (has partType)
                        const isPartLine = !!lineConfig.partType;
                        const partType = lineConfig.partType;
                        
                        // =====================================================================
                        // BUFFER TYPE DETERMINATION:
                        // - Part Line WITH routes = intermediate part line → uses normal buffer
                        // - Part Line WITHOUT routes = final part line → uses Part Buffer
                        // - Car Line = always uses normal buffer
                        // =====================================================================
                        const hasRoutes = lineConfig.routes && lineConfig.routes.length > 0;
                        const isFinalPartBuffer = isPartLine && !hasRoutes;
                        
                        // Buffer ID format:
                        // - Final Part Line (no routes): {DestShop}-PARTS-{partType}
                        // - Intermediate Part Line (has routes): normal buffer format
                        // - Car Line: normal buffer format
                        const bufferId = isFinalPartBuffer 
                            ? `${bufferConfig.to.shop}-PARTS-${partType}`
                            : `${shopName}-${lineName}-to-${bufferConfig.to.shop}-${bufferConfig.to.line}`;
                        
                        const buffer = new Buffer({
                            id: bufferId,
                            betweenShopOrLine: shopName === bufferConfig.to.shop ? "line" : "shop",
                            from: `${shopName}-${lineName}`,
                            to: `${bufferConfig.to.shop}-${bufferConfig.to.line}`,
                            capacity: bufferConfig.capacity,
                            currentCount: 0,
                            cars: [],
                            type: isFinalPartBuffer ? "PART_BUFFER" : "BUFFER",
                            status: "EMPTY"
                        });
                        this.buffers.set(bufferId, buffer);
                    }
                }
            }

            if (shopConfig.reworkBuffer) {
                const reworkBufferId = `${shopName}-REWORK`;
                const reworkBuffer = new Buffer({
                    id: reworkBufferId,
                    betweenShopOrLine: "shop",
                    from: shopName,
                    to: shopName,
                    capacity: shopConfig.reworkBuffer,
                    currentCount: 0,
                    cars: [],
                    type: "REWORK_BUFFER",
                    status: "EMPTY"
                });
                this.buffers.set(reworkBufferId, reworkBuffer);
            }
        }
    }

    public getBuffersMap(): Map<string, IBuffer> {
        return this.buffers;
    }

    public getAllBuffers(): IBuffer[] {
        return Array.from(this.buffers.values());
    }

    public getAllBuffersByShop(shopName: string): IBuffer[] {
        const result: IBuffer[] = [];
        for (const buffer of this.buffers.values()) {
            if (buffer.from.startsWith(shopName) || buffer.to.startsWith(shopName)) {
                result.push(buffer);
            }
        }
        return result;
    }

    public getBuffer(bufferId: string): IBuffer | undefined {
        return this.buffers.get(bufferId);
    }

    public getAllCarsByBuffer(bufferId: string): ICar[] {
        const buffer = this.buffers.get(bufferId);
        return buffer ? buffer.cars : [];
    }

    public getCarByBuffer(bufferId: string, carId: string): ICar | undefined {
        const buffer = this.buffers.get(bufferId);
        return buffer?.cars.find(c => c.id === carId);
    }

    public addCarToBuffer(bufferId: string, car: ICar): boolean {
        const buffer = this.buffers.get(bufferId);
        if (!buffer) return false;
        if (buffer.currentCount >= buffer.capacity) return false;

        buffer.cars.push(car);
        buffer.currentCount++;
        this.updateBufferStatus(buffer);
        return true;
    }

    public removeCarFromBuffer(bufferId: string, carId: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer) return null;

        const index = buffer.cars.findIndex(c => c.id === carId);
        if (index === -1) return null;

        const [car] = buffer.cars.splice(index, 1);
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        return car;
    }

    public removeFirstCarFromBuffer(bufferId: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return null;

        const car = buffer.cars.shift()!;
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        return car;
    }

    /**
     * Finds a part buffer by part type within a shop
     * @param shopName Shop name
     * @param partType Part type (e.g., "DOOR", "ENGINE")
     * @returns Buffer ID if found, undefined otherwise
     */
    public findPartBuffer(shopName: string, partType: string): string | undefined {
        const bufferId = `${shopName}-PARTS-${partType}`;
        return this.buffers.has(bufferId) ? bufferId : undefined;
    }

    /**
     * Finds and removes a part from buffer that matches the car model
     * @param bufferId Buffer ID
     * @param model Car model to match
     * @returns The consumed part (car) or null if not found
     */
    public consumePartByModel(bufferId: string, model: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return null;

        // Find first part that matches the model
        const partIndex = buffer.cars.findIndex(car => car.model === model && car.isPart);
        if (partIndex === -1) return null;

        const [part] = buffer.cars.splice(partIndex, 1);
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        return part;
    }

    /**
     * Checks if a part buffer has a part available for a given model
     * @param bufferId Buffer ID
     * @param model Car model to match
     * @returns True if part is available
     */
    public hasPartForModel(bufferId: string, model: string): boolean {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return false;
        return buffer.cars.some(car => car.model === model && car.isPart);
    }

    /**
     * Gets all part buffers in a shop
     * @param shopName Shop name
     * @returns Array of part buffers
     */
    public getPartBuffersByShop(shopName: string): IBuffer[] {
        const result: IBuffer[] = [];
        for (const buffer of this.buffers.values()) {
            if (buffer.type === "PART_BUFFER" && buffer.id.startsWith(`${shopName}-PARTS-`)) {
                result.push(buffer);
            }
        }
        return result;
    }

    private updateBufferStatus(buffer: IBuffer): void {
        if (buffer.currentCount === 0) {
            buffer.status = "EMPTY";
        } else if (buffer.currentCount >= buffer.capacity) {
            buffer.status = "FULL";
        } else {
            buffer.status = "AVAILABLE";
        }
    }
}
