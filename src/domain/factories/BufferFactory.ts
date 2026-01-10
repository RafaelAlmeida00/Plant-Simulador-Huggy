
import { IBuffer, ICar, ILine, IShop } from "../../utils/shared";
import { getActiveFlowPlant } from "./plantFactory";
import { Buffer } from "../models/Buffer";
import { logger } from "../../utils/logger";

export class BufferFactory {
    private buffers: Map<string, IBuffer> = new Map();

    private createAllBuffers(): void {
        const flowPlant = getActiveFlowPlant();
        const flowPlantShopsEntries: [string, IShop][] = Object.entries(flowPlant.shops);

        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries: [string, ILine][] = Object.entries(shopConfig.lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName, lineConfig]: [string, ILine] = linesEntries[i] as [string, any];
                if (lineConfig.buffers) {
                    const buffersLen = lineConfig.buffers.length;
                    for (let j = 0; j < buffersLen; j++) {

                        const bufferConfig = lineConfig.buffers[j];
                        const isPartLine = !!lineConfig.partType;
                        const partType = lineConfig.partType;
                        const hasRoutes = lineConfig.routes && lineConfig.routes.length > 0;
                        const isFinalPartBuffer = isPartLine && !hasRoutes;

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

    public getBuffers(): Map<string, IBuffer> {
        return this.buffers;
    }

    public getEmptyBuffers(): Map<string, IBuffer> {
        const emptyBuffers = new Map<string, IBuffer>();
        for (const [bufferId, buffer] of this.buffers.entries()) {
            if (buffer.status === "EMPTY") {
                emptyBuffers.set(bufferId, buffer);
            }
        }
        return emptyBuffers;
    }

    public getFullBuffers(): Map<string, IBuffer> {
        const fullBuffers = new Map<string, IBuffer>();
        for (const [bufferId, buffer] of this.buffers.entries()) {
            if (buffer.status === "FULL") {
                fullBuffers.set(bufferId, buffer);
            }
        }
        return fullBuffers;
    }

    public getAvailableBuffers(): Map<string, IBuffer> {
        const availableBuffers = new Map<string, IBuffer>();
        for (const [bufferId, buffer] of this.buffers.entries()) {
            if (buffer.status === "AVAILABLE") {
                availableBuffers.set(bufferId, buffer);
            }
        }
        return availableBuffers;
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

    public getBufferByFromTo(from: string, to: string): IBuffer | undefined {
        for (const buffer of this.buffers.values()) {
            if (buffer.from === from && buffer.to === to) {
                return buffer;
            }
        }
        for (const buffer of this.buffers.values()) {
            if (buffer.from === from) {
                return buffer;
            }
        }
        return undefined;
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
        this.buffers.set(buffer.id, buffer);
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
        this.buffers.set(buffer.id, buffer);
        return car;
    }

    public removeFirstCarFromBuffer(bufferId: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return null;

        const car = buffer.cars.shift()!;
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        this.buffers.set(buffer.id, buffer);
        return car;
    }

    public findPartBuffer(shopName: string, partType: string): string | undefined {
        const bufferId = `${shopName}-PARTS-${partType}`;
        return this.buffers.has(bufferId) ? bufferId : undefined;
    }

    public consumePartByModel(bufferId: string, model: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return null;

        // Find first part that matches the model
        const partIndex = buffer.cars.findIndex(car => car.model === model && car.isPart);
        if (partIndex === -1) return null;

        const [part] = buffer.cars.splice(partIndex, 1);
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        this.buffers.set(buffer.id, buffer);
        return part;
    }

    public hasPartForModel(bufferId: string, model: string): boolean {
        const buffer = this.buffers.get(bufferId) as IBuffer;
        if (!buffer || buffer.cars.length === 0) return false;
        return buffer.cars.some((car: ICar) => car.model === model && car.isPart);
    }

    public getPartBuffersByShop(shopName: string): IBuffer[] {
        const result: IBuffer[] = [];
        for (const buffer of this.buffers.values()) {
            if (buffer.type === "PART_BUFFER" && buffer.id.startsWith(`${shopName}-PARTS-`)) {
                result.push(buffer);
            }
        }
        return result;
    }

    public resetBuffers(): void {
        this.buffers.clear();
        this.createAllBuffers();
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
