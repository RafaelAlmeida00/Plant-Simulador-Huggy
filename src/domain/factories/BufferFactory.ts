
import { IBuffer, ICar, ILine, IShop } from "../../utils/shared";
import { getActiveFlowPlant } from "./plantFactory";
import { Buffer } from "../models/Buffer";
import { logger } from "../../utils/logger";
import { CarService } from "../services/CarService";

export class BufferFactory {
    public buffers: Map<string, IBuffer> = new Map();

    public resetFactory(): void {
        this.buffers.clear();
        this.createAllBuffers();
    }

    public createAllBuffers(): void {
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
}
