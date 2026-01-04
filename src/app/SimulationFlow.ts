import { IShop } from "../domain/models/Shop";
import { ILine, Line } from "../domain/models/Line";
import { IStation } from "../domain/models/Station";
import { IBuffer } from "../domain/models/Buffer";
import { IStopLine, StopLine } from "../domain/models/StopLine";
import { ICar, ICarTrace } from "../domain/models/Car";
import { FlowPlant } from "../domain/config/flowPlant";
import { getActiveFlowPlant } from "../domain/factories/plantFactory";
import { CarFactory } from "../domain/factories/carFactory";
import { OEEFactory, OEEData } from "../domain/factories/OEEFactory";
import { MTTRMTBFFactory, MTTRMTBFData } from "../domain/factories/MTTRMTBFFactory";
import { TickEvent, SimulationCallbacks } from "../utils/shared";

interface FlowContext {
    shops: Map<string, IShop>;
    buffers: Map<string, IBuffer>;
    stops: Map<string, IStopLine>;
    event: TickEvent;
    callbacks?: SimulationCallbacks;
}

interface ShiftState {
    isActive: boolean;
    lastShiftDate: string;
}

export class SimulationFlow {
    private shops: Map<string, IShop>;
    private buffers: Map<string, IBuffer>;
    private stops: Map<string, IStopLine>;
    private event: TickEvent;
    private callbacks?: SimulationCallbacks;
    private cars: ICar[] = [];
    private static carFactory: CarFactory = new CarFactory();
    private static stopIdCounter: number = 10000;
    private static shiftStates: Map<string, ShiftState> = new Map();
    private static alternateReworkPull: boolean = false;
    private static readonly reworkTimeMs: number = (getActiveFlowPlant().Rework_Time || 60) * 60000;
    private static readonly dphu: number = getActiveFlowPlant().DPHU || 5;
    private static readonly TWO_HOURS_MS: number = 1 * 60 * 60 * 1000;

    // Part shortage tracking - stations waiting for parts
    private static partShortageStations: Map<string, { partType: string; startTime: number }> = new Map();

    // CreateWith tracking - tracks when a car leaves a station (for synchronized part creation)
    // Key: "shopName-lineName-stationId", Value: timestamp of last car exit
    private static stationExitThisTick: Set<string> = new Set();

    // Tracking para OEE dinâmico - armazena a última contagem de carros produzidos por linha
    private static lastCarsProducedByLine: Map<string, number> = new Map();
    // Tracking para saber se já calculou OEE no shiftend (evita duplicação)
    private static oeeCalculatedForShift: Map<string, string> = new Map();
    // Contador de ticks desde última emissão de OEE (para emissão periódica)
    private static ticksSinceLastOEEEmit: number = 0;
    private static readonly OEE_EMIT_INTERVAL_TICKS: number = 30; // Emite a cada 30 ticks (~30 segundos sim)

    private static readonly FLOW_REASONS: ReadonlyArray<string> = [
        "NEXT_FULL",
        "PREV_EMPTY",
        "Next Full",
        "Prev Empty",
        "Buffer Empty",
        "Buffer Full",
        "Part Buffer Full",
        "Rework Full",
        ""
    ];

    // Reseta todos os estados estáticos para permitir restart limpo da simulação
    public static resetStaticState(): void {
        SimulationFlow.carFactory = new CarFactory();
        SimulationFlow.stopIdCounter = 10000;
        SimulationFlow.shiftStates.clear();
        SimulationFlow.alternateReworkPull = false;
        SimulationFlow.lastCarsProducedByLine.clear();
        SimulationFlow.oeeCalculatedForShift.clear();
        SimulationFlow.partShortageStations.clear();
        SimulationFlow.stationExitThisTick.clear();
        SimulationFlow.ticksSinceLastOEEEmit = 0;
    }

    constructor(context: FlowContext) {
        this.shops = context.shops;
        this.buffers = context.buffers;
        this.stops = context.stops;
        this.event = context.event;
        this.callbacks = context.callbacks;
    }

    private emitCarsSnapshot(): void {
        this.callbacks?.onCars?.(this.cars, this.event.simulatedTimestamp);
    }

    public updateEvent(event: TickEvent): void {
        this.event = event;
    }

    public execute(): void {
        // Clear station exits tracking at the start of each tick
        SimulationFlow.stationExitThisTick.clear();

        this.checkShiftTransitions();
        this.updateScheduledStops();
        // Process stations first to track exits, then create parts
        this.processAllStations();
        this.processReworkBuffers();
        // Create cars/parts after processing to use exit tracking for createWith
        this.createCarsAtStartStations();
        this.calculateDynamicOEE();
        this.emitStopsWithDetails();
    }

