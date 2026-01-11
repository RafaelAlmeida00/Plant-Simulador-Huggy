// src/adapters/http/websocket/SimulationEventEmitter.ts

import { socketServer } from '../adapters/http/websocket/SocketServer';
import { ICar, IBuffer, IStopLine, OEEData, OEEDataEmit, MTTRMTBFData, IShop, ILine, PlantSnapshot } from '../utils/shared';
import {
    CarEventRepository,
    StopEventRepository,
    BufferStateRepository,
    PlantSnapshotRepository,
    OEERepository,
    MTTRMTBFRepository
} from '../adapters/database/repositories';
import { getActiveFlowPlant } from '../domain/factories/plantFactory';

export class SimulationEventEmitter {
    private static instance: SimulationEventEmitter | null = null;
    private carEventRepo: CarEventRepository;
    private stopEventRepo: StopEventRepository;
    private bufferStateRepo: BufferStateRepository;
    private plantSnapshotRepo: PlantSnapshotRepository;
    private oeeRepo: OEERepository;
    private mttrmtbfRepo: MTTRMTBFRepository;
    private persistEnabled: boolean = true;
    private lastBufferEmit: number = 0;
    private lastBufferPersist: number = 0; // Controle separado para persistência de buffers
    private lastPlantEmit: number = 0;
    private lastStopsEmit: number = 0;
    private lastOEEEmit: number = 0;
    private lastCarsEmit: number = 0; // Controle separado para emissão de cars
    private pendingOEEDataMap: Map<string, OEEData> = new Map();
    private flowPlantConfig = getActiveFlowPlant();

    private constructor() {
        this.carEventRepo = new CarEventRepository();
        this.stopEventRepo = new StopEventRepository();
        this.bufferStateRepo = new BufferStateRepository();
        this.plantSnapshotRepo = new PlantSnapshotRepository();
        this.oeeRepo = new OEERepository();
        this.mttrmtbfRepo = new MTTRMTBFRepository();
    }

    public static getInstance(): SimulationEventEmitter {
        if (!SimulationEventEmitter.instance) {
            SimulationEventEmitter.instance = new SimulationEventEmitter();
        }
        return SimulationEventEmitter.instance;
    }

    public setPersistEnabled(enabled: boolean): void {
        this.persistEnabled = enabled;
    }

    public async emitCars(cars: Map<string, ICar>, _timestamp?: number): Promise<void> {
        const now = Date.now();

        if (now - this.lastCarsEmit >= this.flowPlantConfig.CARS_EMIT_INTERVAL) {
            this.lastCarsEmit = now;
            const carsArray = Array.from(cars.values());
            socketServer.emitCars(carsArray);
        }
    }

