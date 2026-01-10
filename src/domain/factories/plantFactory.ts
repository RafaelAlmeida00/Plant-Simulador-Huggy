// src/domain/factories/PlantFactory.ts

import { ConfigPlantRepository } from "../../adapters/database/repositories/ConfigPlantRepository";
import { logger } from "../../utils/logger";
import { ICar, IFlowPlant, ILine, IShop, IStation, IStopLine, PlantSnapshot, StationLocation } from "../../utils/shared";
import { FlowPlant } from "../config/flowPlant";
import { Line } from "../models/Line";
import { Shop } from "../models/Shop";
import { Station } from "../models/Station";
import { StopLineFactory } from "./StopLineFactory";

let activeFlowPlant: IFlowPlant = FlowPlant;
let flowPlantShopKeys: string[] = Object.keys(FlowPlant.shops);

export async function loadDefaultPlantConfig(): Promise<IFlowPlant> {
    try {
        const repository = new ConfigPlantRepository();
        const defaultConfig = await repository.getDefault();
        logger().info(`[PlantFactory] Loaded default configuration from database: "${defaultConfig}"`);

        if (defaultConfig && defaultConfig.config) {
            try {
                const parsedConfig = JSON.parse(defaultConfig.config) as IFlowPlant;

                if (parsedConfig && parsedConfig.shops && Object.keys(parsedConfig.shops).length > 0) {
                    logger().info(`[PlantFactory] Loaded plant configuration from database: "${defaultConfig.name}"`);
                    activeFlowPlant = parsedConfig;
                    flowPlantShopKeys = Object.keys(parsedConfig.shops);
                    return parsedConfig;
                }
                logger().warn('[PlantFactory] Database config is invalid (missing shops), using default FlowPlant');
            } catch (parseError) {
                logger().error(`[PlantFactory] Error parsing config from database: ${String(parseError)}`);
                logger().warn('[PlantFactory] Falling back to default FlowPlant');
            }
        }
        logger().info('[PlantFactory] No default configuration found in database, using FlowPlant');
    } catch (dbError) {
        logger().error(`[PlantFactory] Error fetching config from database: ${String(dbError)}`);
        logger().warn('[PlantFactory] Falling back to default FlowPlant');
    }

    activeFlowPlant = FlowPlant;
    flowPlantShopKeys = Object.keys(FlowPlant.shops);
    return FlowPlant;
}


export function getActiveFlowPlant(): IFlowPlant {
    return activeFlowPlant;
}


export class PlantFactory {

    private shops: Map<string, IShop> = new Map();
    private lines: Map<string, ILine> = new Map();
    private stations: Map<string, IStation> = new Map();
    private stopLineFactory: StopLineFactory = null as any;

    public setStopFactory(stopLineFactory: StopLineFactory) {
        this.stopLineFactory = stopLineFactory;
    }

