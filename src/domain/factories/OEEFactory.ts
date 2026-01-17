// src/domain/factories/OEEFactory.ts

import { logger } from "../../utils/logger";
import { ICar, ILine, IShop, OEECalculationInput, OEEData } from "../../utils/shared";
import { CarService } from "../services/CarService";
import { PlantService } from "../services/PlantService";

export class OEEFactory {

    private carsService: CarService | null = null;
    private plantService: PlantService | null = null;

    public setPlantService(plantService: PlantService): void {
        this.plantService = plantService;
    }

    public setCarService(carsService: CarService): void {
        this.carsService = carsService;
    }

    public calculateLineOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        if (!this.carsService) {
            throw new Error('OEEFactory: CarFactory not injected. Call setCarFactory() first.');
        }

        const simDate = new Date(input.simulatedTimestamp);

        const dateStr = simDate.toISOString().split('T')[0];
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);
        const [startHour, startMinute] = input.shiftStart.split(':').map(Number);
        const shiftStartTs = dayStart + (startHour * 60 + startMinute) * 60 * 1000;

        const line: ILine = input.line as ILine;
        const carsProduction = this.carsService.getCompletedCardByLineCount(line)

        const productionTime = input.productionTimeMinutes;
        const taktTime = input.taktTimeMinutes;

        // diffTime = productionTime - (taktTime * carsProduction)
        const diffTime = productionTime - (taktTime * carsProduction);

        // OEE = ((taktTime * carsProduction) / productionTime) * 100
        const oee = productionTime > 0
            ? ((taktTime * carsProduction) / productionTime) * 100
            : 0;

        let jph;
        if (isDynamic) {
            jph = carsProduction / ((input.simulatedTimestamp - shiftStartTs) / 3600000); // carros por hora
        } else {
            jph = carsProduction / (productionTime / 60); // carros por hora
        }

        return {
            date: dateStr,
            shop: input.shop,
            line: input.line,
            productionTime,
            carsProduction,
            taktTime,
            diffTime,
            oee: Math.round(oee * 100) / 100,  // Arredonda para 2 casas decimais
            jph: jph
        };
    }

    public calculateShopOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        if (!this.carsService) {
            throw new Error('OEEFactory: CarFactory not injected. Call setCarFactory() first.');
        }
        if (!this.plantService) {
            throw new Error('OEEFactory: plantService not injected. Call setplantService() first.');
        }

        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);
        const [startHour, startMinute] = input.shiftStart.split(':').map(Number);
        const shiftStartTs = dayStart + (startHour * 60 + startMinute) * 60 * 1000;

        const shop: IShop = input.shop as IShop;
        const totalCarsProduction = this.carsService.getCompletedCardByShopCount(shop);

        // Para shop com linhas paralelas: dividir carsProduction pelo número de linhas
        // para obter média por linha, já que productionTime é a MÉDIA das linhas
        const carsProduction = totalCarsProduction;

        const productionTime = input.productionTimeMinutes;
        const taktTime = input.taktTimeMinutes;

        // diffTime = productionTime - (taktTime * carsProduction)
        const diffTime = productionTime - (taktTime * carsProduction);

        // OEE = ((taktTime * carsProduction) / productionTime) * 100
        const oee = productionTime > 0
            ? ((taktTime * carsProduction) / productionTime) * 100
            : 0;

        let jph;
        if (isDynamic) {
            jph = totalCarsProduction / ((input.simulatedTimestamp - shiftStartTs) / 3600000); // carros por hora (total da shop)
        } else {
            jph = totalCarsProduction / (productionTime / 60); // carros por hora (total da shop)
        }

        return {
            date: dateStr,
            shop: input.shop,
            line: input.line,
            productionTime,
            carsProduction: totalCarsProduction,  // Retornar total para referência, mas OEE usa média
            taktTime,
            diffTime,
            oee: Math.round(oee * 100) / 100,  // Arredonda para 2 casas decimais
            jph: jph
        };
    }

    public calculateOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        if (!this.plantService) {
            throw new Error('OEEFactory: plantService not injected. Call setplantService() first.');
        }

        const shops = this.plantService.getShopsKeys();
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];
        let results: OEEData = {
            date: dateStr,
            shop: 'ALL',
            line: 'ALL',
            productionTime: 0,      // em minutos
            carsProduction: 0,
            taktTime: 0,            // em minutos
            diffTime: 0,            // em minutos
            oee: 0,                 // percentual (0-100)
            jph: 0,                 // carros por hora
        }
        for (let i = 0; i < shops.length; i++) {
            let inputParsed: OEECalculationInput = {
                ...input, // Copia as propriedades de input
                shop: this.plantService.getById("shop", shops[i]) as IShop,
                line: "ALL"
            };

            const calc = this.calculateShopOEE(inputParsed, isDynamic);

            results.productionTime += calc.productionTime;
            results.carsProduction += calc.carsProduction;
            results.diffTime += calc.diffTime;
            // Somamos para tirar a média depois
            results.taktTime += calc.taktTime;
            results.oee += calc.oee;
            results.jph += calc.jph;
        }

        // 2. Calcular as médias e totais finais (Evitando divisão por zero)
        if (shops.length > 0) {
            results.taktTime /= shops.length;
            results.oee /= shops.length;
            results.jph /= shops.length;
            // productionTime e carsProduction permanecem como a soma total
        }
        return results;
    }


    public calculateDynamicOEE(input: OEECalculationInput, type: "shop" | "line" | "ALL"): OEEData {
        const isDynamic = true;
        if (type === "shop") {
            return this.calculateShopOEE(input, isDynamic)
        }
        if (type === "line") {
            return this.calculateLineOEE(input, isDynamic)
        }
        if (type === "ALL") {
            return this.calculateOEE(input, isDynamic)
        }
        return logger().error("OEEFactory: Tipo de cálculo de OEE dinâmico inválido"), {} as OEEData;
    }

}