    public async emitCarCreated(carId: string, shop: string, line: string, station: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'CREATED' as const,
            shop,
            line,
            station,
            timestamp
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'CREATED',
                    shop,
                    line,
                    station,
                    timestamp
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting car created event:', error);
            }
        }
    }

    public async emitCarMoved(carId: string, fromShop: string, fromLine: string, fromStation: string,
        toShop: string, toLine: string, toStation: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'MOVED' as const,
            shop: toShop,
            line: toLine,
            station: toStation,
            timestamp,
            data: { from: { shop: fromShop, line: fromLine, station: fromStation } }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'MOVED',
                    shop: toShop,
                    line: toLine,
                    station: toStation,
                    timestamp,
                    data: { from: { shop: fromShop, line: fromLine, station: fromStation } }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting car moved event:', error);
            }
        }
    }

    public async emitCarCompleted(carId: string, shop: string, line: string, station: string,
        timestamp: number, totalLeadtimeMs: number): Promise<void> {
        const event = {
            carId,
            eventType: 'COMPLETED' as const,
            shop,
            line,
            station,
            timestamp,
            data: { totalLeadtimeMs }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'COMPLETED',
                    shop,
                    line,
                    station,
                    timestamp,
                    data: { totalLeadtimeMs }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting car completed event:', error);
            }
        }
    }

    public async emitBufferIn(carId: string, bufferId: string, shop: string, line: string,
        station: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'BUFFER_IN' as const,
            shop,
            line,
            station,
            timestamp,
            data: { bufferId }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'BUFFER_IN',
                    shop,
                    line,
                    station,
                    timestamp,
                    data: { bufferId }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting buffer in event:', error);
            }
        }
    }

    public async emitBufferOut(carId: string, bufferId: string, shop: string, line: string,
        station: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'BUFFER_OUT' as const,
            shop,
            line,
            station,
            timestamp,
            data: { bufferId }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'BUFFER_OUT',
                    shop,
                    line,
                    station,
                    timestamp,
                    data: { bufferId }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting buffer out event:', error);
            }
        }
    }

    public async emitReworkIn(carId: string, bufferId: string, shop: string, line: string,
        station: string, defectId: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'REWORK_IN' as const,
            shop,
            line,
            station,
            timestamp,
            data: { bufferId, defectId }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'REWORK_IN',
                    shop,
                    line,
                    station,
                    timestamp,
                    data: { bufferId, defectId }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting rework in event:', error);
            }
        }
    }

    public async emitReworkOut(carId: string, bufferId: string, shop: string, line: string,
        station: string, timestamp: number): Promise<void> {
        const event = {
            carId,
            eventType: 'REWORK_OUT' as const,
            shop,
            line,
            station,
            timestamp,
            data: { bufferId }
        };

        if (this.persistEnabled) {
            try {
                await this.carEventRepo.create({
                    car_id: carId,
                    event_type: 'REWORK_OUT',
                    shop,
                    line,
                    station,
                    timestamp,
                    data: { bufferId }
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting rework out event:', error);
            }
        }
    }

    public async emitStopStarted(stop: IStopLine): Promise<void> {

        if (this.persistEnabled) {
            try {
                await this.stopEventRepo.create({
                    stop_id: stop.id.toString(),
                    shop: stop.shop,
                    line: stop.line,
                    station: stop.station,
                    reason: stop.reason,
                    severity: stop.severity || undefined,
                    type: stop.type,
                    category: stop.category,
                    start_time: stop.startTime,
                    end_time: stop.endTime,
                    status: stop.status,
                    duration_ms: stop.durationMs
                });
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting stop started event:', error);
            }
        }
    }

    public async emitStopEnded(stop: IStopLine): Promise<void> {

        if (this.persistEnabled) {
            try {
                const existing = await this.stopEventRepo.findByStopId(stop.id.toString());
                if (existing && existing.id) {
                    await this.stopEventRepo.update(existing.id, {
                        status: 'COMPLETED',
                        end_time: stop.endTime,
                        duration_ms: stop.durationMs
                    });
                }
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting stop ended event:', error);
            }
        }
    }

    public emitAllStops(stops: Map<string, IStopLine>): void {
        const now = Date.now();
        if (now - this.lastStopsEmit < this.flowPlantConfig.STOPS_EMIT_INTERVAL) {
            return;
        }
        this.lastStopsEmit = now;
        socketServer.emitAllStops(stops);
    }

    public async emitAllBuffers(buffers: Map<string, IBuffer>, timestamp: number): Promise<void> {
        const now = Date.now();

        if (now - this.lastBufferEmit >= this.flowPlantConfig.BUFFER_EMIT_INTERVAL) {
            this.lastBufferEmit = now;
            socketServer.emitAllBuffers(buffers);
        }
    }

    public async emitPlantState(snapshot: PlantSnapshot): Promise<void> {
        socketServer.emitPlantState(snapshot);
    }

    public emitHealth(status: {
        serverStatus: 'healthy' | 'unhealthy';
        simulatorStatus: 'running' | 'stopped' | 'paused';
        timestamp: number;
        simulatorTimestamp: number;
        simulatorTimeString: string;
        uptime: number;
    }): void {
        socketServer.emitHealth(status);
    }

    private transformSingleOEEData(data: OEEData): OEEDataEmit {
        return {
            date: data.date,
            shop: typeof data.shop === 'string' ? data.shop : (data.shop as IShop).name,
            line: typeof data.line === 'string' ? data.line : (data.line as ILine).id,
            productionTime: data.productionTime,
            carsProduction: data.carsProduction,
            taktTime: data.taktTime,
            diffTime: data.diffTime,
            oee: data.oee,
            jph: data.jph
        };
    }

    private transformOEEDataForEmit(oeeData: OEEData | OEEData[]): OEEDataEmit[] {
        const dataArray = Array.isArray(oeeData) ? oeeData : [oeeData];
        return dataArray.map(data => this.transformSingleOEEData(data));
    }

    private getOEEKey(shop: string | any, line: string | any): string {
        const shopStr = typeof shop === 'string' ? shop : (shop as any).name || String(shop);
        const lineStr = typeof line === 'string' ? line : (line as any).id || String(line);
        return `${shopStr}::${lineStr}`;
    }

    public emitOEE(oeeData: OEEData | OEEData[]): void {
        const now = Date.now();

        const newData = Array.isArray(oeeData) ? oeeData : [oeeData];

        for (const data of newData) {
            const key = this.getOEEKey(data.shop, data.line);
            this.pendingOEEDataMap.set(key, data);
        }

        if (now - this.lastOEEEmit < this.flowPlantConfig.OEE_EMIT_INTERVAL) {
            return;
        }

        this.lastOEEEmit = now;
        if (this.pendingOEEDataMap.size > 0) {
            const dataArray = Array.from(this.pendingOEEDataMap.values());
            const dataToEmit = this.transformOEEDataForEmit(dataArray);
            socketServer.emitOEE(dataToEmit);
            console.log(`[EVENT_EMITTER] Emitted ${dataToEmit.length} deduplicated OEE records`);
            this.pendingOEEDataMap.clear();
        }
    }

    public flushPendingOEE(): void {
        if (this.pendingOEEDataMap.size > 0) {
            const dataArray = Array.from(this.pendingOEEDataMap.values());
            const dataToEmit = this.transformOEEDataForEmit(dataArray);
            socketServer.emitOEE(dataToEmit);
            console.log(`[EVENT_EMITTER] Flushed ${dataToEmit.length} deduplicated OEE records to new client`);
            this.lastOEEEmit = Date.now();
        }
    }

    public async persistOEE(oeeData: OEEData): Promise<void> {
        if (!this.persistEnabled) return;

        try {
            await this.oeeRepo.create({
                date: oeeData.date,
                shop: String(oeeData.shop),
                line: String(oeeData.line),
                production_time: oeeData.productionTime,
                cars_production: oeeData.carsProduction,
                takt_time: oeeData.taktTime,
                diff_time: oeeData.diffTime,
                oee: oeeData.oee
            });
        } catch (error) {
            console.error('[EVENT_EMITTER] Error persisting OEE:', error);
        }
    }

    public async persistMTTRMTBF(data: MTTRMTBFData): Promise<void> {
        if (!this.persistEnabled) return;

        try {
            await this.mttrmtbfRepo.create({
                date: data.date,
                shop: data.shop,
                line: data.line,
                station: data.station,
                mttr: data.mttr,
                mtbf: data.mtbf
            });
        } catch (error) {
            console.error('[EVENT_EMITTER] Error persisting MTTR/MTBF:', error);
        }
    }

}

export const simulationEventEmitter = SimulationEventEmitter.getInstance();