    public createShop(shopName: string): IShop {
        const shopConfig = activeFlowPlant.shops[shopName];
        if (!shopConfig) throw new Error(`Shop ${shopName} not found in config`);

        const linesMap = new Map<string, ILine>();
        const linesEntries = Object.entries(shopConfig.lines);

        for (let lineIdx = 0; lineIdx < linesEntries.length; lineIdx++) {
            const [lineName, lineConfig]: [string, ILine] = linesEntries[lineIdx];

            // Calcular tempo de produção inline para evitar criação de função a cada iteração
            const takt = lineConfig.takt;
            const startHour = parseInt(takt.shiftStart.substring(0, 2), 10);
            const startMinute = parseInt(takt.shiftStart.substring(3, 5), 10);
            const endHour = parseInt(takt.shiftEnd.substring(0, 2), 10);
            const endMinute = parseInt(takt.shiftEnd.substring(3, 5), 10);

            let timeChangeShift = 0;
            if (takt.shiftEnd && takt.shiftStart) {
                const endHourFirstShift = parseInt(takt.shiftEnd.substring(0, 2), 10);
                const endMinuteFirstShift = parseInt(takt.shiftEnd.substring(3, 5), 10);
                const startHourSecondShift = parseInt(takt.shiftStart.substring(0, 2), 10);
                const startMinuteSecondShift = parseInt(takt.shiftStart.substring(3, 5), 10);
                timeChangeShift = (endHourFirstShift * 60 + endMinuteFirstShift) - (startHourSecondShift * 60 + startMinuteSecondShift);
            }

            let timePlannedStops = 0;
            const plannedStops = activeFlowPlant.plannedStops;
            if (plannedStops) {
                const stopsLen = plannedStops.length;
                for (let i = 0; i < stopsLen; i++) {
                    const stop = plannedStops[i];
                    if (!stop.affectsShops || stop.affectsShops.includes(shopName)) {
                        timePlannedStops += stop.durationMn;
                    }
                }
            }

            const productionTimeMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute) - timeChangeShift - timePlannedStops;
            const lineTaktMs = (productionTimeMinutes / ((productionTimeMinutes / 60) * takt.jph)) * 60000;

            const stationNames: IStation[] = lineConfig.stations;
            const stationCount = stationNames.length;
            const stationTakts = this.distributeTaktAmongStations(lineTaktMs, stationCount);

            const stations: IStation[] = new Array(stationCount);
            for (let i = 0; i < stationCount; i++) {
                stations[i] = new Station({
                    id: `${shopName}-${lineName}-${stationNames[i]}`,
                    shop: shopName,
                    line: lineName,
                    index: i,
                    taktMn: stationTakts[i] / 60000,
                    isFirstStation: i === 0,
                    isLastStation: i === stationCount - 1,
                    occupied: false,
                    currentCar: null,
                    isStopped: false,
                    startStop: 0,
                    finishStop: 0,
                    isFirstCar: true,
                    taktSg: stationTakts[i] / 1000,
                    station: stationNames[i].id,
                });
                this.stations.set(stations[i].id, stations[i]);
            }

            const newLine: ILine = new Line({
                id: `${shopName}-${lineName}`,
                shop: shopName,
                line: lineName,
                stations: stations,
                taktMn: lineTaktMs / 60000,
                isFeederLine: lineConfig.isFeederLine,
                feedsToLine: lineConfig.feedsToLine,
                feedsToStation: lineConfig.feedsToStation,
                MTTR: lineConfig.MTTR,
                MTBF: lineConfig.MTBF,
                productionTimeMinutes: productionTimeMinutes,
                partType: lineConfig.partType,
                requiredParts: lineConfig.requiredParts,
                partConsumptionStation: lineConfig.partConsumptionStation,
                createWith: lineConfig.createWith,
                buffers: lineConfig.buffers,
                routes: lineConfig.routes,
                takt: lineConfig.takt
            });
            this.lines?.set(newLine.id, newLine);
            linesMap.set(lineName, newLine);
        }

