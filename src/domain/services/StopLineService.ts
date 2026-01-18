// src/domain/services/StopLineService.ts

import { ILine, IShop, IStation, IStopLine, StopCategory, StopSeverity, StopType } from "../../utils/shared";
import { StopLine } from "../models/StopLine";
import { PlantService } from "./PlantService";
import { logger } from "../../utils/logger";
import { StopLineFactory } from "../factories/StopLineFactory";

export class StopLineService {
    private stopLineFactory: StopLineFactory;
    private plantService: PlantService;
    private static readonly TWO_HOURS_MS: number = 2 * 60 * 60 * 1000;

    constructor(plantService: PlantService, stopLineFactory: StopLineFactory) {
        this.plantService = plantService;
        this.stopLineFactory = stopLineFactory;
        // NÃO armazenar referências locais - sempre acessar via stopLineFactory
    }

    /**
     * Getters/Setters que SEMPRE acessam os valores atuais do Factory
     * Isso garante sincronização mesmo após reset/repopulação
     */
    private get stopsMap(): Map<string, IStopLine> {
        return this.stopLineFactory.stopsMap;
    }

    private get stopIdCounter(): number {
        return this.stopLineFactory.stopIdCounter;
    }

    private set stopIdCounter(value: number) {
        this.stopLineFactory.stopIdCounter = value;
    }

    public startStop(timeStart: number, shopName: string, lineName: string, stationId: string, reason: string, type: StopType, category: StopCategory): IStopLine {
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
        this.plantService.setStopStation(stopLine.id, stationId, stopLine);
        return stopLine;
    }

    public activeStopsInManyStation(stopId: string, timeMs: number, stations: IStation[]): void {
        const stopLine = this.stopsMap.get(stopId);
        if (stopLine) {
            stopLine.startTime = timeMs;
            stopLine.status = "IN_PROGRESS";
            this.stopsMap.set(stopId, stopLine as IStopLine);
            for (const station of stations) {
                this.plantService.setStopStation(stopLine.id, station.id, stopLine);
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
            this.plantService.clearStopStation(stopLine.station);
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
            stopLine.startTime = stopLine.startTime + StopLineService.TWO_HOURS_MS;
            stopLine.endTime = stopLine.endTime! + StopLineService.TWO_HOURS_MS;
            this.stopsMap.set(stopKey, stopLine);
        }
    }

    // Executed to reset the stops and start again
    public resetAndStart(): void {
       this.stopLineFactory.resetFactory();
    }

    /**
     * Restore active stops for recovery
     * This recreates stops that were IN_PROGRESS when the server stopped
     */
    public restoreActiveStops(activeStops: Array<{
        stopId: string;
        shop: string;
        line: string;
        station: string;
        reason?: string;
        type?: string;
        category?: string;
        severity?: string;
        startTime: number;
        durationMs?: number;
    }>): void {
        for (const stopData of activeStops) {
            // Create a stop key for the map
            const stopKey = `${stopData.shop}-${stopData.line}-${stopData.station}-${stopData.stopId}`;

            // Create the stop object
            const stop: IStopLine = {
                id: parseInt(stopData.stopId, 10) || Date.now(),
                shop: stopData.shop,
                line: stopData.line,
                station: stopData.station,
                reason: stopData.reason || 'Recovered stop',
                type: (stopData.type as any) || 'RANDOM_GENERATE',
                category: (stopData.category as any) || 'MACHINE',
                severity: (stopData.severity as any) || 'MEDIUM',
                startTime: stopData.startTime,
                endTime: stopData.durationMs
                    ? stopData.startTime + stopData.durationMs
                    : stopData.startTime + 60000, // Default 1 minute if no duration
                durationMs: stopData.durationMs || 60000,
                status: 'IN_PROGRESS'
            };

            this.stopsMap.set(stopKey, stop);
        }

        logger().info(`[StopLineService] Restored ${activeStops.length} active stops for recovery`);
    }
}
