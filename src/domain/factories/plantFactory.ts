// src/domain/factories/PlantFactory.ts

import { FlowPlant } from "../config/flowPlant";
import { ILine, Line } from "../models/Line";
import { IShop, Shop } from "../models/Shop";
import { IStation, Station } from "../models/Station";
import { ConfigPlantRepository } from "../../adapters/database/repositories/ConfigPlantRepository";
import { IFlowPlant } from "../../utils/shared";

// Configuração ativa da planta (carregada do banco ou fallback para FlowPlant)
let activeFlowPlant: IFlowPlant = FlowPlant;

// Cache para evitar recálculos
let flowPlantShopKeys: string[] = Object.keys(FlowPlant.shops);

/**
 * Carrega a configuração padrão do banco de dados.
 * Se não encontrar ou houver erro, usa FlowPlant como fallback.
 */
export async function loadDefaultPlantConfig(): Promise<IFlowPlant> {
    try {
        const repository = new ConfigPlantRepository();
        const defaultConfig = await repository.getDefault();
        console.log(`[PlantFactory] Loaded default configuration from database: "${defaultConfig}"`);

        if (defaultConfig && defaultConfig.config) {
            try {
                const parsedConfig = JSON.parse(defaultConfig.config) as IFlowPlant;

                // Valida se o config tem a estrutura mínima esperada
                if (parsedConfig && parsedConfig.shops && Object.keys(parsedConfig.shops).length > 0) {
                    console.log(`[PlantFactory] Loaded plant configuration from database: "${defaultConfig.name}"`);
                    activeFlowPlant = parsedConfig;
                    flowPlantShopKeys = Object.keys(parsedConfig.shops);
                    return parsedConfig;
                } else {
                    console.warn('[PlantFactory] Database config is invalid (missing shops), using default FlowPlant');
                }
            } catch (parseError) {
                console.error('[PlantFactory] Error parsing config from database:', parseError);
                console.warn('[PlantFactory] Falling back to default FlowPlant');
            }
        } else {
            console.log('[PlantFactory] No default configuration found in database, using FlowPlant');
        }
    } catch (dbError) {
        console.error('[PlantFactory] Error fetching config from database:', dbError);
        console.warn('[PlantFactory] Falling back to default FlowPlant');
    }

    // Fallback para FlowPlant
    activeFlowPlant = FlowPlant;
    flowPlantShopKeys = Object.keys(FlowPlant.shops);
    return FlowPlant;
}

/**
 * Retorna a configuração ativa da planta.
 */
export function getActiveFlowPlant(): IFlowPlant {
    return activeFlowPlant;
}

/**
 * Define uma nova configuração ativa da planta.
 */
export function setActiveFlowPlant(config: IFlowPlant): void {
    activeFlowPlant = config;
    flowPlantShopKeys = Object.keys(config.shops);
}

export function distributeTaktAmongStations(lineTaktMs: number, stationCount: number): number[] {
    if (stationCount === 0) return [];

    // Importante (engenharia de produção): takt da linha NÃO deve ser dividido entre as stations.
    // Para manter o JPH coerente, cada station precisa ter cycle time < takt da linha.
    // Aqui distribuímos tempos desiguais entre 70% e <100% do takt da linha.
    const MIN_FRACTION = activeFlowPlant.stationTaktMinFraction ?? 0.7;
    const MAX_FRACTION = activeFlowPlant.stationTaktMaxFraction ?? 0.999; // nunca >= 1.0

    // Expoente < 1 puxa a distribuição para mais perto do MAX_FRACTION (mais "realista" para uma linha balanceada)
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


export class PlantFactory {

    public createShop(shopName: string): IShop {
        const shopConfig = activeFlowPlant.shops[shopName];
        if (!shopConfig) throw new Error(`Shop ${shopName} not found in config`);

        const linesMap = new Map<string, ILine>();
        const linesEntries = Object.entries(shopConfig.lines);

        for (let lineIdx = 0; lineIdx < linesEntries.length; lineIdx++) {
            const [lineName, lineConfig] = linesEntries[lineIdx];

            // Calcular tempo de produção inline para evitar criação de função a cada iteração
            const takt = lineConfig.takt;
            const startHour = parseInt(takt.shiftStart.substring(0, 2), 10);
            const startMinute = parseInt(takt.shiftStart.substring(3, 5), 10);
            const endHour = parseInt(takt.shiftEnd.substring(0, 2), 10);
            const endMinute = parseInt(takt.shiftEnd.substring(3, 5), 10);

            let timeChangeShift = 0;
            if (takt.firstShiftEnd && takt.secondeShiftStart) {
                const endHourFirstShift = parseInt(takt.firstShiftEnd.substring(0, 2), 10);
                const endMinuteFirstShift = parseInt(takt.firstShiftEnd.substring(3, 5), 10);
                const startHourSecondShift = parseInt(takt.secondeShiftStart.substring(0, 2), 10);
                const startMinuteSecondShift = parseInt(takt.secondeShiftStart.substring(3, 5), 10);
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

            const stationNames = lineConfig.stations;
            const stationCount = stationNames.length;
            const stationTakts = distributeTaktAmongStations(lineTaktMs, stationCount);

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
                });
            }

            const newLine = new Line({
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
                // Part Line fields
                partType: lineConfig.partType,
                requiredParts: lineConfig.requiredParts,
                partConsumptionStation: lineConfig.partConsumptionStation,
                createWith: lineConfig.createWith
            });

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
            allShops.set(shopKey, this.createShop(shopKey));
        }
        return allShops;
    }
}