    // Verifica transições de turno (início e fim)
    private checkShiftTransitions(): void {
        const simDate = new Date(this.event.simulatedTimestamp);
        // Usa UTC para consistência entre servidores com diferentes timezones
        const h = simDate.getUTCHours();
        const m = simDate.getUTCMinutes();
        const currentTimeStr = `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
        const currentDateStr = simDate.toUTCString().split(' ').slice(0, 4).join(' ');

        const flowPlant = getActiveFlowPlant();
        const flowPlantShopsEntries: [string, any][] = Object.entries(flowPlant.shops);

        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries((shopConfig as any).lines);
            for (let i = 0; i < linesEntries.length; i++) {
                const [lineName, lineConfig] = linesEntries[i];
                const lineKey = `${shopName}-${lineName}`;
                const shiftStart = (lineConfig as any).takt?.shiftStart || "07:00";
                const shiftEnd = (lineConfig as any).takt?.shiftEnd || "23:48";

                let state = SimulationFlow.shiftStates.get(lineKey);
                if (!state) {
                    state = { isActive: false, lastShiftDate: "" };
                    SimulationFlow.shiftStates.set(lineKey, state);
                }

                // Fim do turno - limpa paradas da linha e calcula OEE/MTTR/MTBF
                if (currentTimeStr === shiftEnd && state.isActive) {
                    state.isActive = false;
                    this.log(`SHIFT_END: ${lineKey}`);

                    // Calcula OEE e MTTR/MTBF ao final do turno
                    this.calculateShiftEndMetrics(shopName, lineName, lineConfig, currentDateStr);
                }

                // Início do turno - recria paradas para novo dia
                if (currentTimeStr === shiftStart && state.lastShiftDate !== currentDateStr) {
                    this.clearLineStops(shopName, lineName);
                    this.regenerateLineStops(shopName, lineName, lineConfig);
                    state.isActive = true;
                    state.lastShiftDate = currentDateStr;
                    this.log(`SHIFT_START: ${lineKey}`);
                }
            }
        }
    }

    // Limpa todas as paradas de uma linha
    private clearLineStops(shopName: string, lineName: string): void {
        const keysToDelete: string[] = [];
        for (const [id, stop] of this.stops) {
            if (stop.shop === shopName && stop.line === lineName) {
                keysToDelete.push(id);
            }
        }
        for (const key of keysToDelete) {
            this.stops.delete(key);
        }

        // Evita estado inconsistente: pode existir station com isStopped=true mesmo após remover StopLines.
        const shop = this.shops.get(shopName);
        if (shop) {
            const line = this.getLineFromShop(shop, lineName);
            if (line) {
                const stations = line.stations;
                for (let i = 0; i < stations.length; i++) {
                    stations[i].isStopped = false;
                    stations[i].stopReason = undefined;
                    stations[i].stopId = undefined;
                    stations[i].startStop = 0;
                    stations[i].finishStop = 0;
                }
            }
        }
        this.log(`STOPS_CLEARED: ${shopName}/${lineName} (${keysToDelete.length} stops)`);
    }

    // Regenera paradas planejadas e aleatórias para uma linha
    private regenerateLineStops(shopName: string, lineName: string, lineConfig: any): void {
        const simDate = new Date(this.event.simulatedTimestamp);
        // Usa UTC para consistência entre servidores
        const dayStart = Date.UTC(simDate.getUTCFullYear(), simDate.getUTCMonth(), simDate.getUTCDate(), 0, 0, 0, 0);

        const flowPlant = getActiveFlowPlant();

        // Gera paradas planejadas
        if (flowPlant.plannedStops) {
            for (const stop of flowPlant.plannedStops) {
                if (stop.affectsShops && !stop.affectsShops.includes(shopName)) continue;
                if (stop.daysOfWeek?.includes(simDate.getUTCDay()) === false) continue;

                const [hour, minute] = stop.startTime.split(":").map(Number);
                const startTimeTs = dayStart + (hour * 60 + minute) * 60 * 1000;
                const durationMs = stop.durationMn * 60 * 1000;

                const newStop = new StopLine({
                    id: ++SimulationFlow.stopIdCounter,
                    shop: shopName,
                    line: lineName,
                    station: "ALL",
                    reason: stop.name,
                    startTime: startTimeTs,
                    endTime: startTimeTs + durationMs,
                    status: "PLANNED",
                    severity: "LOW",
                    type: "PLANNED",
                    category: stop.type as any,
                    durationMs
                });
                this.stops.set(newStop.id.toString(), newStop);
                // Persiste a parada planejada no banco de dados
                this.callbacks?.onStopGenerated?.(newStop);
            }
        }

        // Gera paradas aleatórias baseadas em MTBF/MTTR
        const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig);
        const mtbfMinutes = lineConfig.MTBF;
        const mttrMinutes = lineConfig.MTTR;
        const numStops = Math.floor(productionTimeMinutes / mtbfMinutes);

        if (numStops > 0) {
            const stations = lineConfig.stations || [];
            const productionTimeMs = productionTimeMinutes * 60 * 1000;

            const [shiftStartHour, shiftStartMinute] = (lineConfig.takt?.shiftStart || "07:00").split(":").map(Number);
            const shiftStartTs = dayStart + (shiftStartHour * 60 + shiftStartMinute) * 60 * 1000;

            for (let i = 0; i < numStops; i++) {
                const randomStation = stations[Math.floor(Math.random() * stations.length)];
                const startTime = shiftStartTs + Math.floor(Math.random() * productionTimeMs);
                const severity = this.randomSeverity();
                const durationMs = this.randomDurationBySeverity(severity, mttrMinutes);

                const newStop = new StopLine({
                    id: ++SimulationFlow.stopIdCounter,
                    shop: shopName,
                    line: lineName,
                    station: randomStation,
                    reason: "Random failure",
                    startTime,
                    endTime: startTime + durationMs,
                    status: "PLANNED",
                    severity,
                    type: "RANDOM_GENERATE",
                    category: "PROCESS_QUALITY_FAILURE",
                    durationMs
                });
                this.stops.set(newStop.id.toString(), newStop);
                // Persiste a parada aleatória no banco de dados
                this.callbacks?.onStopGenerated?.(newStop);
            }
        }

        this.log(`STOPS_REGENERATED: ${shopName}/${lineName}`);
    }

    private getProductionTimeMinutes(shopName: string, lineConfig: any): number {
        const [startHour, startMinute] = (lineConfig.takt?.shiftStart || "07:00").split(":").map(Number);
        const [endHour, endMinute] = (lineConfig.takt?.shiftEnd || "23:48").split(":").map(Number);

        let totalMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
        if (totalMinutes < 0) totalMinutes += 24 * 60;

        const flowPlant = getActiveFlowPlant();
        if (flowPlant.plannedStops) {
            for (const stop of flowPlant.plannedStops) {
                if (!stop.affectsShops || stop.affectsShops.includes(shopName)) {
                    totalMinutes -= stop.durationMn;
                }
            }
        }
        return totalMinutes;
    }

    // Calcula métricas de OEE e MTTR/MTBF ao final do turno
    private calculateShiftEndMetrics(shopName: string, lineName: string, lineConfig: any, dateStr: string): void {
        const lineKey = `${shopName}-${lineName}`;
        const shiftKey = `${lineKey}-${dateStr}`;

        // Evita calcular duas vezes no mesmo dia/linha
        if (SimulationFlow.oeeCalculatedForShift.get(lineKey) === dateStr) {
            return;
        }
        SimulationFlow.oeeCalculatedForShift.set(lineKey, dateStr);

        const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig);
        const taktMinutes = 60 / ((lineConfig.takt?.jph) || 28); // JPH para minutos por carro
        const shiftStart = lineConfig.takt?.shiftStart || "07:00";
        const shiftEnd = lineConfig.takt?.shiftEnd || "23:48";

        // Encontra a última station da linha
        const shop = this.shops.get(shopName);
        if (!shop) return;

        const line = this.getLineFromShop(shop, lineName);
        if (!line) return;

        const lastStation = line.stations[line.stations.length - 1];
        if (!lastStation) return;

        // Calcula OEE para a linha
        const lineOEE = OEEFactory.calculateLineOEE({
            shop: shopName,
            line: lineName,
            productionTimeMinutes,
            taktTimeMinutes: taktMinutes,
            cars: this.cars,
            simulatedTimestamp: this.event.simulatedTimestamp,
            shiftStart,
            shiftEnd,
            lastStationId: lastStation.id
        });

        this.log(`OEE_CALCULATED: ${lineKey} = ${lineOEE.oee.toFixed(2)}% (${lineOEE.carsProduction} carros)`);
        this.callbacks?.onOEEShiftEnd?.(lineOEE);

        // Calcula MTTR/MTBF para cada station da linha
        const lineStops = MTTRMTBFFactory.getLineStops(this.stops, shopName, lineName);
        const stationMTTRMTBFData: MTTRMTBFData[] = [];

        for (const station of line.stations) {
            const stationData = MTTRMTBFFactory.calculateStationMTTRMTBF({
                shop: shopName,
                line: lineName,
                station: station.id,
                productionTimeMinutes,
                stops: lineStops,
                simulatedTimestamp: this.event.simulatedTimestamp
            });
            stationMTTRMTBFData.push(stationData);
            this.callbacks?.onMTTRMTBFCalculated?.(stationData);
        }

        // Calcula MTTR/MTBF agregado para a linha
        const lineMTTRMTBF = MTTRMTBFFactory.calculateLineMTTRMTBF(stationMTTRMTBFData, productionTimeMinutes);
        if (lineMTTRMTBF) {
            this.log(`MTTR/MTBF_CALCULATED: ${lineKey} - MTTR: ${lineMTTRMTBF.mttr.toFixed(2)}min, MTBF: ${lineMTTRMTBF.mtbf.toFixed(2)}min`);
            this.callbacks?.onMTTRMTBFCalculated?.(lineMTTRMTBF);
        }

        // Verifica se todas as linhas do shop terminaram para calcular agregados do shop
        this.checkAndCalculateShopMetrics(shopName, dateStr);
    }

    // Verifica se todas as linhas de um shop terminaram e calcula métricas agregadas
    private checkAndCalculateShopMetrics(shopName: string, dateStr: string): void {
        const flowPlant = getActiveFlowPlant();
        const shopConfig = (flowPlant.shops as any)[shopName];
        if (!shopConfig) return;

        const lines = Object.keys(shopConfig.lines);
        const allLinesFinished = lines.every(lineName => {
            const lineKey = `${shopName}-${lineName}`;
            return SimulationFlow.oeeCalculatedForShift.get(lineKey) === dateStr;
        });

        if (!allLinesFinished) return;

        // Coleta OEE de todas as linhas do shop
        const lineOEEs: OEEData[] = [];
        const lineMTTRMTBFs: MTTRMTBFData[] = [];

        for (const lineName of lines) {
            const lineConfig = shopConfig.lines[lineName];
            const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig);
            const taktMinutes = 60 / ((lineConfig.takt?.jph) || 28);
            const shiftStart = lineConfig.takt?.shiftStart || "07:00";
            const shiftEnd = lineConfig.takt?.shiftEnd || "23:48";

            const shop = this.shops.get(shopName);
            if (!shop) continue;

            const line = this.getLineFromShop(shop, lineName);
            if (!line) continue;

            const lastStation = line.stations[line.stations.length - 1];
            if (!lastStation) continue;

            const lineOEE = OEEFactory.calculateLineOEE({
                shop: shopName,
                line: lineName,
                productionTimeMinutes,
                taktTimeMinutes: taktMinutes,
                cars: this.cars,
                simulatedTimestamp: this.event.simulatedTimestamp,
                shiftStart,
                shiftEnd,
                lastStationId: lastStation.id
            });
            lineOEEs.push(lineOEE);

            // MTTR/MTBF agregado da linha
            const lineStops = MTTRMTBFFactory.getLineStops(this.stops, shopName, lineName);
            const stationMTTRMTBFData: MTTRMTBFData[] = [];
            for (const station of line.stations) {
                stationMTTRMTBFData.push(MTTRMTBFFactory.calculateStationMTTRMTBF({
                    shop: shopName,
                    line: lineName,
                    station: station.id,
                    productionTimeMinutes,
                    stops: lineStops,
                    simulatedTimestamp: this.event.simulatedTimestamp
                }));
            }
            const lineMTTRMTBF = MTTRMTBFFactory.calculateLineMTTRMTBF(stationMTTRMTBFData, productionTimeMinutes);
            if (lineMTTRMTBF) {
                lineMTTRMTBFs.push(lineMTTRMTBF);
            }
        }

        // Calcula OEE do shop (média das linhas)
        const shopOEE = OEEFactory.calculateShopOEE(lineOEEs);
        if (shopOEE) {
            this.log(`OEE_SHOP_CALCULATED: ${shopName} = ${shopOEE.oee.toFixed(2)}%`);
            this.callbacks?.onOEEShiftEnd?.(shopOEE);
        }

        // Calcula MTTR/MTBF do shop (média das linhas)
        const shopMTTRMTBF = MTTRMTBFFactory.calculateShopMTTRMTBF(lineMTTRMTBFs);
        if (shopMTTRMTBF) {
            this.log(`MTTR/MTBF_SHOP_CALCULATED: ${shopName} - MTTR: ${shopMTTRMTBF.mttr.toFixed(2)}min, MTBF: ${shopMTTRMTBF.mtbf.toFixed(2)}min`);
            this.callbacks?.onMTTRMTBFCalculated?.(shopMTTRMTBF);
        }
    }

    // Calcula OEE dinâmico e emite se houver mudança na produção
    private calculateDynamicOEE(): void {
        const oeeResults: OEEData[] = [];
        let hasChange = false;

        const flowPlant = getActiveFlowPlant();
        const flowPlantShopsEntries: [string, any][] = Object.entries(flowPlant.shops);
        for (const [shopName, shopConfig] of flowPlantShopsEntries) {
            const linesEntries = Object.entries((shopConfig as any).lines);

            for (const [lineName, lineConfig] of linesEntries) {
                const lineKey = `${shopName}-${lineName}`;
                const productionTimeMinutes = this.getProductionTimeMinutes(shopName, lineConfig as any);
                const taktMinutes = 60 / (((lineConfig as any).takt?.jph) || 28);
                const shiftStart = (lineConfig as any).takt?.shiftStart || "07:00";
                const shiftEnd = (lineConfig as any).takt?.shiftEnd || "23:48";

                const shop = this.shops.get(shopName);
                if (!shop) continue;

                const line = this.getLineFromShop(shop, lineName);
                if (!line) continue;

                const lastStation = line.stations[line.stations.length - 1];
                if (!lastStation) continue;

                // Calcula OEE dinâmico
                const oeeData = OEEFactory.calculateDynamicOEE({
                    shop: shopName,
                    line: lineName,
                    productionTimeMinutes,
                    taktTimeMinutes: taktMinutes,
                    cars: this.cars,
                    simulatedTimestamp: this.event.simulatedTimestamp,
                    shiftStart,
                    shiftEnd,
                    lastStationId: lastStation.id
                });

                oeeResults.push(oeeData);

                // Verifica se houve mudança na produção OU se é a primeira vez
                const lastCount = SimulationFlow.lastCarsProducedByLine.get(lineKey);
                if (lastCount === undefined || oeeData.carsProduction !== lastCount) {
                    hasChange = true;
                    SimulationFlow.lastCarsProducedByLine.set(lineKey, oeeData.carsProduction);
                }
            }
        }

        // Incrementa contador de ticks
        SimulationFlow.ticksSinceLastOEEEmit++;

        // Emite OEE se houve mudança OU a cada intervalo (para manter clientes atualizados)
        const shouldEmitPeriodic = SimulationFlow.ticksSinceLastOEEEmit >= SimulationFlow.OEE_EMIT_INTERVAL_TICKS;
        if (hasChange || shouldEmitPeriodic) {
            this.callbacks?.onOEECalculated?.(oeeResults);
            SimulationFlow.ticksSinceLastOEEEmit = 0;
        }
    }

    // Coleta paradas aleatórias (RANDOM_GENERATE) para emissão
    private getRandomStops(): IStopLine[] {
        const randomStops: IStopLine[] = [];
        for (const [id, stop] of this.stops) {
            if (stop.type === 'RANDOM_GENERATE') {
                randomStops.push(stop);
            }
        }
        return randomStops;
    }

    // Emite stops com detalhes (planned e random)
    private emitStopsWithDetails(): void {
        const flowPlant = getActiveFlowPlant();
        const plannedStops = flowPlant.plannedStops || [];
        const randomStops = this.getRandomStops();
        this.callbacks?.onStopsWithDetails?.(this.stops, plannedStops, randomStops);
    }

    private randomSeverity(): "LOW" | "MEDIUM" | "HIGH" {
        const rand = Math.random();
        if (rand < 0.7) return "LOW";
        if (rand < 0.95) return "MEDIUM";
        return "HIGH";
    }

    private randomDurationBySeverity(severity: "LOW" | "MEDIUM" | "HIGH", mttrMinutes: number): number {
        const ranges = { LOW: { min: 1, max: 5 }, MEDIUM: { min: 5, max: 10 }, HIGH: { min: 10, max: 60 } };
        const range = ranges[severity];
        const baseDuration = (range.min + Math.random() * (range.max - range.min)) * 60 * 1000;
        const scaleFactor = mttrMinutes / 5;
        return Math.round(baseDuration * scaleFactor);
    }

    // Atualiza status das paradas agendadas (PLANNED -> IN_PROGRESS -> COMPLETED)
    private updateScheduledStops(): void {
        const nowTs = this.event.simulatedTimestamp;

        for (const [id, stop] of this.stops) {
            // Stops de PROPAGATION (NEXT_FULL/PREV_EMPTY) são controladas por startFlowStop/endFlowStop.
            // Não devem ser encerradas por tempo aqui.
            if (stop.type === "PROPAGATION") {
                continue;
            }

            if (stop.status === "PLANNED" && nowTs >= stop.startTime) {
                // Verifica se alguma station afetada ainda não recebeu carro
                if (this.shouldDelayStop(stop)) {
                    // Se por algum motivo a station já ficou marcada como parada, limpa antes de reagendar
                    this.removeStopFromStations(stop);

                    // Reagenda para daqui 2 horas a partir de AGORA (evita loop quando stop.startTime estava no passado)
                    const durationMs = stop.durationMs ?? Math.max(0, stop.endTime - stop.startTime);
                    stop.startTime = nowTs + SimulationFlow.TWO_HOURS_MS;
                    stop.endTime = stop.startTime + durationMs;
                    stop.durationMs = durationMs;
                    continue;
                }
                stop.status = "IN_PROGRESS";
                this.applyStopToStations(stop);
                this.log(`STOP_START: ${stop.shop}/${stop.line}/${stop.station} - ${stop.reason}`);
                this.callbacks?.onStopStarted?.(
                    stop.id.toString(),
                    stop.shop,
                    stop.line,
                    stop.station,
                    stop.reason,
                    stop.category,
                    this.event.simulatedTimestamp
                );
                this.callbacks?.onStopStartedStopLine?.(stop);
            }

            if (stop.status === "IN_PROGRESS" && nowTs >= stop.endTime) {
                stop.status = "COMPLETED";
                this.removeStopFromStations(stop);
                this.log(`STOP_END: ${stop.shop}/${stop.line}/${stop.station} - ${stop.reason}`);
                this.callbacks?.onStopEnded?.(
                    stop.id.toString(),
                    stop.shop,
                    stop.line,
                    stop.station,
                    stop.reason,
                    stop.durationMs || 0,
                    this.event.simulatedTimestamp
                );
                this.callbacks?.onStopEndedStopLine?.(stop);
            }
        }
    }

    // Aplica parada nas stations afetadas
    private applyStopToStations(stop: IStopLine): void {
        const stations = this.getAffectedStations(stop);
        for (const station of stations) {
            if (station.stopReason) {
                // Se já existe uma parada de flow na station, encerra antes de aplicar uma parada real (PLANNED/RANDOM)
                if (stop.type !== "PROPAGATION" && station.isStopped && (SimulationFlow.FLOW_REASONS.includes(station.stopReason || "") || station.stopReason.startsWith("LACK-"))) {
                    this.endFlowStop(station, "NEXT_FULL");
                }
            }

            station.isStopped = true;
            station.stopReason = stop.reason;
            // Station sempre guarda timestamps absolutos (epoch) para evitar confusão com ms desde meia-noite
            station.startStop = this.event.simulatedTimestamp;
            station.finishStop = stop.endTime;
            station.stopId = stop.id.toString();
        }
    }

    // Remove parada das stations
    private removeStopFromStations(stop: IStopLine): void {
        const stations = this.getAffectedStations(stop);
        for (const station of stations) {
            const sameStopId = station.stopId === stop.id.toString();
            const sameReason = (station.stopReason || "") === (stop.reason || "");
            const isPropagation = stop.type === "PROPAGATION";

            // Para PLANNED/RANDOM, limpamos também por reason (mais resiliente contra estados inconsistentes)
            if (sameStopId || (!isPropagation && sameReason)) {
                station.isStopped = false;
                station.stopReason = undefined;
                station.stopId = undefined;
                station.startStop = 0;
                station.finishStop = 0;
            }
        }
    }

    // Retorna stations afetadas por uma parada
    private getAffectedStations(stop: IStopLine): IStation[] {
        const shop = this.shops.get(stop.shop);
        if (!shop) return [];

        const line = this.getLineFromShop(shop, stop.line);
        if (!line) return [];

        if (stop.station === "ALL") {
            return line.stations;
        }

        const wantsExactMatch = stop.station.includes("-");
        const station = wantsExactMatch
            ? line.stations.find((s: IStation) => s.id === stop.station)
            : line.stations.find((s: IStation) => s.id.endsWith(`-${stop.station}`));
        return station ? [station] : [];
    }

    // Verifica se a parada deve ser atrasada (alguma station ainda não recebeu carro)
    private shouldDelayStop(stop: IStopLine): boolean {
        const stations = this.getAffectedStations(stop);

        // Se a station não existe (config/lookup), não inicia agora
        if (stations.length === 0) return true;

        // Random failures NUNCA devem iniciar em station sem carro
        if (stop.type === "RANDOM_GENERATE") {
            return stations.some(s => !s.occupied || !s.currentCar || s.isStopped);
        }

        // Regra original: não iniciar paradas planejadas enquanto alguma station ainda não recebeu o primeiro carro
        return stations.some(s => s.isFirstCar === true);
    }

    // Cria carros nas stations de início de produção
    private createCarsAtStartStations(): void {
        const flowPlant = getActiveFlowPlant();
        const startStations = flowPlant.stationstartProduction;
        if (!startStations) return;

        const len = startStations.length;
        for (let i = 0; i < len; i++) {
            const config = startStations[i];
            const station = this.getStation(config.shop, config.line, config.station);
            if (!station) continue;

            // Get line to check if it's a part line
            const shop = this.shops.get(config.shop);
            if (!shop) continue;
            const line = this.getLineFromShop(shop, config.line);

            if (!station.occupied && !this.isStationBlocked(station)) {
                let car: ICar;

                // Check if this is a part line (has partType)
                if (line?.partType) {
                    // Check if this part line has createWith constraint
                    if (line.createWith) {
                        // Only create part if there was an exit from the specified station this tick
                        const exitHappened = this.hasStationExitThisTick(
                            config.shop,  // Same shop as the part line
                            line.createWith.line,
                            line.createWith.station
                        );
                        if (!exitHappened) {
                            // No exit happened, skip creating this part
                            continue;
                        }
                    }

                    // Create a part instead of a car
                    car = SimulationFlow.carFactory.createPart(
                        this.event.simulatedTimestamp,
                        line.partType
                    );
                    this.log(`PART_CREATED: ${car.id} (${line.partType}) at ${station.id}`);
                    this.callbacks?.onPartCreated?.(
                        car.id,
                        line.partType,
                        car.model,
                        station.shop,
                        station.line,
                        station.id,
                        this.event.simulatedTimestamp
                    );
                } else {
                    // =====================================================================
                    // PART VALIDATION AT CAR CREATION:
                    // Se a linha requer peças na s1 (estação de criação), ANTES de criar
                    // o carro precisamos verificar se todas as peças estão disponíveis.
                    // Se não estiverem, não criamos o carro (o carro não pode "nascer" sem peças).
                    // 
                    // LÓGICA DE MATCHING DE MODELO:
                    // 1. Encontrar todos os modelos disponíveis na primeira peça requerida
                    // 2. Para cada modelo, verificar se existem peças de TODOS os tipos com esse modelo
                    // 3. Se encontrar um modelo válido, criar carro e consumir peças
                    // =====================================================================
                    if (line?.requiredParts && line.requiredParts.length > 0) {
                        const consumptionStation = line.partConsumptionStation || "s1";
                        // Check if any required parts need to be consumed at s1 (creation station)
                        const partsNeededAtCreation = line.requiredParts.filter(rp => {
                            const partConsumeStation = rp.consumeStation || consumptionStation;
                            return station.id.includes(partConsumeStation);
                        });

                        if (partsNeededAtCreation.length > 0) {
                            // Collect all part buffers we need
                            const partBuffers: Map<string, IBuffer> = new Map();
                            let allBuffersExist = true;

                            for (const requiredPart of partsNeededAtCreation) {
                                const partBufferId = `${station.shop}-PARTS-${requiredPart.partType}`;
                                let partBuffer = this.buffers.get(partBufferId);

                                if (!partBuffer) {
                                    const altBufferId = this.findPartBufferForLine(station.shop, line.line, requiredPart.partType);
                                    if (altBufferId) {
                                        partBuffer = this.buffers.get(altBufferId);
                                    }
                                }

                                if (!partBuffer || partBuffer.cars.length === 0) {
                                    // No parts available for this type
                                    const lackReason = `LACK-${requiredPart.partType}`;
                                    const stationKey = `${station.id}-${requiredPart.partType}`;

                                    if (!SimulationFlow.partShortageStations.has(stationKey)) {
                                        SimulationFlow.partShortageStations.set(stationKey, {
                                            partType: requiredPart.partType,
                                            startTime: this.event.simulatedTimestamp
                                        });

                                        this.startFlowStop(station, lackReason, lackReason);
                                        this.log(`PART_SHORTAGE_CREATION: ${station.id} cannot create car - no ${requiredPart.partType} parts available`);

                                        this.callbacks?.onPartShortage?.(
                                            "PENDING_CAR",
                                            requiredPart.partType,
                                            "ANY",
                                            station.shop,
                                            station.line,
                                            station.id,
                                            this.event.simulatedTimestamp
                                        );
                                    }

                                    allBuffersExist = false;
                                    break;
                                }

                                partBuffers.set(requiredPart.partType, partBuffer);
                            }

                            if (!allBuffersExist) {
                                // Skip car creation - parts not available
                                continue;
                            }

                            // Find a model that has parts available in ALL buffers
                            // Get all unique models from the first buffer
                            const firstBuffer = partBuffers.values().next().value as IBuffer | undefined;
                            if (!firstBuffer) {
                                continue;
                            }

                            const availableModels = new Set<string>();
                            for (const part of firstBuffer.cars) {
                                if (part.isPart) {
                                    availableModels.add(part.model);
                                }
                            }

                            // Find a model that exists in ALL buffers
                            let matchingModel: string | null = null;
                            for (const model of availableModels) {
                                let modelExistsInAll = true;
                                for (const buffer of partBuffers.values()) {
                                    const hasModel = buffer.cars.some(p => p.isPart && p.model === model);
                                    if (!hasModel) {
                                        modelExistsInAll = false;
                                        break;
                                    }
                                }
                                if (modelExistsInAll) {
                                    matchingModel = model;
                                    // End all LACK stops for each required part type individually
                                    for (const requiredPart of partsNeededAtCreation) {
                                        const lackReason = `LACK-${requiredPart.partType}`;
                                        const stationKey = `${station.id}-${requiredPart.partType}`;
                                        if (SimulationFlow.partShortageStations.has(stationKey)) {
                                            SimulationFlow.partShortageStations.delete(stationKey);
                                        }
                                        this.endFlowStop(station, lackReason);
                                    }
                                    break;
                                }
                            }

                            if (!matchingModel) {
                                // No matching model found across all part types
                                const firstPartType = partsNeededAtCreation[0].partType;
                                const lackReason = `LACK-${firstPartType}`;
                                const stationKey = `${station.id}-${firstPartType}`;

                                if (!SimulationFlow.partShortageStations.has(stationKey)) {
                                    SimulationFlow.partShortageStations.set(stationKey, {
                                        partType: firstPartType,
                                        startTime: this.event.simulatedTimestamp
                                    });

                                    this.startFlowStop(station, lackReason, lackReason);
                                    this.log(`PART_SHORTAGE_CREATION: ${station.id} no matching model across all required parts`);
                                }

                                continue;
                            }

                            // All parts are available with matching model - create car
                            car = SimulationFlow.carFactory.createCarWithModel(
                                this.event.simulatedTimestamp,
                                SimulationFlow.dphu,
                                matchingModel
                            );

                            // Consume the parts immediately since we're creating the car
                            for (const requiredPart of partsNeededAtCreation) {
                                const partBuffer = partBuffers.get(requiredPart.partType);

                                if (partBuffer) {
                                    const partIndex = partBuffer.cars.findIndex(p => p.model === car.model && p.isPart);
                                    if (partIndex !== -1) {
                                        const consumedPart = partBuffer.cars.splice(partIndex, 1)[0];
                                        partBuffer.currentCount--;
                                        this.updateBufferStatus(partBuffer);

                                        // End any existing shortage stop for this part type
                                        const stationKey = `${station.id}-${requiredPart.partType}`;
                                        if (SimulationFlow.partShortageStations.has(stationKey)) {
                                            SimulationFlow.partShortageStations.delete(stationKey);
                                            this.endFlowStop(station, `LACK-${requiredPart.partType}`);
                                        }

                                        this.log(`PART_CONSUMED_AT_CREATION: ${consumedPart.id} (${requiredPart.partType}) for ${car.id} (${car.model}) at ${station.id}`);

                                        this.callbacks?.onPartConsumed?.(
                                            consumedPart.id,
                                            requiredPart.partType,
                                            car.model,
                                            car.id,
                                            station.shop,
                                            station.line,
                                            station.id,
                                            this.event.simulatedTimestamp
                                        );
                                    }
                                }
                            }
                        } else {
                            // Parts needed at different stations, not at creation
                            car = SimulationFlow.carFactory.createRandomCar(
                                this.event.simulatedTimestamp,
                                SimulationFlow.dphu
                            );
                        }
                    } else {
                        // Create a normal car (no parts required)
                        car = SimulationFlow.carFactory.createRandomCar(
                            this.event.simulatedTimestamp,
                            SimulationFlow.dphu
                        );
                    }

                    this.log(`CAR_CREATED: ${car.id} at ${station.id}`);
                    this.callbacks?.onCarCreated?.(
                        car.id,
                        station.shop,
                        station.line,
                        station.id,
                        this.event.simulatedTimestamp
                    );
                }

                this.cars.push(car);

                // Usa o mesmo caminho de entrada de carro das outras movimentações:
                // - seta occupied/currentCar/carEnteredAt
                // - marca isFirstCar=false depois do primeiro carro
                // - adiciona trace de entrada
                this.placeCarInStation(station, car);

                car.addShopLeadtime({
                    shop: station.shop,
                    enteredAt: this.event.simulatedTimestamp
                });

                // Emite lista completa de carros (estrutura completa) sempre que cria um novo
                this.emitCarsSnapshot();
            }
        }
    }

    // Processa todas as stations (ordem reversa para evitar conflito)
    private processAllStations(): void {
        for (const [shopName, shop] of this.shops) {
            const lines = this.getLinesFromShop(shop);
            const linesLen = lines.length;
            for (let l = 0; l < linesLen; l++) {
                const line = lines[l];
                // Processa da última para primeira (evita conflito de movimentação)
                const stations = line.stations;
                for (let i = stations.length - 1; i >= 0; i--) {
                    this.processStation(stations[i], line, shop);
                }
            }
        }
        SimulationFlow.alternateReworkPull = !SimulationFlow.alternateReworkPull;
    }

    // Processa uma station individual
    private processStation(station: IStation, line: ILine, shop: IShop): void {
        if (!station.occupied) {
            this.tryPullCar(station, line, shop);
            return;
        }

        const carReady = this.isCarReadyToMove(station);
        if (carReady) {
            this.tryPushCar(station, line, shop);
        }
    }

    // Verifica se o carro completou o takt time na station
    private isCarReadyToMove(station: IStation): boolean {
        const enteredAt = (station as any).carEnteredAt as number;
        if (!enteredAt) return true;

        const elapsed = this.event.simulatedTimestamp - enteredAt;
        const taktMs = station.taktMn * 60000;
        return elapsed >= taktMs;
    }

    // Verifica se a station está bloqueada por parada não-flow (PLANNED/RANDOM)
    private isStationBlocked(station: IStation): boolean {
        if (!station.isStopped) return false;
        if (station.stopReason && station.stopReason.startsWith("LACK-")) return false;
        // Paradas de flow (NEXT_FULL/PREV_EMPTY) não bloqueiam tentativas
        return !SimulationFlow.FLOW_REASONS.includes(station.stopReason || "");

    }

    // Tenta puxar carro da station/buffer anterior
    private tryPullCar(station: IStation, line: ILine, shop: IShop): void {
        if (this.isStationBlocked(station)) return;

        // Primeira station da linha
        if (station.isFirstStation) {
            this.tryPullFromBuffer(station, line, shop);
            return;
        }

        // Station intermediária - puxa da anterior
        const prevStation = this.getPreviousStation(station, line);
        if (!prevStation) return;

        if (!prevStation.occupied || !this.isCarReadyToMove(prevStation)) {
            this.startFlowStop(station, "PREV_EMPTY", "Prev Empty");
            return;
        }

        this.endFlowStop(station, "PREV_EMPTY");
        this.moveCar(prevStation, station);
    }

    // Tenta puxar do buffer (normal ou rework alternadamente)
    private tryPullFromBuffer(station: IStation, line: ILine, shop: IShop): void {
        // Verifica se é station inicial de produção
        const flowPlant = getActiveFlowPlant();
        const startStations = flowPlant.stationstartProduction;
        if (startStations) {
            const len = startStations.length;
            for (let i = 0; i < len; i++) {
                const s = startStations[i];
                if (s.shop === station.shop && s.line === station.line && station.id.includes(s.station)) {
                    return;
                }
            }
        }

        const bufferId = this.findInputBufferId(station.shop, station.line);
        const reworkBufferId = this.findReworkBufferId(station.shop);

        // Alternância entre buffer normal e rework
        if (SimulationFlow.alternateReworkPull && reworkBufferId) {
            if (this.tryPullFromReworkBuffer(station, reworkBufferId)) return;
            if (bufferId) this.tryPullFromNormalBuffer(station, bufferId);
        } else {
            if (bufferId && this.tryPullFromNormalBuffer(station, bufferId)) return;
            if (reworkBufferId) this.tryPullFromReworkBuffer(station, reworkBufferId);
        }
    }

    // Puxa do buffer normal
    private tryPullFromNormalBuffer(station: IStation, bufferId: string): boolean {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) {
            this.startFlowStop(station, "PREV_EMPTY", "Buffer Empty");
            return false;
        }

        this.endFlowStop(station, "PREV_EMPTY");
        const car = buffer.cars.shift()!;
        buffer.currentCount--;
        this.updateBufferStatus(buffer);

        this.placeCarInStation(station, car);
        this.log(`BUFFER_OUT: ${car.id} from ${bufferId} to ${station.id}`);
        this.callbacks?.onBufferOut?.(
            car.id,
            bufferId,
            station.shop,
            station.line,
            station.id,
            this.event.simulatedTimestamp
        );

        // Emite snapshot de carros após movimentação buffer -> station
        this.emitCarsSnapshot();
        return true;
    }

    // Puxa do buffer de rework (só carros que completaram Rework_Time)
    private tryPullFromReworkBuffer(station: IStation, bufferId: string): boolean {
        const buffer = this.buffers.get(bufferId);
        if (!buffer || buffer.cars.length === 0) return false;

        // Encontra carro que completou rework
        const cars = buffer.cars;
        const len = cars.length;
        let readyCarIndex = -1;
        for (let i = 0; i < len; i++) {
            const car = cars[i];
            if (car.reworkEnteredAt) {
                const elapsed = this.event.simulatedTimestamp - car.reworkEnteredAt;
                if (elapsed >= SimulationFlow.reworkTimeMs) {
                    readyCarIndex = i;
                    break;
                }
            }
        }

        if (readyCarIndex === -1) return false;

        const car = buffer.cars.splice(readyCarIndex, 1)[0];
        buffer.currentCount--;
        this.updateBufferStatus(buffer);

        // Finaliza rework no carro
        car.inRework = false;
        car.reworkCompletedAt = this.event.simulatedTimestamp;

        this.placeCarInStation(station, car);
        this.log(`REWORK_OUT: ${car.id} from ${bufferId} to ${station.id}`);
        this.callbacks?.onReworkOut?.(
            car.id,
            bufferId,
            station.shop,
            station.id,
            this.event.simulatedTimestamp
        );
        this.callbacks?.onReworkOutDetailed?.(
            car.id,
            bufferId,
            station.shop,
            station.line,
            station.id,
            this.event.simulatedTimestamp
        );

        // Emite snapshot de carros após movimentação rework-buffer -> station
        this.emitCarsSnapshot();
        return true;
    }

    // Coloca carro na station
    private placeCarInStation(station: IStation, car: ICar): void {
        // Se por algum motivo sobrou estado de parada de flow na station, limpa antes de receber novo carro.
        // Isso evita station "suja" (isStopped/stopReason/startStop/finishStop) mesmo após StopLine ter sido finalizada.
        if (station.isStopped && (SimulationFlow.FLOW_REASONS.includes(station.stopReason || "") || (station.stopReason || "").startsWith("LACK-"))) {
            station.isStopped = false;
            station.stopReason = undefined;
            station.stopId = undefined;
            station.startStop = 0;
            station.finishStop = 0;
        }

        station.currentCar = car;
        station.occupied = true;
        (station as any).carEnteredAt = this.event.simulatedTimestamp;

        // Marca que a station já recebeu pelo menos um carro
        if (station.isFirstCar) {
            station.isFirstCar = false;
        }

        car.addTrace({
            shop: station.shop,
            line: station.line,
            station: station.id,
            enter: this.event.simulatedTimestamp
        });
    }

    /**
     * Validates and consumes required parts for a station before allowing the car to move.
     * If parts are not available, starts a LACK-{PART} stop.
     * @param station The station that requires parts
     * @param line The line configuration
     * @param car The car that needs parts
     * @returns true if all parts are available (or no parts required), false if waiting for parts
     */
    private validateAndConsumeParts(station: IStation, line: ILine, car: ICar | null | undefined): boolean {
        // Skip if no car in station - can't have LACK stop without a car present
        if (!car) return true;

        // Skip if line has no required parts
        if (!line.requiredParts || line.requiredParts.length === 0) return true;

        // Skip if car is a part AND line has no requiredParts
        // (parts CAN consume other parts if the line explicitly requires them)
        if (car.isPart && (!line.requiredParts || line.requiredParts.length === 0)) return true;

        // Check if this is the consumption station for any required part
        const consumptionStation = line.partConsumptionStation || "s1";
        const isConsumptionStation = station.id.includes(consumptionStation);

        if (!isConsumptionStation) {
            // Also check per-part consumeStation
            const hasPartForThisStation = line.requiredParts.some(rp =>
                rp.consumeStation && station.id.includes(rp.consumeStation)
            );
            if (!hasPartForThisStation) return true;
        }

        // Check each required part
        for (const requiredPart of line.requiredParts) {
            // Check if this station should consume this part
            const partConsumeStation = requiredPart.consumeStation || consumptionStation;
            if (!station.id.includes(partConsumeStation)) continue;

            // Find the part buffer for this shop and part type
            const partBufferId = `${station.shop}-PARTS-${requiredPart.partType}`;
            const partBuffer = this.buffers.get(partBufferId);

            if (!partBuffer) {
                // No buffer found - check if there's a part buffer anywhere that feeds this line
                // This could happen if the part line is in a different shop
                const altBufferId = this.findPartBufferForLine(station.shop, line.line, requiredPart.partType);
                if (!altBufferId) {
                    // Part buffer doesn't exist in config, skip this part requirement
                    this.log(`WARN: Part buffer not found for ${requiredPart.partType} in ${station.shop}`);
                    continue;
                }
            }

            const bufferToCheck = partBuffer || this.buffers.get(this.findPartBufferForLine(station.shop, line.line, requiredPart.partType) || "");
            if (!bufferToCheck) continue;

            // Check if there's a part available for this car's model
            const partIndex = bufferToCheck.cars.findIndex(p => p.model === car.model && p.isPart);

            if (partIndex === -1) {
                // No part available - start LACK-{PART} stop
                const lackReason = `LACK-${requiredPart.partType}`;
                const stationKey = `${station.id}-${requiredPart.partType}`;

                if (!SimulationFlow.partShortageStations.has(stationKey)) {
                    SimulationFlow.partShortageStations.set(stationKey, {
                        partType: requiredPart.partType,
                        startTime: this.event.simulatedTimestamp
                    });

                    this.startFlowStop(station, lackReason, lackReason);
                    this.log(`PART_SHORTAGE: ${station.id} waiting for ${requiredPart.partType} (model: ${car.model})`);

                    this.callbacks?.onPartShortage?.(
                        car.id,
                        requiredPart.partType,
                        car.model,
                        station.shop,
                        station.line,
                        station.id,
                        this.event.simulatedTimestamp
                    );
                }

                return false;
            }

            // Consume the part
            const consumedPart = bufferToCheck.cars.splice(partIndex, 1)[0];
            bufferToCheck.currentCount--;
            this.updateBufferStatus(bufferToCheck);

            // End any existing shortage stop for this part type
            const stationKey = `${station.id}-${requiredPart.partType}`;
            if (SimulationFlow.partShortageStations.has(stationKey)) {
                SimulationFlow.partShortageStations.delete(stationKey);
                this.endFlowStop(station, `LACK-${requiredPart.partType}`);
            }

            this.log(`PART_CONSUMED: ${consumedPart.id} (${requiredPart.partType}) for ${car.id} (${car.model}) at ${station.id}`);

            this.callbacks?.onPartConsumed?.(
                consumedPart.id,
                requiredPart.partType,
                car.model,
                car.id,
                station.shop,
                station.line,
                station.id,
                this.event.simulatedTimestamp
            );
        }

        return true;
    }

    /**
     * Finds a part buffer that feeds a specific line
     */
    private findPartBufferForLine(shopName: string, lineName: string, partType: string): string | undefined {
        // First try the standard format
        const standardId = `${shopName}-PARTS-${partType}`;
        if (this.buffers.has(standardId)) return standardId;

        // Search for any part buffer of this type that points to this line
        for (const [bufferId, buffer] of this.buffers) {
            if (buffer.type === "PART_BUFFER" && bufferId.includes(partType)) {
                if (buffer.to === `${shopName}-${lineName}` || buffer.to.includes(lineName)) {
                    return bufferId;
                }
            }
        }

        return undefined;
    }

    // Tenta enviar carro para próxima station/buffer
    private tryPushCar(station: IStation, line: ILine, shop: IShop): void {
        if (this.isStationBlocked(station)) return;

        const car = station.currentCar;
        if (!car) return;

        // Validate and consume required parts before allowing car to proceed
        if (!this.validateAndConsumeParts(station, line, car)) {
            return; // Waiting for parts, cannot proceed
        }

        // Última station da linha - envia para buffer
        if (station.isLastStation) {
            this.tryPushToBuffer(station, line, shop, car);
            return;
        }

        // Station intermediária - envia para próxima
        const nextStation = this.getNextStation(station, line);
        if (!nextStation) return;

        if (nextStation.occupied || this.isStationBlocked(nextStation)) {
            this.startFlowStop(station, "NEXT_FULL", "Next Full");
            return;
        }

        this.endFlowStop(station, "NEXT_FULL");
        this.moveCar(station, nextStation);
    }

    // Envia carro para buffer
    private tryPushToBuffer(station: IStation, line: ILine, shop: IShop, car: ICar): void {
        // =====================================================================
        // PART LINE HANDLING:
        // Se esta é uma Part Line (linha que produz peças), precisamos verificar:
        // 1. Se o destino do buffer é OUTRA Part Line → usar buffer normal (fluxo de peça continua)
        // 2. Se o destino do buffer é uma Car Line → usar Part Buffer final
        // O Part Buffer final é nomeado: {DestShop}-PARTS-{partType}
        // =====================================================================
        if (car.isPart && line.partType) {
            const flowPlant = getActiveFlowPlant();

            // Find the buffer config for this line to know the destination
            const shopConfig = (flowPlant.shops as any)[station.shop];
            const lineConfig = shopConfig?.lines?.[line.line];
            const bufferConfig = lineConfig?.buffers?.[0];

            if (bufferConfig) {
                const destShop = bufferConfig.to.shop;
                const destLine = bufferConfig.to.line;
                const destShopConfig = (flowPlant.shops as any)[destShop];
                const destLineConfig = destShopConfig?.lines?.[destLine];

                // Check if destination is another Part Line (has partType)
                const destIsPartLine = !!destLineConfig?.partType;

                if (destIsPartLine) {
                    // Destination is another Part Line → use normal buffer flow
                    const bufferId = `${station.shop}-${line.line}-to-${destShop}-${destLine}`;
                    const buffer = this.buffers.get(bufferId);

                    if (!buffer) {
                        this.log(`WARN: Buffer ${bufferId} not found for part ${car.id}, trying Part Buffer`);
                        // Fallback to Part Buffer if normal buffer doesn't exist
                    } else {
                        if (buffer.currentCount >= buffer.capacity) {
                            this.startFlowStop(station, "NEXT_FULL", "Buffer Full");
                            return;
                        }

                        this.endFlowStop(station, "NEXT_FULL");
                        this.removeCarFromStation(station);
                        car.closeLastTrace(this.event.simulatedTimestamp);

                        buffer.cars.push(car);
                        buffer.currentCount++;
                        this.updateBufferStatus(buffer);

                        this.log(`PART_FLOW_BUFFER: ${car.id} (${car.partName}) to ${bufferId} → next Part Line: ${destLine}`);
                        this.callbacks?.onBufferIn?.(
                            car.id,
                            bufferId,
                            station.shop,
                            line.line,
                            station.id,
                            this.event.simulatedTimestamp
                        );

                        this.emitCarsSnapshot();
                        return;
                    }
                }
            }

            // Destination is a Car Line (or no valid buffer) → send to Part Buffer
            // Part Buffer is in the DESTINATION shop, not current shop
            const destShop = bufferConfig?.to?.shop || station.shop;
            const partBufferId = `${destShop}-PARTS-${line.partType}`;
            const partBuffer = this.buffers.get(partBufferId);

            if (!partBuffer) {
                // Try current shop as fallback
                const fallbackBufferId = `${station.shop}-PARTS-${line.partType}`;
                const fallbackBuffer = this.buffers.get(fallbackBufferId);

                if (!fallbackBuffer) {
                    this.log(`ERROR: Part Buffer ${partBufferId} and ${fallbackBufferId} not found for part ${car.id}`);
                    return;
                }

                if (fallbackBuffer.currentCount >= fallbackBuffer.capacity) {
                    this.startFlowStop(station, "NEXT_FULL", "Part Buffer Full");
                    return;
                }

                this.endFlowStop(station, "NEXT_FULL");
                this.removeCarFromStation(station);
                car.closeLastTrace(this.event.simulatedTimestamp);

                fallbackBuffer.cars.push(car);
                fallbackBuffer.currentCount++;
                this.updateBufferStatus(fallbackBuffer);

                this.log(`PART_BUFFER_IN: ${car.id} (${car.partName}) to ${fallbackBufferId}`);
                this.callbacks?.onBufferIn?.(
                    car.id,
                    fallbackBufferId,
                    station.shop,
                    line.line,
                    station.id,
                    this.event.simulatedTimestamp
                );

                this.emitCarsSnapshot();
                return;
            }

            if (partBuffer.currentCount >= partBuffer.capacity) {
                this.startFlowStop(station, "NEXT_FULL", "Part Buffer Full");
                return;
            }

            this.endFlowStop(station, "NEXT_FULL");
            this.removeCarFromStation(station);
            car.closeLastTrace(this.event.simulatedTimestamp);

            partBuffer.cars.push(car);
            partBuffer.currentCount++;
            this.updateBufferStatus(partBuffer);

            this.log(`PART_BUFFER_IN: ${car.id} (${car.partName}) to ${partBufferId}`);
            this.callbacks?.onBufferIn?.(
                car.id,
                partBufferId,
                station.shop,
                line.line,
                station.id,
                this.event.simulatedTimestamp
            );

            this.emitCarsSnapshot();
            return;
        }

        // Verifica se é a última station de toda a planta
        const route = this.getRouteForStation(station.shop, line.line, station.id);
        if (!route) {
            this.completeCar(station, car);
            return;
        }

        // Verifica defeito e envia para rework se necessário
        if (car.hasDefect && !car.inRework) {
            this.sendToRework(station, car, shop);
            return;
        }

        // Encontra buffer de destino
        const bufferId = this.findOutputBufferId(station.shop, line.line, route);
        const buffer = bufferId ? this.buffers.get(bufferId) : null;

        if (!buffer) {
            // Sem buffer - tenta enviar direto para próxima station
            this.tryPushDirectToNextLine(station, car, route);
            return;
        }

        if (buffer.currentCount >= buffer.capacity) {
            this.startFlowStop(station, "NEXT_FULL", "Buffer Full");
            return;
        }

        this.endFlowStop(station, "NEXT_FULL");
        this.removeCarFromStation(station);

        // Fecha trace e atualiza shop leadtime
        car.closeLastTrace(this.event.simulatedTimestamp);
        this.updateShopLeadtime(car, station.shop);

        buffer.cars.push(car);
        buffer.currentCount++;
        this.updateBufferStatus(buffer);

        this.log(`BUFFER_IN: ${car.id} from ${station.id} to ${bufferId}`);
        this.callbacks?.onBufferIn?.(
            car.id,
            bufferId!,
            station.shop,
            line.line,
            station.id,
            this.event.simulatedTimestamp
        );

        // Emite snapshot de carros após movimentação station -> buffer
        this.emitCarsSnapshot();
    }

    // Envia direto para próxima linha (sem buffer)
    private tryPushDirectToNextLine(station: IStation, car: ICar, route: any): void {
        const target = route.to[0];
        const nextStation = this.getStation(target.shop, target.line, target.station || "s1");

        if (!nextStation || nextStation.occupied || this.isStationBlocked(nextStation)) {
            this.startFlowStop(station, "NEXT_FULL", "Next Full");
            return;
        }

        this.endFlowStop(station, "NEXT_FULL");
        this.removeCarFromStation(station);
        car.closeLastTrace(this.event.simulatedTimestamp);

        // Atualiza shop leadtime se mudou de shop
        if (station.shop !== target.shop) {
            this.updateShopLeadtime(car, station.shop);
            car.addShopLeadtime({ shop: target.shop, enteredAt: this.event.simulatedTimestamp });
        }

        this.placeCarInStation(nextStation, car);
        this.log(`MOVE: ${car.id} from ${station.id} to ${nextStation.id}`);

        // Emite snapshot de carros após movimentação station -> station (sem buffer)
        this.emitCarsSnapshot();
    }

    // Envia carro para rework
    private sendToRework(station: IStation, car: ICar, shop: IShop): void {
        const reworkBufferId = `${station.shop}-REWORK`;
        const buffer = this.buffers.get(reworkBufferId);

        if (!buffer || buffer.currentCount >= buffer.capacity) {
            this.startFlowStop(station, "NEXT_FULL", "Rework Full");
            return;
        }

        this.endFlowStop(station, "NEXT_FULL");
        this.removeCarFromStation(station);

        // Gera defeito com ID incremental
        const defectId = `DEF-${++SimulationFlow.stopIdCounter}`;
        car.addDefect(defectId);
        car.inRework = true;
        car.reworkEnteredAt = this.event.simulatedTimestamp;
        car.closeLastTrace(this.event.simulatedTimestamp);

        buffer.cars.push(car);
        buffer.currentCount++;
        this.updateBufferStatus(buffer);

        this.log(`REWORK_IN: ${car.id} to ${reworkBufferId} (defect: ${defectId})`);
        this.callbacks?.onReworkIn?.(
            car.id,
            reworkBufferId,
            station.shop,
            defectId,
            this.event.simulatedTimestamp
        );
        this.callbacks?.onReworkInDetailed?.(
            car.id,
            reworkBufferId,
            station.shop,
            station.line,
            station.id,
            defectId,
            this.event.simulatedTimestamp
        );

        // Emite snapshot de carros após movimentação station -> rework-buffer
        this.emitCarsSnapshot();
    }

    // Finaliza carro (última station da planta)
    private completeCar(station: IStation, car: ICar): void {
        this.removeCarFromStation(station);
        car.closeLastTrace(this.event.simulatedTimestamp);
        car.complete(this.event.simulatedTimestamp);
        this.updateShopLeadtime(car, station.shop);

        this.log(`CAR_COMPLETED: ${car.id} at ${station.id} (total: ${car.totalLeadtimeMs}ms)`);
        this.callbacks?.onCarProduced?.(car.id);
        this.callbacks?.onCarCompleted?.(
            car.id,
            station.shop,
            station.line,
            station.id,
            car.totalLeadtimeMs!,
            this.event.simulatedTimestamp
        );
    }

    // Processa buffers de rework (tenta enviar carros prontos)
    private processReworkBuffers(): void {
        for (const [bufferId, buffer] of this.buffers) {
            if (buffer.type !== "REWORK_BUFFER") continue;
            if (buffer.cars.length === 0) continue;

            const cars = buffer.cars;
            for (let i = cars.length - 1; i >= 0; i--) {
                const car = cars[i];
                if (!car.reworkEnteredAt) continue;

                const elapsed = this.event.simulatedTimestamp - car.reworkEnteredAt;
                if (elapsed < SimulationFlow.reworkTimeMs) continue;

                // Carro pronto - será puxado pela primeira station na próxima iteração
                // Apenas loga que está disponível
                this.log(`REWORK_READY: ${car.id} in ${bufferId}`);
            }
        }
    }

    // Move carro entre stations
    private moveCar(from: IStation, to: IStation): void {
        const car = from.currentCar;
        if (!car) return;

        this.removeCarFromStation(from);
        car.closeLastTrace(this.event.simulatedTimestamp);

        // Atualiza shop leadtime se mudou de shop
        if (from.shop !== to.shop) {
            this.updateShopLeadtime(car, from.shop);
            car.addShopLeadtime({ shop: to.shop, enteredAt: this.event.simulatedTimestamp });
        }

        this.placeCarInStation(to, car);
        this.log(`MOVE: ${car.id} from ${from.id} to ${to.id}`);
        this.callbacks?.onCarMoved?.(
            car.id,
            from.shop,
            from.line,
            from.id,
            to.shop,
            to.line,
            to.id,
            this.event.simulatedTimestamp
        );

        // Emite snapshot de carros após movimentação station -> station
        this.emitCarsSnapshot();
    }

    // Remove carro da station
    private removeCarFromStation(station: IStation): void {
        // Track station exit for createWith feature
        // Extract the simple station id (e.g., "s1" from "Body-BodyMain-s1")
        const parts = station.id.split('-');
        const simpleStationId = parts[parts.length - 1];
        const exitKey = `${station.shop}-${station.line}-${simpleStationId}`;
        SimulationFlow.stationExitThisTick.add(exitKey);

        station.currentCar = null;
        station.occupied = false;
        (station as any).carEnteredAt = undefined;
    }

    /**
     * Checks if a car exited from a specific station this tick.
     * Used by createWith to synchronize part creation with car production.
     */
    private hasStationExitThisTick(shopName: string, lineName: string, stationId: string): boolean {
        const exitKey = `${shopName}-${lineName}-${stationId}`;
        return SimulationFlow.stationExitThisTick.has(exitKey);
    }

    // Atualiza leadtime do shop no carro
    private updateShopLeadtime(car: ICar, shopName: string): void {
        const leadtime = car.shopLeadtimes.find(l => l.shop === shopName && !l.exitedAt);
        if (leadtime) {
            leadtime.exitedAt = this.event.simulatedTimestamp;
            leadtime.leadtimeMs = leadtime.exitedAt - leadtime.enteredAt;
        }
    }

    // Inicia parada de flow (NEXT_FULL/PREV_EMPTY) usando StopLine
    private startFlowStop(station: IStation, type: string, reason: string): void {
        // Não inicia parada de flow se a station ainda não recebeu nenhum carro
        if (station.isFirstCar) return;

        if (station.isStopped && station.stopReason === reason) return;

        const category = type === "NEXT_FULL" ? "NEXT_FULL" : "PREV_EMPTY";
        const stop = new StopLine({
            id: ++SimulationFlow.stopIdCounter,
            shop: station.shop,
            line: station.line,
            station: station.id,
            reason,
            startTime: this.event.simulatedTimestamp,
            endTime: 0,
            status: "IN_PROGRESS",
            severity: "LOW",
            type: "PROPAGATION",
            category: category as any,
            durationMs: 0
        });

        this.stops.set(stop.id.toString(), stop);
        station.isStopped = true;
        station.stopReason = reason;
        station.startStop = this.event.simulatedTimestamp;
        station.stopId = stop.id.toString();

        this.callbacks?.onStopStarted?.(
            stop.id.toString(),
            stop.shop,
            stop.line,
            stop.station,
            stop.reason,
            stop.category,
            this.event.simulatedTimestamp
        );
        this.callbacks?.onStopStartedStopLine?.(stop);
    }

    // Finaliza parada de flow e atualiza StopLine
    private endFlowStop(station: IStation, type: string): void {
        const stopReason = station.stopReason || "";

        // Check if it's a flow reason OR a LACK-* reason (part shortage)
        const isFlowReason = SimulationFlow.FLOW_REASONS.includes(stopReason || "");
        const isLackReason = stopReason.startsWith("LACK-");

        if (!station.isStopped || (!isFlowReason && !isLackReason)) return;

        // For LACK reasons, also verify the type matches the stopReason
        // This prevents ending a LACK-ENGINE stop when we call endFlowStop with LACK-COVER
        if (isLackReason && type !== stopReason) return;

        // Atualiza o StopLine no Map
        if (station.stopId) {
            const stop = this.stops.get(station.stopId);
            if (stop && stop.type === "PROPAGATION") {
                stop.endTime = this.event.simulatedTimestamp;
                stop.status = "COMPLETED";
                stop.durationMs = stop.endTime - stop.startTime;

                this.callbacks?.onStopEnded?.(
                    stop.id.toString(),
                    stop.shop,
                    stop.line,
                    stop.station,
                    stop.reason,
                    stop.durationMs || 0,
                    this.event.simulatedTimestamp
                );
                this.callbacks?.onStopEndedStopLine?.(stop);
            }
        }

        station.isStopped = false;
        // Para flow stops não mantemos timestamps na station (evita ficar "sujo" após encerrar)
        station.startStop = 0;
        station.finishStop = 0;
        station.stopReason = undefined;
        station.stopId = undefined;
    }

    // Helpers
    private getStation(shopName: string, lineName: string, stationId: string): IStation | undefined {
        const shop = this.shops.get(shopName);
        if (!shop) return undefined;

        const line = this.getLineFromShop(shop, lineName);
        if (!line) return undefined;

        return line.stations.find((s: IStation) => s.id.includes(stationId));
    }

    private getLineFromShop(shop: IShop, lineName: string): ILine | undefined {
        if (shop.lines instanceof Map) {
            return shop.lines.get(lineName);
        }
        return (shop.lines as Record<string, any>)[lineName] as ILine | undefined;
    }

    private getLinesFromShop(shop: IShop): ILine[] {
        if (shop.lines instanceof Map) {
            return Array.from(shop.lines.values());
        }
        return Object.values(shop.lines) as ILine[];
    }

    private getPreviousStation(station: IStation, line: ILine): IStation | undefined {
        if (station.index === 0) return undefined;
        return line.stations[station.index - 1];
    }

    private getNextStation(station: IStation, line: ILine): IStation | undefined {
        if (station.index >= line.stations.length - 1) return undefined;
        return line.stations[station.index + 1];
    }

    private getRouteForStation(shopName: string, lineName: string, stationId: string): any {
        const flowPlant = getActiveFlowPlant();
        const shopConfig = (flowPlant.shops as any)[shopName];
        if (!shopConfig) return null;

        const lineConfig = shopConfig.lines[lineName];
        if (!lineConfig?.routes) return null;

        return lineConfig.routes.find((r: any) =>
            stationId.includes(r.fromStation)
        );
    }

    private findInputBufferId(shopName: string, lineName: string): string | undefined {
        // Procura buffer que aponta para esta linha
        // IMPORTANTE: Ignora PART_BUFFERs - esses são para consumo via validateAndConsumeParts,
        // não para puxar como carros normais. Peças ficam no Part Buffer até serem consumidas.
        for (const [bufferId, buffer] of this.buffers) {
            if (buffer.to === `${shopName}-${lineName}` && buffer.type !== "PART_BUFFER") {
                return bufferId;
            }
        }
        return undefined;
    }

    private findOutputBufferId(shopName: string, lineName: string, route: any): string | undefined {
        const target = route.to[0];
        // Procura buffer entre linhas
        for (const [bufferId, buffer] of this.buffers) {
            if (buffer.from === `${shopName}-${lineName}` && buffer.to.includes(target.line)) {
                return bufferId;
            }
        }
        return undefined;
    }

    private findReworkBufferId(shopName: string): string | undefined {
        return `${shopName}-REWORK`;
    }

    private updateBufferStatus(buffer: IBuffer): void {
        if (buffer.currentCount === 0) {
            buffer.status = "EMPTY";
        } else if (buffer.currentCount >= buffer.capacity) {
            buffer.status = "FULL";
        } else {
            buffer.status = "AVAILABLE";
        }
    }

    private getSimTimeMs(): number {
        // Converte horário simulado para ms desde meia-noite (UTC)
        const date = new Date(this.event.simulatedTimestamp);
        return (date.getUTCHours() * 60 + date.getUTCMinutes()) * 60 * 1000 + date.getUTCSeconds() * 1000;
    }

    private log(message: string): void {
        console.log(`[${this.event.simulatedTimeString}] ${message}`);
    }
}
