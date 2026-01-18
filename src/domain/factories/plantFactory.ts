// src/domain/factories/PlantFactory.ts

import { ConfigPlantRepository } from "../../adapters/http/repositories/ConfigPlantRepository";
import { logger } from "../../utils/logger";
import { ICar, IFlowPlant, ILine, IShop, IStation, IStopLine, PlantSnapshot, StationLocation } from "../../utils/shared";
import { FlowPlant } from "../config/flowPlant";
import { Line } from "../models/Line";
import { Shop } from "../models/Shop";
import { Station } from "../models/Station";

export let activeFlowPlant: IFlowPlant = FlowPlant;
export let flowPlantShopKeys: string[] = Object.keys(FlowPlant.shops);

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

/**
 * Set the active plant configuration.
 * Used by Worker Threads to load session-specific configs.
 */
export function setActiveFlowPlant(config: IFlowPlant): void {
    activeFlowPlant = config;
    flowPlantShopKeys = Object.keys(config.shops);
}

// Re-export FlowPlant for use by workers
export { FlowPlant } from "../config/flowPlant";


export class PlantFactory {

    public shops: Map<string, IShop> = new Map();
    public lines: Map<string, ILine> = new Map();
    public stations: Map<string, IStation> = new Map();

    // Pre-computed indexes for O(1) lookups in PlantSnapshot
    private _linesByShop: Map<string, ILine[]> = new Map();
    private _stationsByShopLine: Map<string, IStation[]> = new Map();
    private _structureVersion: number = 0;

    // Getters for indexed access - O(1)
    public getLinesByShop(shopName: string): ILine[] {
        return this._linesByShop.get(shopName) || [];
    }

    public getStationsByShopLine(shop: string, line: string): IStation[] {
        return this._stationsByShopLine.get(`${shop}-${line}`) || [];
    }

    public getStructureVersion(): number {
        return this._structureVersion;
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

            // Calcular tempo disponível para produção
            // productionTime = duração do turno - paradas planejadas
            let productionTimeMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);

            // Subtrair paradas planejadas que afetam este shop
            const plannedStops = activeFlowPlant.plannedStops;
            if (plannedStops) {
                const stopsLen = plannedStops.length;
                for (let i = 0; i < stopsLen; i++) {
                    const stop = plannedStops[i];
                    // Subtrair duração se: não tem affectsShops (afeta todos) OU afeta este shop
                    if (!stop.affectsShops || stop.affectsShops.includes(shopName)) {
                        productionTimeMinutes -= stop.durationMn;
                    }
                }
            }

            // Validação: productionTime deve ser positivo
            if (productionTimeMinutes <= 0) {
                console.warn(`⚠️  Line ${shopName}-${lineName}: productionTime calculado como ${productionTimeMinutes}. Ajustando para 1 minuto.`);
                productionTimeMinutes = 1;
            }
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

            // Populate station index - O(1) lookup later
            this._stationsByShopLine.set(`${shopName}-${lineName}`, stations);
        }

        // Populate line index for this shop - O(1) lookup later
        this._linesByShop.set(shopName, Array.from(linesMap.values()));
        this._structureVersion++;

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


    public resetFactory(): void {
        this.shops.clear();
        this.lines.clear();
        this.stations.clear();
        this._linesByShop.clear();
        this._stationsByShopLine.clear();
        this.createAllShops();
    }

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