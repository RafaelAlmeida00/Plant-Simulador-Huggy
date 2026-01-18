import { ILine, IShop, IStation, IStopLine, StopCategory, StopSeverity, StopType } from "../../utils/shared";
import { StopLine } from "../models/StopLine";
import { getActiveFlowPlant, PlantFactory } from "./plantFactory";
import { logger } from "../../utils/logger";

export class StopLineFactory {
    public stopsMap: Map<string, IStopLine> = new Map();
    public stopIdCounter: number = 0;
    private flowPlant = getActiveFlowPlant();
    private static readonly TWO_HOURS_MS: number = 2 * 60 * 60 * 1000;
    private static readonly severityRanges = {
        LOW: { min: 1, max: 5 },
        MEDIUM: { min: 5, max: 10 },
        HIGH: { min: 10, max: 60 }
    };

    private getProductionTimeMinutes(shopName: string, lineConfig: any): number {
        const shiftStart = lineConfig.takt.shiftStart;
        const shiftEnd = lineConfig.takt.shiftEnd;
        const startHour = parseInt(shiftStart.substring(0, 2), 10);
        const startMinute = parseInt(shiftStart.substring(3, 5), 10);
        const endHour = parseInt(shiftEnd.substring(0, 2), 10);
        const endMinute = parseInt(shiftEnd.substring(3, 5), 10);

        let totalMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
        if (totalMinutes < 0) totalMinutes += 1440;

        const plannedStops = this.flowPlant.plannedStops;
        if (plannedStops) {
            const len = plannedStops.length;
            for (let i = 0; i < len; i++) {
                const stop = plannedStops[i];
                if (!stop.affectsShops || stop.affectsShops.includes(shopName)) {
                    totalMinutes -= stop.durationMn;
                }
            }
        }

        return totalMinutes;
    }

    public createPlannedStops(): void {
        const plannedStops = this.flowPlant.plannedStops;
        if (!plannedStops) return;

        const now = new Date();
        const todayBaseMs = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            0,
            0,
            0,
            0
        );
        const currentDay = new Date(todayBaseMs).getDay(); // 0 (Domingo) a 6 (Sábado)
        const flowPlantShopsEntries: [string, IShop][] = Object.entries(this.flowPlant.shops);

        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries(shopConfig.lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName] = linesEntries[i];
                const plannedLen = plannedStops.length;
                for (let j = 0; j < plannedLen; j++) {
                    const stop = plannedStops[j];
                    if (stop.affectsShops && !stop.affectsShops.includes(shopName)) continue;
                    if (stop.daysOfWeek && !stop.daysOfWeek.includes(currentDay)) continue;

                    const startTime = stop.startTime;
                    const hour = parseInt(startTime.substring(0, 2), 10);
                    const minute = parseInt(startTime.substring(3, 5), 10);
                    const startTimeMs = todayBaseMs + (hour * 60 + minute) * 60000;
                    const durationMs = stop.durationMn * 60000;

                    const stopLine = new StopLine({
                        id: ++this.stopIdCounter,
                        shop: shopName,
                        line: lineName,
                        station: "ALL",
                        reason: stop.name,
                        startTime: startTimeMs,
                        endTime: startTimeMs + durationMs,
                        status: "PLANNED",
                        severity: "LOW",
                        type: "PLANNED",
                        category: stop.type as any,
                        durationMs: durationMs
                    });
                    this.stopsMap.set(stopLine.id.toString(), stopLine);
                }
            }
        }
    }

    public createRandomStops(): void {
        const flowPlantShopsEntries: [string, IShop][] = Object.entries(this.flowPlant.shops);

        const now = new Date();
        const todayBaseMs = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            0,
            0,
            0,
            0
        );

        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries(shopConfig.lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName, lineConfig]: [string, ILine] = linesEntries[i] as [string, any];
                const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig);
                const productionTimeMs = productionTimeMinutes * 60000;
                const mtbfMinutes = lineConfig.MTBF;

                if (typeof mtbfMinutes !== "number" || mtbfMinutes <= 0) continue;
                const numStops = Math.floor(productionTimeMinutes / mtbfMinutes);
                if (numStops <= 0) continue;

                const stations = lineConfig.stations;
                const shiftStart = lineConfig.takt.shiftStart;
                const startHour = parseInt(shiftStart.substring(0, 2), 10);
                const startMinute = parseInt(shiftStart.substring(3, 5), 10);

                // Isso aqui é apenas o deslocamento desde a 00:00
                const shiftStartMs = (startHour * 60 + startMinute) * 60000;

                const rawStops: IStopLine[] = [];
                for (let i = 0; i < numStops; i++) {
                    const randomStation = stations[Math.floor(Math.random() * stations.length)];
                    const stationId = `${shopName}-${lineName}-${randomStation}`

                    const segmentSize = productionTimeMs / numStops;
                    const segmentStart = segmentSize * i;
                    const randomVariation = Math.random() * segmentSize;
                    const randomOffset = Math.floor(segmentStart + randomVariation);
                    const productionTimeHr = productionTimeMinutes / 60;
                    const deviation = Math.floor(Math.random() * (productionTimeHr * 3600000));

                    const startTime = todayBaseMs + shiftStartMs + randomOffset + deviation;

                    const rand = Math.random();
                    let severity: StopSeverity = "LOW";
                    if (rand < 0.7) severity = "LOW";
                    else if (rand < 0.95) severity = "MEDIUM";
                    else severity = "HIGH";

                    const range = StopLineFactory.severityRanges[severity];
                    const durationMs = (range.min + Math.random() * (range.max - range.min)) * 60000;
                    const startEnd = startTime + durationMs;

                    rawStops.push({
                        id: ++this.stopIdCounter,
                        shop: shopName,
                        line: lineName,
                        station: stationId,
                        reason: "Random failure",
                        startTime: startTime,
                        endTime: startEnd,
                        status: "PLANNED",
                        severity,
                        type: "RANDOM_GENERATE",
                        category: "PROCESS_QUALITY_FAILURE",
                        durationMs: durationMs
                    });
                }
                const rawLen = rawStops.length;
                for (let j = 0; j < rawLen; j++) {
                    logger().debug(`Creating random stop: ${JSON.stringify(rawStops[j])}`);
                    this.stopsMap.set(rawStops[j].id.toString(), rawStops[j]);
                }
            }
        }
    }

    public resetFactory(): void {
        this.stopsMap.clear();
        this.stopIdCounter = 0;
        this.createPlannedStops();
        this.createRandomStops();
    }
}
