import { getActiveFlowPlant } from "./plantFactory";
import { StopLine, IStopLine } from "../models/StopLine";

export class StopLineFactory {
    private stops: StopLine[] = [];
    private stopsMap: Map<string, IStopLine> = new Map();
    private stopIdCounter: number = 0;
    private static readonly severityRanges = {
        LOW: { min: 1, max: 5 },
        MEDIUM: { min: 5, max: 10 },
        HIGH: { min: 10, max: 60 }
    };

    constructor() {
        this.createPlannedStops();
        this.createRandomStops();
    }

    private getProductionTimeMinutes(shopName: string, lineConfig: any): number {
        const flowPlant = getActiveFlowPlant();
        const shiftStart = lineConfig.takt.shiftStart;
        const shiftEnd = lineConfig.takt.shiftEnd;
        const startHour = parseInt(shiftStart.substring(0, 2), 10);
        const startMinute = parseInt(shiftStart.substring(3, 5), 10);
        const endHour = parseInt(shiftEnd.substring(0, 2), 10);
        const endMinute = parseInt(shiftEnd.substring(3, 5), 10);

        let totalMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
        if (totalMinutes < 0) totalMinutes += 1440;

        const plannedStops = flowPlant.plannedStops;
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
        const flowPlant = getActiveFlowPlant();
        const plannedStops = flowPlant.plannedStops;
        if (!plannedStops) return;

        const currentDay = new Date().getDay();
        const flowPlantShopsEntries: [string, any][] = Object.entries(flowPlant.shops);

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
                    const startTimeMs = (hour * 60 + minute) * 60000;
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
                        durationMs
                    });
                    this.stops.push(stopLine);
                    this.stopsMap.set(stopLine.id.toString(), stopLine);
                }
            }
        }
    }

    private getShiftStartMs(lineConfig: any): number {
        const shiftStart = lineConfig.takt.shiftStart;
        const startHour = parseInt(shiftStart.substring(0, 2), 10);
        const startMinute = parseInt(shiftStart.substring(3, 5), 10);
        return (startHour * 60 + startMinute) * 60000;
    }

    private createRandomStops(): void {
        const flowPlant = getActiveFlowPlant();
        const flowPlantShopsEntries: [string, any][] = Object.entries(flowPlant.shops);
        
        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries(shopConfig.lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName, lineConfig] = linesEntries[i] as [string, any];
                const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig);
                const mtbfMinutes = lineConfig.MTBF;
                const mttrMinutes = lineConfig.MTTR;

                const numStops = Math.floor(productionTimeMinutes / mtbfMinutes);
                if (numStops <= 0) continue;

                const stations = lineConfig.stations;
                const shiftStartMs = this.getShiftStartMs(lineConfig);
                const rawStops = this.generateRawStops(shopName, lineName, stations, numStops, productionTimeMinutes, shiftStartMs);
                
                this.adjustDurationsToMTTR(rawStops, mttrMinutes);

                const rawLen = rawStops.length;
                for (let j = 0; j < rawLen; j++) {
                    const stopLine = new StopLine(rawStops[j]);
                    this.stops.push(stopLine);
                    this.stopsMap.set(stopLine.id.toString(), stopLine);
                }
            }
        }
    }

    private generateRawStops(
        shopName: string,
        lineName: string,
        stations: string[],
        numStops: number,
        productionTimeMinutes: number,
        shiftStartMs: number
    ): IStopLine[] {
        const rawStops: IStopLine[] = [];
        const productionTimeMs = productionTimeMinutes * 60 * 1000;

        for (let i = 0; i < numStops; i++) {
            const randomStation = stations[Math.floor(Math.random() * stations.length)];
            const randomOffset = this.distributeStopTime(productionTimeMs, numStops, i);
            const startTime = shiftStartMs + randomOffset;
            const severity = this.randomSeverity();
            const durationMs = this.randomDurationBySeverity(severity);

            rawStops.push({
                id: ++this.stopIdCounter,
                shop: shopName,
                line: lineName,
                station: randomStation,
                reason: "Random failure",
                startTime,
                endTime: startTime + durationMs,
                status: "PLANNED",
                severity,
                type: "RANDOM_GENERATE",
                category: "PROCESS_QUALITY_FAILURE",
                durationMs
            });
        }

        return rawStops;
    }

    private distributeStopTime(productionTimeMs: number, totalStops: number, stopIndex: number): number {
        // Divide o período de produção em segmentos iguais para cada parada
        const segmentSize = productionTimeMs / totalStops;
        // Calcula o início do segmento para esta parada
        const segmentStart = segmentSize * stopIndex;
        // Adiciona uma variação aleatória dentro do segmento (0% a 100% do segmento)
        const randomVariation = Math.random() * segmentSize;
        // Retorna a posição final dentro do período de produção
        return Math.floor(segmentStart + randomVariation);
    }

    private randomSeverity(): "LOW" | "MEDIUM" | "HIGH" {
        const rand = Math.random();
        if (rand < 0.7) return "LOW";
        if (rand < 0.95) return "MEDIUM";
        return "HIGH";
    }

    private randomDurationBySeverity(severity: "LOW" | "MEDIUM" | "HIGH"): number {
        const range = StopLineFactory.severityRanges[severity];
        return (range.min + Math.random() * (range.max - range.min)) * 60000;
    }

    private adjustDurationsToMTTR(stops: IStopLine[], mttrMinutes: number): void {
        const len = stops.length;
        if (len === 0) return;

        const targetTotalMs = mttrMinutes * 60000 * len;
        let currentTotalMs = 0;
        for (let i = 0; i < len; i++) {
            currentTotalMs += stops[i].durationMs || 0;
        }

        if (currentTotalMs === 0) return;

        const scaleFactor = targetTotalMs / currentTotalMs;
        const minDurationMs = 30000;
        const maxDurationMs = 7200000;

        for (let i = 0; i < len; i++) {
            const stop = stops[i];
            if (!stop.durationMs) continue;
            
            let newDuration = stop.durationMs * scaleFactor;
            if (newDuration < minDurationMs) newDuration = minDurationMs;
            else if (newDuration > maxDurationMs) newDuration = maxDurationMs;
            
            const variation = 0.8 + Math.random() * 0.4;
            newDuration *= variation;

            stop.durationMs = Math.round(newDuration);
            stop.endTime = stop.startTime + stop.durationMs;
        }
    }

    public getAllStops(): StopLine[] {
        return this.stops;
    }

    public getStopsMap(): Map<string, IStopLine> {
        const result = new Map<string, IStopLine>();
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            const s = this.stops[i];
            if (s.severity !== undefined && s.severity !== null && s.severity !== "PLANNED") {
                result.set(s.id.toString(), s);
            }
        }
        return result;
    }

    public getStopsByShop(shopName: string): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            if (this.stops[i].shop === shopName) {
                result.push(this.stops[i]);
            }
        }
        return result;
    }

    public getStopsByLine(shopName: string, lineName: string): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            const s = this.stops[i];
            if (s.shop === shopName && s.line === lineName) {
                result.push(s);
            }
        }
        return result;
    }

    public getPlannedStops(): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            if (this.stops[i].type === "PLANNED") {
                result.push(this.stops[i]);
            }
        }
        return result;
    }

    public getRandomStops(): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            if (this.stops[i].type === "RANDOM_GENERATE") {
                result.push(this.stops[i]);
            }
        }
        return result;
    }

    public getStopsByTimeRange(startMs: number, endMs: number): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            const s = this.stops[i];
            if (s.startTime >= startMs && s.startTime <= endMs) {
                result.push(s);
            }
        }
        return result;
    }

    public getActiveStopsAt(timeMs: number): StopLine[] {
        const result: StopLine[] = [];
        const len = this.stops.length;
        for (let i = 0; i < len; i++) {
            const s = this.stops[i];
            if (s.startTime <= timeMs && s.endTime >= timeMs) {
                result.push(s);
            }
        }
        return result;
    }
}
