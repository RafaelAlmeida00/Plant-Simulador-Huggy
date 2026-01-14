// src/domain/services/PlantService.ts

import { ConfigPlantRepository } from "../../adapters/database/repositories/ConfigPlantRepository";
import { logger } from "../../utils/logger";
import { ICar, IFlowPlant, ILine, IShop, IStation, IStopLine, PlantSnapshot, StationLocation } from "../../utils/shared";
import { FlowPlant } from "../config/flowPlant";
import { flowPlantShopKeys, getActiveFlowPlant, PlantFactory } from "../factories/plantFactory";
import { StopLineService } from "./StopLineService";


export class PlantService {
    private plantFactory: PlantFactory;
    private stopCallBack: ((stopId: number) => IStopLine | undefined) | null = null;

    constructor(plantFactory: PlantFactory) {
        this.plantFactory = plantFactory;
        // NÃO armazenar referências locais - sempre acessar via plantFactory
    }

    /**
     * Getters que SEMPRE acessam os Maps atuais do Factory
     * Isso garante sincronização mesmo após reset/repopulação
     */
    private get shops(): Map<string, IShop> {
        return this.plantFactory.shops;
    }

    private get lines(): Map<string, ILine> {
        return this.plantFactory.lines;
    }

    private get stations(): Map<string, IStation> {
        return this.plantFactory.stations;
    }

    public setStopCallBack(callback: (stopId: number) => IStopLine | undefined): void {
        this.stopCallBack = callback;
    }


    public createShop(shopName: string): IShop {
        return this.plantFactory.createShop(shopName);
    }

    public createAllShops(): Map<string, IShop> {
        return this.plantFactory.createAllShops();
    }

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

    /**
     * Optimized PlantSnapshot using pre-computed indexes - O(n) instead of O(n²)
     */
    public getPlantSnapshot(): PlantSnapshot {
        const timestamp = Date.now();
        const arrShops: IShop[] = [];

        // Use pre-computed indexes for O(1) lookups
        for (const shop of this.shops?.values() || []) {
            if (!shop) continue;

            // O(1) lookup instead of O(lines) filter
            const shopLines = this.plantFactory.getLinesByShop(shop.name);
            shop.lines = shopLines;

            // Lines already have their stations from factory creation
            // No need to re-filter - stations are directly on the line object
            arrShops.push(shop);
        }

        // Station counters - O(n) single pass
        const totalStations = this.stations.size;
        let totalOccupied = 0;
        let totalStopped = 0;

        for (const station of this.stations.values()) {
            if (!station) continue;
            if (station.occupied) totalOccupied++;
            if (station.isStopped) totalStopped++;
        }

        return {
            timestamp,
            shops: arrShops,
            totalStations,
            totalOccupied,
            totalFree: totalStations - totalOccupied,
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

    public setStopStation(stopId: number, stationId: string, stop?: IStopLine): void {
        const station = this.stations.get(stationId);
        // If stop is not provided, try to fetch it from stopLineFactory
        // Otherwise use the provided stop object
        const stopToUse = stop || (this.stopCallBack ? this.stopCallBack(stopId) : undefined);
        if (station) {
            station.finishStop = stopToUse?.endTime ?? 0;
            station.isStopped = true;
            station.stopReason = stopToUse?.reason;
            station.startStop = stopToUse?.startTime ?? 0;
            station.stopId = stopToUse?.id !== undefined ? String(stopToUse.id) : undefined;
        }
        this.stations.set(stationId, station as IStation);
    }

    public resetFactory(): void {
        // Reset the factory's maps (clears them and repopulates)
        this.plantFactory.resetFactory();
        // Keep the same references to the factory's maps
        // (no need to reassign - they're the same objects)
    }

}
