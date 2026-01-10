// src/domain/factories/OEEFactory.ts

import { logger } from "../../utils/logger";
import { ICar, ILine, IShop, OEECalculationInput, OEEData } from "../../utils/shared";
import { CarFactory } from "./carFactory";
import { PlantFactory } from "./plantFactory";

export class OEEFactory {

    private carsFactory: CarFactory;
    private plantFactory: PlantFactory;

    constructor(plantFactory?: PlantFactory, carsFactory?: CarFactory) {
        this.plantFactory = plantFactory as PlantFactory;
        this.carsFactory = carsFactory as CarFactory;
    }

    public calculateLineOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);
        const [startHour, startMinute] = input.shiftStart.split(':').map(Number);
        const shiftStartTs = dayStart + (startHour * 60 + startMinute) * 60 * 1000;

        const line: ILine = input.line as ILine;
        const carsProduction = this.carsFactory.getCompletedCardByLineCount(line.id)

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
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);
        const [startHour, startMinute] = input.shiftStart.split(':').map(Number);
        const shiftStartTs = dayStart + (startHour * 60 + startMinute) * 60 * 1000;

        const shop: IShop = input.shop as IShop;
        const carsProduction = this.carsFactory.getCompletedCardByShopCount(shop.name)

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

    public calculateOEE(input: OEECalculationInput, isDynamic: boolean): OEEData {
        const shops = this.plantFactory.getShopsKeys();
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
                shop: this.plantFactory.getById("shop", shops[i]) as IShop,
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
