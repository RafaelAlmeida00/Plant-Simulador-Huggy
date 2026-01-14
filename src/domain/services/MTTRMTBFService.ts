// src/domain/services/MTTRMTBFService.ts

import { IStopLine, MTTRMTBFCalculationInput, MTTRMTBFData } from "../../utils/shared";
import { MTTRMTBFFactory, StopIndex } from "../factories/MTTRMTBFFactory";


export class MTTRMTBFService {
    private mttrMtbfFactory: MTTRMTBFFactory;

    constructor(mttrMtbfFactory: MTTRMTBFFactory) {
        this.mttrMtbfFactory = mttrMtbfFactory;
    }

    /**
     * Build pre-indexed stops for O(1) lookups - call ONCE before batch calculations
     */
    public buildStopIndex(stops: IStopLine[]): StopIndex {
        return MTTRMTBFFactory.buildStopIndex(stops);
    }

    /**
     * Get pre-filtered stops from index - O(1) instead of O(n)
     */
    public getStopsForStation(index: StopIndex, shop: string, line: string, station: string): IStopLine[] {
        return MTTRMTBFFactory.getStopsForStation(index, shop, line, station);
    }

    /**
     * Optimized calculation using pre-filtered stops
     */
    public calculateStationMTTRMTBFOptimized(
        shop: string,
        line: string,
        station: string,
        productionTimeMinutes: number,
        preFilteredStops: IStopLine[],
        simulatedTimestamp: number
    ): MTTRMTBFData {
        return this.mttrMtbfFactory.calculateStationMTTRMTBFOptimized(
            shop, line, station, productionTimeMinutes, preFilteredStops, simulatedTimestamp
        );
    }

    /**
     * Original method - kept for backward compatibility
     */
    public calculateStationMTTRMTBF(input: MTTRMTBFCalculationInput): MTTRMTBFData {
        return this.mttrMtbfFactory.calculateStationMTTRMTBF(input);
    }

    public calculateLineMTTRMTBF(
        stationData: MTTRMTBFData[],
        productionTimeMinutes: number
    ): MTTRMTBFData | null {
        return this.mttrMtbfFactory.calculateLineMTTRMTBF(stationData, productionTimeMinutes);
    }

    public calculateShopMTTRMTBF(lineData: MTTRMTBFData[]): MTTRMTBFData | null {
        return this.mttrMtbfFactory.calculateShopMTTRMTBF(lineData);
    }
}
