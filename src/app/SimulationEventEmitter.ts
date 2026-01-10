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
    private pendingOEEData: OEEData[] | null = null; // Guarda último OEE para não perder
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

    // Emite estado completo da lista de carros (estrutura completa do Car)
    public async emitCars(cars: Map<string, ICar>, _timestamp?: number): Promise<void> {
        const now = Date.now();

        // Emissão WebSocket: a cada CARS_EMIT_INTERVAL (10 segundos por padrão)
        if (now - this.lastCarsEmit >= this.flowPlantConfig.CARS_EMIT_INTERVAL) {
            this.lastCarsEmit = now;
            const carsArray = Array.from(cars.values());
            socketServer.emitCars(carsArray);
        }
    }

    // Emite evento de carro criado
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

    // Emite evento de carro movido
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

    // Emite evento de carro completado
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

    // Emite evento de carro entrando em buffer
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

    // Emite evento de carro saindo de buffer
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

    // Emite evento de carro entrando em rework
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

    // Emite evento de carro saindo de rework
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

    // Emite evento de parada iniciada
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

    // Emite evento de parada finalizada
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

    // Emite estado atual de todos os stops (com throttling)
    public emitAllStops(stops: Map<string, IStopLine>): void {
        const now = Date.now();
        if (now - this.lastStopsEmit < this.flowPlantConfig.STOPS_EMIT_INTERVAL) {
            return;
        }
        this.lastStopsEmit = now;
        socketServer.emitAllStops(stops);
    }

    // Emite estado atual de todos os buffers
    public async emitAllBuffers(buffers: Map<string, IBuffer>, timestamp: number): Promise<void> {
        const now = Date.now();

        // Emissão WebSocket: a cada 5 segundos
        if (now - this.lastBufferEmit >= this.flowPlantConfig.BUFFER_EMIT_INTERVAL) {
            this.lastBufferEmit = now;
            socketServer.emitAllBuffers(buffers);
        }

        // Persistência em banco: a cada 1 hora (evita volume excessivo)
        if (this.persistEnabled && (now - this.lastBufferPersist >= this.flowPlantConfig.BUFFER_PERSIST_INTERVAL)) {
            this.lastBufferPersist = now;
            try {
                for (const [id, buffer] of buffers) {
                    await this.bufferStateRepo.create({
                        buffer_id: buffer.id,
                        from_location: buffer.from,
                        to_location: buffer.to,
                        capacity: buffer.capacity,
                        current_count: buffer.currentCount,
                        status: buffer.status,
                        type: buffer.type,
                        car_ids: buffer.cars.map(c => c.id),
                        timestamp
                    });
                }
                console.log(`[EVENT_EMITTER] Buffer states persisted at ${new Date(now).toISOString()}`);
            } catch (error) {
                console.error('[EVENT_EMITTER] Error persisting buffer states:', error);
            }
        }
    }

    // Emite estado completo da planta
    public async emitPlantState(snapshot: PlantSnapshot): Promise<void> {
        // Emissão via websocket: a cada tick
        socketServer.emitPlantState(snapshot);

        // Persistência em banco: com throttling (evita volume excessivo)
        if (!this.persistEnabled) {
            return;
        }

        const now = Date.now();
        if (now - this.lastPlantEmit < this.flowPlantConfig.PLANT_EMIT_INTERVAL) {
            return;
        }
        this.lastPlantEmit = now;

        try {
            await this.plantSnapshotRepo.create({
                timestamp: snapshot.timestamp,
                total_stations: snapshot.totalStations,
                total_occupied: snapshot.totalOccupied,
                total_free: snapshot.totalFree,
                total_stopped: snapshot.totalStopped,
                snapshot_data: snapshot
            });
        } catch (error) {
            console.error('[EVENT_EMITTER] Error persisting plant snapshot:', error);
        }
    }

    // Emite health status
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

    // Transforma um único OEEData em OEEDataEmit
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

    // Transforma OEEData (com objetos completos) em OEEDataEmit (com strings)
    private transformOEEDataForEmit(oeeData: OEEData | OEEData[]): OEEDataEmit[] {
        const dataArray = Array.isArray(oeeData) ? oeeData : [oeeData];
        return dataArray.map(data => this.transformSingleOEEData(data));
    }

    // Emite OEE em tempo real via WebSocket (aceita um único OEEData ou array)
    public emitOEE(oeeData: OEEData | OEEData[]): void {
        const now = Date.now();

        // Normaliza para array e acumula os dados pendentes
        const newData = Array.isArray(oeeData) ? oeeData : [oeeData];

        if (this.pendingOEEData) {
            this.pendingOEEData.push(...newData);
        } else {
            this.pendingOEEData = [...newData];
        }

        // Verifica se pode emitir (throttle)
        if (now - this.lastOEEEmit < this.flowPlantConfig.OEE_EMIT_INTERVAL) {
            return;
        }

        // Emite e limpa o pending (transformando para OEEDataEmit)
        this.lastOEEEmit = now;
        if (this.pendingOEEData) {
            const dataToEmit = this.transformOEEDataForEmit(this.pendingOEEData);
            socketServer.emitOEE(dataToEmit);
            this.pendingOEEData = null;
        }
    }

    // Força emissão do OEE pendente (útil para novos clientes)
    public flushPendingOEE(): void {
        if (this.pendingOEEData) {
            const dataToEmit = this.transformOEEDataForEmit(this.pendingOEEData);
            socketServer.emitOEE(dataToEmit);
            this.lastOEEEmit = Date.now();
        }
    }

    // Persiste OEE no banco de dados (chamado no fim do turno)
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

    // Persiste MTTR/MTBF no banco de dados (chamado no fim do turno)
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

    // Emite estado de todos os stops com paradas planejadas e aleatórias
    public emitAllStopsWithDetails(
        stops: Map<string, IStopLine>,
        plannedStops: any[],
        randomStops: IStopLine[]
    ): void {
        const now = Date.now();
        if (now - this.lastStopsEmit < this.flowPlantConfig.STOPS_EMIT_INTERVAL) {
            return;
        }
        this.lastStopsEmit = now;
        socketServer.emitStopsWithDetails(stops, plannedStops, randomStops);
    }

    // Persiste parada gerada (planejada ou aleatória) no banco de dados
    public async persistGeneratedStop(stop: IStopLine): Promise<void> {
        if (!this.persistEnabled) return;

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
            console.log(`[EVENT_EMITTER] Persisted generated stop: ${stop.id} (${stop.type}) - ${stop.reason}`);
        } catch (error) {
            console.error('[EVENT_EMITTER] Error persisting generated stop:', error);
        }
    }
}

export const simulationEventEmitter = SimulationEventEmitter.getInstance();
