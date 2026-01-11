// src/domain/services/OEEService.ts

import { OEECalculationInput, OEEData } from "../../utils/shared";
import { OEEFactory } from "../factories/OEEFactory";
import { CarService } from "./CarService";
import { PlantService } from "./PlantService";


export class OEEService {
    private oeeFactory: OEEFactory;

    constructor(
        oeeFactory: OEEFactory,
        carService: CarService,
        plantService: PlantService
    ) {
        this.oeeFactory = oeeFactory;
        // Injetar factories no OEEFactory
        this.oeeFactory.setCarService(carService);
        this.oeeFactory.setPlantService(plantService);
    }

    public calculateLineOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        return this.oeeFactory.calculateLineOEE(input, isDynamic);
    }

    public calculateShopOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        return this.oeeFactory.calculateShopOEE(input, isDynamic);
    }

    public calculateOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        return this.oeeFactory.calculateOEE(input, isDynamic);
    }

    public calculateDynamicOEE(input: OEECalculationInput, type: "shop" | "line" | "ALL"): OEEData {
        return this.oeeFactory.calculateDynamicOEE(input, type);
    }
}
