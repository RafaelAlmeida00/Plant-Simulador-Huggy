import { MTTRMTBFCalculationInput, MTTRMTBFData } from "../../utils/shared";

export class MTTRMTBFFactory {

    public calculateStationMTTRMTBF(input: MTTRMTBFCalculationInput): MTTRMTBFData {
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
            totalStopTimeMs += stop.durationMs as number;
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
