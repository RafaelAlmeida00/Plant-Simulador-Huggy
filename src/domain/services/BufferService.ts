// src/domain/services/BufferService.ts

import { IBuffer, ICar, ILine, IShop } from "../../utils/shared";
import { Buffer } from "../models/Buffer";
import { logger } from "../../utils/logger";
import { BufferFactory } from "../factories/BufferFactory";

export class BufferService {
    private bufferFactory: BufferFactory;
    private carCompletionCallback: ((carId: string, completeAt: number, stationId: string) => void) | null = null;

    constructor(bufferFactory: BufferFactory) {
        this.bufferFactory = bufferFactory;
    }

    private get buffers(): Map<string, IBuffer> {
        return this.bufferFactory.buffers;
    }

    public setCarCompletionCallback(callback: (carId: string, completeAt: number, stationId: string) => void): void {
        this.carCompletionCallback = callback;
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

    public consumePartByModel(bufferId: string, model: string, simulatedTimestamp: number, stationId: string): ICar | null {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return null;

        // Find first part that matches the model
        const partIndex = buffer.cars.findIndex(car => car.model === model && car.isPart);
        if (partIndex === -1) return null;

        const [part] = buffer.cars.splice(partIndex, 1);
        buffer.currentCount--;
        this.updateBufferStatus(buffer);
        this.buffers.set(buffer.id, buffer);

        // Call the completion callback instead of directly using CarFactory
        if (this.carCompletionCallback) {
            this.carCompletionCallback(part.id, simulatedTimestamp, stationId);
        }

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
        // Reset the factory's buffers (clears and repopulates)
        this.bufferFactory.resetFactory();
        // Keep the same references (no need to reassign - same objects)
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

    /**
     * Restore buffer states for recovery
     * This updates buffer counts and status based on persisted state
     */
    public restoreBufferStates(bufferStates: Array<{
        bufferId: string;
        carIds: string[];
        currentCount: number;
        status: string;
    }>): void {
        for (const state of bufferStates) {
            const buffer = this.buffers.get(state.bufferId);
            if (buffer) {
                // Update buffer properties
                buffer.currentCount = state.currentCount;
                buffer.status = state.status as 'EMPTY' | 'AVAILABLE' | 'FULL';

                // Note: We don't restore actual car objects since they would need full reconstruction
                // The currentCount and status are sufficient for simulation continuity
                logger().debug(`[BufferService] Restored buffer ${state.bufferId}: count=${state.currentCount}, status=${state.status}`);
            } else {
                logger().warn(`[BufferService] Buffer ${state.bufferId} not found during recovery`);
            }
        }
        logger().info(`[BufferService] Restored ${bufferStates.length} buffer states for recovery`);
    }
}
