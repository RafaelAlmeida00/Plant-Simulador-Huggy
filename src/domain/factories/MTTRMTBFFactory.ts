// src/domain/factories/MTTRMTBFFactory.ts

import { IStopLine } from '../models/StopLine';
import { ILine } from '../models/Line';

export interface MTTRMTBFData {
    date: string;
    shop: string;
    line: string;
    station: string;
    mttr: number;    // Mean Time To Repair (em minutos)
    mtbf: number;    // Mean Time Between Failures (em minutos)
}

export interface MTTRMTBFCalculationInput {
    shop: string;
    line: string;
    station: string;
    productionTimeMinutes: number;
    stops: IStopLine[];
    simulatedTimestamp: number;
}

export class MTTRMTBFFactory {
    /**
     * Calcula MTTR e MTBF para uma station específica
     * MTTR = soma do tempo de paradas random failure / contagem de paradas random failure
     * MTBF = productionTime / contagem de paradas random failure
     */
    public static calculateStationMTTRMTBF(input: MTTRMTBFCalculationInput): MTTRMTBFData {
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];

        // Filtra apenas paradas do tipo RANDOM_GENERATE (as geradas no início do turno)
        const randomStops = input.stops.filter(stop => 
            stop.shop === input.shop &&
            stop.line === input.line &&
            (stop.station === input.station || stop.station === 'ALL')
        );

        const stopCount = randomStops.length;

        if (stopCount === 0) {
            return {
                date: dateStr,
                shop: input.shop,
                line: input.line,
                station: input.station,
                mttr: 0,
                mtbf: input.productionTimeMinutes
            };
        }

        // Soma o tempo total de todas as paradas random (em minutos)
        let totalStopTimeMs = 0;
        for (const stop of randomStops) {
            totalStopTimeMs += stop.durationMs || 0;
        }
        const totalStopTimeMinutes = totalStopTimeMs / 60000;

        // MTTR = soma dos tempos de parada / número de paradas
        const mttr = totalStopTimeMinutes / stopCount;

        // MTBF = productionTime / número de paradas
        const mtbf = input.productionTimeMinutes / stopCount;

        return {
            date: dateStr,
            shop: input.shop,
            line: input.line,
            station: input.station,
            mttr: Math.round(mttr * 100) / 100,
            mtbf: Math.round(mtbf * 100) / 100
        };
    }

    /**
     * Calcula MTTR/MTBF para uma linha (agregando todas as stations)
     */
    public static calculateLineMTTRMTBF(
        stationData: MTTRMTBFData[],
        productionTimeMinutes: number
    ): MTTRMTBFData | null {
        if (stationData.length === 0) return null;

        const shop = stationData[0].shop;
        const line = stationData[0].line;
        const date = stationData[0].date;

        // Para linha, usamos a média dos valores das stations
        let totalMttr = 0;
        let totalMtbf = 0;
        let validStations = 0;

        for (const data of stationData) {
            if (data.mttr > 0 || data.mtbf > 0) {
                totalMttr += data.mttr;
                totalMtbf += data.mtbf;
                validStations++;
            }
        }

        if (validStations === 0) {
            return {
                date,
                shop,
                line,
                station: 'ALL',
                mttr: 0,
                mtbf: productionTimeMinutes
            };
        }

        return {
            date,
            shop,
            line,
            station: 'ALL',
            mttr: Math.round((totalMttr / validStations) * 100) / 100,
            mtbf: Math.round((totalMtbf / validStations) * 100) / 100
        };
    }

    /**
     * Calcula MTTR/MTBF para um shop (agregando todas as linhas)
     */
    public static calculateShopMTTRMTBF(lineData: MTTRMTBFData[]): MTTRMTBFData | null {
        if (lineData.length === 0) return null;

        const shop = lineData[0].shop;
        const date = lineData[0].date;

        let totalMttr = 0;
        let totalMtbf = 0;
        let validLines = 0;

        for (const data of lineData) {
            if (data.mttr > 0 || data.mtbf > 0) {
                totalMttr += data.mttr;
                totalMtbf += data.mtbf;
                validLines++;
            }
        }

        if (validLines === 0) {
            return {
                date,
                shop,
                line: 'ALL',
                station: 'ALL',
                mttr: 0,
                mtbf: 0
            };
        }

        return {
            date,
            shop,
            line: 'ALL',
            station: 'ALL',
            mttr: Math.round((totalMttr / validLines) * 100) / 100,
            mtbf: Math.round((totalMtbf / validLines) * 100) / 100
        };
    }

    /**
     * Coleta todas as paradas de uma linha para cálculo
     */
    public static getLineStops(stops: Map<string, IStopLine>, shop: string, line: string): IStopLine[] {
        const result: IStopLine[] = [];
        for (const [id, stop] of stops) {
            if (stop.shop === shop && stop.line === line) {
                result.push(stop);
            }
        }
        return result;
    }

    /**
     * Coleta todas as stations únicas de uma lista de paradas
     */
    public static getUniqueStations(stops: IStopLine[]): string[] {
        const stationSet = new Set<string>();
        for (const stop of stops) {
            if (stop.station !== 'ALL') {
                stationSet.add(stop.station);
            }
        }
        return Array.from(stationSet);
    }
}
