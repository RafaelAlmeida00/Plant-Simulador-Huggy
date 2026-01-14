import { IStopLine, MTTRMTBFCalculationInput, MTTRMTBFData } from "../../utils/shared";

// Pre-indexed stops for O(1) lookup instead of O(n) filtering
export type StopIndex = Map<string, IStopLine[]>;

export class MTTRMTBFFactory {

    /**
     * Build stop index for O(1) lookups during MTTR/MTBF calculation
     * Call this ONCE before iterating through all stations
     */
    public static buildStopIndex(stops: IStopLine[]): StopIndex {
        const index: StopIndex = new Map();

        for (const stop of stops) {
            // Skip non-completed and planned stops
            if (stop.type === 'PLANNED' || stop.status !== 'COMPLETED') continue;

            // Index by specific station
            const stationKey = `${stop.shop}-${stop.line}-${stop.station}`;
            if (!index.has(stationKey)) index.set(stationKey, []);
            index.get(stationKey)!.push(stop);

            // Also index "ALL" station stops under a special key pattern
            // These will be merged when querying for a specific station
            if (stop.station === 'ALL') {
                const lineKey = `${stop.shop}-${stop.line}-__ALL__`;
                if (!index.has(lineKey)) index.set(lineKey, []);
                index.get(lineKey)!.push(stop);
            }
        }

        return index;
    }

    /**
     * Get pre-filtered stops for a specific station from index - O(1)
     */
    public static getStopsForStation(
        index: StopIndex,
        shop: string,
        line: string,
        station: string
    ): IStopLine[] {
        const stationKey = `${shop}-${line}-${station}`;
        const lineAllKey = `${shop}-${line}-__ALL__`;

        const stationStops = index.get(stationKey) || [];
        const allStationStops = index.get(lineAllKey) || [];

        // Combine specific station stops with "ALL" station stops
        if (allStationStops.length === 0) return stationStops;
        if (stationStops.length === 0) return allStationStops;

        return [...stationStops, ...allStationStops];
    }

    /**
     * Calculate MTTR/MTBF with pre-filtered stops (optimized path)
     * Use this when stops are already filtered via buildStopIndex
     */
    public calculateStationMTTRMTBFOptimized(
        shop: string,
        line: string,
        station: string,
        productionTimeMinutes: number,
        preFilteredStops: IStopLine[],
        simulatedTimestamp: number
    ): MTTRMTBFData {
        const simDate = new Date(simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];

        const stopCount = preFilteredStops.length;

        if (stopCount === 0) {
            return {
                date: dateStr,
                shop,
                line,
                station,
                mttr: 0,
                mtbf: productionTimeMinutes
            };
        }

        // Sum total stop time
        let totalStopTimeMs = 0;
        for (const stop of preFilteredStops) {
            totalStopTimeMs += stop.durationMs as number;
        }
        const totalStopTimeMinutes = totalStopTimeMs / 60000;

        const mttr = totalStopTimeMinutes / stopCount;
        const mtbf = productionTimeMinutes / stopCount;

        return {
            date: dateStr,
            shop,
            line,
            station,
            mttr: Math.round(mttr * 100) / 100,
            mtbf: Math.round(mtbf * 100) / 100
        };
    }

    /**
     * Original method - kept for backward compatibility
     * Consider using calculateStationMTTRMTBFOptimized with pre-indexed stops
     */
    public calculateStationMTTRMTBF(input: MTTRMTBFCalculationInput): MTTRMTBFData {
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];

        const randomStops = input.stops.filter(stop =>
            stop.shop === input.shop &&
            stop.line === input.line &&
            (stop.station === input.station || stop.station === 'ALL') &&
            stop.type !== 'PLANNED' &&
            stop.status === 'COMPLETED'
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

        let totalStopTimeMs = 0;
        for (const stop of randomStops) {
            totalStopTimeMs += stop.durationMs as number;
        }
        const totalStopTimeMinutes = totalStopTimeMs / 60000;

        const mttr = totalStopTimeMinutes / stopCount;
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


    public calculateLineMTTRMTBF(
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


    public calculateShopMTTRMTBF(lineData: MTTRMTBFData[]): MTTRMTBFData | null {
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
}
