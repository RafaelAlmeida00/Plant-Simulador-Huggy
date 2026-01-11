// src/domain/services/MTTRMTBFService.ts

import { MTTRMTBFCalculationInput, MTTRMTBFData } from "../../utils/shared";
import { MTTRMTBFFactory } from "../factories/MTTRMTBFFactory";


export class MTTRMTBFService {
    private mttrMtbfFactory: MTTRMTBFFactory;

    constructor(mttrMtbfFactory: MTTRMTBFFactory) {
        this.mttrMtbfFactory = mttrMtbfFactory;
    }

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
