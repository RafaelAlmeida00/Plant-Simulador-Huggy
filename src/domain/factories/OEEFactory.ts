// src/domain/factories/OEEFactory.ts

import { ICar, ICarTrace } from '../models/Car';
import { ILine } from '../models/Line';
import { IShop } from '../models/Shop';

export interface OEEData {
    date: string;
    shop: string;
    line: string;
    productionTime: number;       // em minutos
    carsProduction: number;
    taktTime: number;             // em minutos
    diffTime: number;             // em minutos
    oee: number;                  // percentual (0-100)
}

export interface OEECalculationInput {
    shop: string;
    line: string;
    productionTimeMinutes: number;
    taktTimeMinutes: number;
    cars: ICar[];
    simulatedTimestamp: number;
    shiftStart: string;           // "07:00"
    shiftEnd: string;             // "23:48"
    lastStationId: string;        // ID da última station da linha
}

export class OEEFactory {
    /**
     * Calcula OEE para uma linha específica
     */
    public static calculateLineOEE(input: OEECalculationInput): OEEData {
        const simDate = new Date(input.simulatedTimestamp);
        const dateStr = simDate.toISOString().split('T')[0];

        // Calcula o shiftStart e shiftEnd em timestamp para o dia (usando UTC para consistência)
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);
        const [startHour, startMinute] = input.shiftStart.split(':').map(Number);
        const shiftStartTs = dayStart + (startHour * 60 + startMinute) * 60 * 1000;

        // Conta carros produzidos
        // Um carro é considerado produzido quando tem trace na última station da linha
        // com enter E leave, e o leave >= shiftStart do mesmo dia
        const carsProduction = OEEFactory.countCarsProduced(
            input.cars,
            input.shop,
            input.line,
            input.lastStationId,
            shiftStartTs,
            dateStr
        );

        const productionTime = input.productionTimeMinutes;
        const taktTime = input.taktTimeMinutes;

        // diffTime = productionTime - (taktTime * carsProduction)
        const diffTime = productionTime - (taktTime * carsProduction);

        // OEE = ((taktTime * carsProduction) / productionTime) * 100
        const oee = productionTime > 0 
            ? ((taktTime * carsProduction) / productionTime) * 100 
            : 0;

        return {
            date: dateStr,
            shop: input.shop,
            line: input.line,
            productionTime,
            carsProduction,
            taktTime,
            diffTime,
            oee: Math.round(oee * 100) / 100  // Arredonda para 2 casas decimais
        };
    }

    /**
     * Conta quantos carros foram produzidos (saíram da última station) no turno atual
     */
    public static countCarsProduced(
        cars: ICar[],
        shop: string,
        line: string,
        lastStationId: string,
        shiftStartTs: number,
        dateStr: string
    ): number {
        let count = 0;

        for (const car of cars) {
            for (const trace of car.trace) {
                // Verifica se o trace é da última station da linha
                if (trace.shop === shop && 
                    trace.line === line && 
                    (trace.station === lastStationId || trace.station.endsWith(`-${lastStationId.split('-').pop()}`))) {
                    
                    // Verifica se tem enter E leave
                    if (trace.enter && trace.leave) {
                        // Verifica se o leave é >= shiftStart
                        if (trace.leave >= shiftStartTs) {
                            // Verifica se é do mesmo dia
                            const leaveDate = new Date(trace.leave).toISOString().split('T')[0];
                            if (leaveDate === dateStr) {
                                count++;
                                break; // Um carro só conta uma vez para essa linha
                            }
                        }
                    }
                }
            }
        }

        return count;
    }

    /**
     * Calcula OEE médio para um shop (agregando todas as linhas)
     */
    public static calculateShopOEE(lineOEEs: OEEData[]): OEEData | null {
        if (lineOEEs.length === 0) return null;

        const shop = lineOEEs[0].shop;
        const date = lineOEEs[0].date;

        let totalProductionTime = 0;
        let totalCarsProduction = 0;
        let totalTaktTimeCars = 0;

        for (const lineOee of lineOEEs) {
            totalProductionTime += lineOee.productionTime;
            totalCarsProduction += lineOee.carsProduction;
            totalTaktTimeCars += lineOee.taktTime * lineOee.carsProduction;
        }

        const avgTaktTime = totalCarsProduction > 0 
            ? totalTaktTimeCars / totalCarsProduction 
            : 0;

        const diffTime = totalProductionTime - totalTaktTimeCars;
        const oee = totalProductionTime > 0 
            ? (totalTaktTimeCars / totalProductionTime) * 100 
            : 0;

        return {
            date,
            shop,
            line: 'ALL',
            productionTime: totalProductionTime,
            carsProduction: totalCarsProduction,
            taktTime: Math.round(avgTaktTime * 100) / 100,
            diffTime: Math.round(diffTime * 100) / 100,
            oee: Math.round(oee * 100) / 100
        };
    }

    /**
     * Calcula OEE dinâmico para emissão em tempo real via WebSocket
     * Usado durante a simulação para calcular OEE parcial
     */
    public static calculateDynamicOEE(input: OEECalculationInput): OEEData {
        return OEEFactory.calculateLineOEE(input);
    }

    /**
     * Extrai a última station de uma linha
     */
    public static getLastStationId(line: ILine): string {
        const lastStation = line.stations[line.stations.length - 1];
        return lastStation?.id || '';
    }
}