        return new Shop({
            name: shopName,
            lines: linesMap,
            bufferCapacity: shopConfig.bufferCapacity ?? 0,
            reworkBuffer: shopConfig.reworkBuffer ?? 0,
        });
    }


    public createAllShops(): Map<string, IShop> {
        const allShops = new Map<string, IShop>();
        const keysLen = flowPlantShopKeys.length;
        for (let i = 0; i < keysLen; i++) {
            const shopKey = flowPlantShopKeys[i];
            const shop = this.createShop(shopKey)
            allShops.set(shopKey, shop);
            this.shops?.set(shopKey, shop);
        }
        return allShops;
    }

    // Getter methods

    public getById(type: "shop" | "line" | "station", id: string): IShop | ILine | IStation | undefined {
        if (type === "shop") {
            return this.shops?.get(id);
        }
        if (type === "line") {
            return this.lines?.get(id);
        }
        if (type === "station") {
            return this.stations.get(id);
        }
        return undefined;
    }

    public getShops(): Map<string, IShop> {
        return this.shops as Map<string, IShop>;
    }

    public getPlantSnapshot(): PlantSnapshot {
        const timestamp = Date.now();
        const arrShops = Array.from(this.shops?.values() || []).filter(Boolean) as IShop[];
        const arrLines = Array.from(this.lines?.values() || []).filter(Boolean) as ILine[];
        const arrStations = Array.from(this.stations.values() || []).filter(Boolean) as IStation[];

        arrShops.forEach((shop) => {
            if (!shop) return;
            shop.lines = arrLines.filter((line) => line?.shop === shop.name);
            for (const line of shop.lines.values()) {
                if (!line) continue;
                line.stations = arrStations.filter((station) =>
                    station?.line === line.line && station?.shop === shop.name
                );
            }
        });
        const totalStations = this.stations.size;
        let totalOccupied = 0;
        let totalFree = 0;
        let totalStopped = 0;
        for (const station of this.stations.values() || []) {
            if (!station) {
                continue;
            }
            if (station.occupied) {
                totalOccupied++;
            }
            if (!station.occupied) {
                totalFree++;
            }
            if (station.isStopped) {
                totalStopped++;
            }
        }

        return {
            timestamp,
            shops: arrShops,
            totalStations: totalStations || 0,
            totalOccupied,
            totalFree,
            totalStopped
        };
    }

    public getShopsKeys(): string[] {
        return flowPlantShopKeys;
    }

    public getLines(): Map<string, ILine> {
        return this.lines as Map<string, ILine>;
    }

    public getStations(): Map<string, IStation> {
        return this.stations as Map<string, IStation>;
    }

    public getLinesOfShop(shopName: string): ILine[] {
        const shop: IShop = this.shops?.get(shopName) as IShop;
        if (!shop) return [];
        return Array.from(shop.lines.values());
    }

    public getStationsOfLine(shopName: string, lineName: string): IStation[] {
        const lineId = `${shopName}-${lineName}`;
        const line = this.lines?.get(lineId);
        if (!line) return [];
        return line.stations;
    }

    public getStationsOfShop(shopName: string): IStation[] {
        const shop = this.shops?.get(shopName);
        if (!shop) return [];
        const stations: IStation[] = [];
        shop.lines.forEach((line: ILine) => {
            stations.push(...line.stations);
        });
        return stations;
    }

    public getFinalLinesOfShop(shopName: string): ILine[] {
        const shop = this.shops?.get(shopName);
        if (!shop) return [];
        const finalLines: ILine[] = [];
        shop.lines.forEach((line: ILine, index: number) => {
            if (shop.lines.size === index + 1) {
                finalLines.push(line);
            }
        });
        return finalLines;
    }

    public getStartStations(): StationLocation[] {
        const flowPlant = getActiveFlowPlant();
        const startStations = flowPlant.stationstartProduction as StationLocation[];
        return startStations
    }

    public getLineThatProducePartType(shopName: string, partType: string): ILine | null {
        for (const [_, line] of this.lines) {
            if (line.partType === partType) {
                return line;
            }
        }
        return null;
    }

    public getRouteFromStation(stationId: string): { shop: string, line: string, station: string } | null {
        const currentStation = this.stations.get(stationId);
        if (!currentStation) {
            logger().debug(`Station not found for route lookup: ${stationId}`);
            return null;
        }

        const line = this.lines.get(`${currentStation.shop}-${currentStation.line}`);
        if (!line || !line.routes || line.routes.length === 0) {
            return null;
        }

        // Search for route that departs from current station
        const route = line.routes.find(r => r.fromStation === currentStation.station);
        if (!route || !route.to) {
            return null;
        }

        // Return first destination (assuming single destination)
        return route.to[0];
    }

    public getLinesThatRouteToStation(shop: string, line: string, station: string): ILine[] {
        const result: ILine[] = [];

        for (const [_, candidateLine] of this.lines) {
            if (!candidateLine.routes) continue;

            for (const route of candidateLine.routes) {
                if (route.to && route.to.some(dest =>
                    dest.shop === shop &&
                    dest.line === line &&
                    dest.station === station
                )) {
                    result.push(candidateLine);
                }
            }
        }

        return result;
    }

    public getNextStationId(currentStationId: string): IStation | null {
        const currentStation = this.stations.get(currentStationId);
        if (!currentStation) {
            logger().error(`Estacao nao encontrada: ID=${currentStationId}`);
            return null
        };
        const line = this.lines?.get(`${currentStation.shop}-${currentStation.line}`);
        if (!line) {
            logger().error(`Linha nao encontrada para a estacao: ID=${currentStationId}`);
            return null;
        }
        const currentIndex = currentStation.index;
        if (currentIndex + 1 >= line.stations.length) {
            logger().debug(`Estacao atual e a ultima da linha: ID=${currentStationId}`);
            return null; // Nao ha proxima estacao
        }
        const nextStation = line.stations[currentIndex + 1];
        return nextStation;
    }

    public getPrevLine(currentStationId: string): ILine | null {
        const currentStation = this.stations.get(currentStationId);
        if (!currentStation) {
            logger().error(`Estacao nao encontrada: ID=${currentStationId}`);
            return null
        };
        const shop = this.shops.get(currentStation.shop);
        if (!shop) {
            logger().error(`Linha nao encontrada para a estacao: ID=${currentStationId}`);
            return null;
        }
        const linesArray = Array.from(shop.lines.values()) as ILine[];
        const currentLineIndex = linesArray.findIndex(line => line.line === currentStation.line);
        if (currentLineIndex - 1 < 0) {
            return null; // Nao ha linha anterior
        }
        const prevLine = linesArray[currentLineIndex - 1];
        return prevLine;
    }

    public getNextLine(currentStationId: string): ILine | null {
        const currentStation = this.stations.get(currentStationId);
        if (!currentStation) {
            logger().error(`Estacao nao encontrada: ID=${currentStationId}`);
            return null
        };
        const shop = this.shops.get(currentStation.shop);
        if (!shop) {
            logger().error(`Linha nao encontrada para a estacao: ID=${currentStationId}`);
            return null;
        }
        const linesArray = Array.from(shop.lines.values()) as ILine[];
        const currentLineIndex = linesArray.findIndex(line => line.line === currentStation.line);
        if (currentLineIndex + 1 >= linesArray.length) {
            return null; // Nao ha linha anterior
        }
        const nextLine = linesArray[currentLineIndex + 1];
        return nextLine;
    }

    // Public methods to manipulate stations
    public addCarToStation(stationId: string, car: ICar): void {
        const station = this.stations.get(stationId);
        if (!station) {
            logger().error(`Estacao não achada: ID=${stationId}`);
            return;
        }
        if (station) {
            station.currentCar = car;
            station.occupied = true;
            if (station.isFirstCar) {
                station.isFirstCar = false;
            }
            this.stations.set(stationId, station as IStation);
        }
    }

    public removeCarFromStation(stationId: string): void {
        const station = this.stations.get(stationId);
        if (station) {
            station.currentCar = null;
            station.occupied = false;
        }
        this.stations.set(stationId, station as IStation);
    }

    public clearStopStation(stationId: string): void {
        const station = this.stations.get(stationId);
        if (station) {
            station.finishStop = 0;
            station.isStopped = false;
            station.stopReason = undefined;
            station.startStop = 0;
            station.stopId = undefined;
        }
        this.stations.set(stationId, station as IStation);
    }

    public setStopStation(stopId: number, stationId: string): void {
        const station = this.stations.get(stationId);
        const stop = this.stopLineFactory.getStopById(stopId);
        if (station) {
            station.finishStop = stop?.endTime ?? 0;
            station.isStopped = true;
            station.stopReason = stop?.reason;
            station.startStop = stop?.startTime ?? 0;
            station.stopId = stop?.id !== undefined ? String(stop.id) : undefined;
        }
        this.stations.set(stationId, station as IStation);
    }

    public resetFactory(): void {
        this.shops = new Map<string, IShop>();
        this.lines = new Map<string, ILine>();
        this.stations = new Map<string, IStation>();
        this.createAllShops();
    }

    // Private method to distribute takt time among stations
    private distributeTaktAmongStations(lineTaktMs: number, stationCount: number): number[] {
        if (stationCount === 0) return [];

        const MIN_FRACTION = activeFlowPlant.stationTaktMinFraction as number;
        const MAX_FRACTION = activeFlowPlant.stationTaktMaxFraction as number; // nunca >= 1.0
        const BIAS_EXPONENT = 0.35;
        const takts = new Array<number>(stationCount);

        for (let i = 0; i < stationCount; i++) {
            const u = Math.random();
            const biased = Math.pow(u, BIAS_EXPONENT);
            const maxFractionClamped = Math.min(MAX_FRACTION, 0.999);
            const minFractionClamped = Math.max(0, Math.min(MIN_FRACTION, maxFractionClamped));
            const fraction = minFractionClamped + (maxFractionClamped - minFractionClamped) * biased;

            let taktMs = Math.floor(lineTaktMs * fraction);
            if (taktMs >= lineTaktMs) taktMs = Math.max(1, Math.floor(lineTaktMs) - 1);
            if (taktMs < 1) taktMs = 1;

            takts[i] = taktMs;
        }

        return takts;
    }
}