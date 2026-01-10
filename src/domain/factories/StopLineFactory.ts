import { ILine, IShop, IStation, IStopLine, StopCategory, StopReason, StopSeverity, StopType } from "../../utils/shared";
import { StopLine } from "../models/StopLine";
import { getActiveFlowPlant, PlantFactory } from "./plantFactory";
import { logger } from "../../utils/logger";
import { SimulationEventEmitter } from "../../app/SimulationEventEmitter";

export class StopLineFactory {
    private stopsMap: Map<string, IStopLine> = new Map();
    private stopIdCounter: number = 0;
    private flowPlant = getActiveFlowPlant();
    private plantFactory: PlantFactory;
    private static readonly TWO_HOURS_MS: number = 2 * 60 * 60 * 1000;
    private static readonly severityRanges = {
        LOW: { min: 1, max: 5 },
        MEDIUM: { min: 5, max: 10 },
        HIGH: { min: 10, max: 60 }
    };

    constructor(plantFactory?: PlantFactory) {
        this.plantFactory = plantFactory as PlantFactory;
    }

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

    private createPlannedStops(): void {
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

    private createRandomStops(): void {
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

    public startStop(timeStart: number, shopName: string, lineName: string, stationId: string, reason: StopReason, type: StopType, category: StopCategory): void {
        const stopLine = new StopLine({
            id: ++this.stopIdCounter,
            shop: shopName,
            line: lineName,
            station: stationId,
            reason: reason,
            startTime: timeStart,
            status: "IN_PROGRESS",
            severity: "LOW",
            type: type,
            category: category
        });
        this.stopsMap.set(stopLine.id.toString(), stopLine);
        this.plantFactory.setStopStation(stopLine.id, stationId);
    }

    public activeStopsInManyStation(stopId: string, timeMs: number, stations: IStation[]): void {
        const stopLine = this.stopsMap.get(stopId);
        if (stopLine) {
            stopLine.startTime = timeMs;
            stopLine.status = "IN_PROGRESS";
            this.stopsMap.set(stopId, stopLine as IStopLine);
            for (const station of stations) {
                this.plantFactory.setStopStation(stopLine.id, station.id);
            }
        }
    }

    public getStopById(stopId: number): IStopLine | undefined {
        const stopKey = stopId.toString();
        return this.stopsMap.get(stopKey);
    }

    public endStop(stopId: number, timeEnd: number): void {
        const stopKey = stopId.toString();
        const stopLine = this.stopsMap.get(stopKey);
        if (stopLine) {
            stopLine.endTime = timeEnd;
            stopLine.status = "COMPLETED";
            stopLine.durationMs = timeEnd - stopLine.startTime;
            this.stopsMap.set(stopKey, stopLine);
            this.plantFactory.clearStopStation(stopLine.station);
        } else {
            logger().warn(`StopLine with ID ${stopId} not found when trying to end stop.`);
        }
    }

    public getStops(): Map<string, IStopLine> {
        return this.stopsMap;
    }

    public getStopsByShop(shopName: string): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.shop === shopName) {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public getStopsByLine(shopName: string, lineName: string): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.shop === shopName && stop.line === lineName) {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public getPlannedStops(): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.type === "PLANNED") {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public getRandomStops(): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.type === "RANDOM_GENERATE") {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public getStopsByTimeRange(startMs: number, endMs: number): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.startTime >= startMs && stop.startTime <= endMs) {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public getActiveStopsAt(timeMs: number): StopLine[] {
        const result: StopLine[] = [];
        this.stopsMap.forEach((stop) => {
            if (stop.startTime <= timeMs && stop.endTime !== undefined && stop.endTime >= timeMs) {
                result.push(stop as StopLine);
            }
        });
        return result;
    }

    public reescheduleStop(stopId: number): void {
        const stopKey = stopId.toString();
        const stopLine = this.stopsMap.get(stopKey);
        if (stopLine) {
            stopLine.startTime = stopLine.startTime + StopLineFactory.TWO_HOURS_MS;
            stopLine.endTime = stopLine.endTime! + StopLineFactory.TWO_HOURS_MS;
            this.stopsMap.set(stopKey, stopLine);
        }
    }

    // Executed to reset the stops and start again
    public resetAndStart(): void {
        this.stopsMap.clear();
        this.stopIdCounter = 0;
        this.createPlannedStops();
        this.createRandomStops();
    }
}
