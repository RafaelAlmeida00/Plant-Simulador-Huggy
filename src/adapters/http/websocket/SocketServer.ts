// src/adapters/http/websocket/SocketServer.ts

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { IBuffer } from '../../../domain/models/Buffer';
import { ICar } from '../../../domain/models/Car';
import { IStopLine } from '../../../domain/models/StopLine';
import { PlantSnapshot } from '../../../domain/services/PlantQueryService';
import { SimulationClock } from '../../../app/SimulationClock';
import { DatabaseFactory } from '../../database/DatabaseFactory';

export type SimulatorAction = 'pause' | 'restart' | 'stop' | 'start';

export interface ControlSimulatorMessage {
    action: SimulatorAction;
}

export interface SocketEventData {
    type: string;
    data: any;
    timestamp: number;
}

export class SocketServer {
    private io: SocketIOServer | null = null;
    private static instance: SocketServer | null = null;
    private readonly allowedChannels = new Set(['events', 'stops', 'buffers', 'plantstate', 'health', 'cars', 'oee', 'controlSimulator']);
    
    // Cache do último estado de cada room para emissão imediata ao inscrever
    private lastState: Map<string, SocketEventData> = new Map();

    // Referência ao simulador para controle via WebSocket
    private simulator: SimulationClock | null = null;

    private constructor() {}

    public static getInstance(): SocketServer {
        if (!SocketServer.instance) {
            SocketServer.instance = new SocketServer();
        }
        return SocketServer.instance;
    }

    // Define a referência do simulador para controle
    public setSimulator(simulator: SimulationClock): void {
        this.simulator = simulator;
    }

    public initialize(httpServer: HttpServer): SocketIOServer {
        this.io = new SocketIOServer(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            },
            path: '/socket.io'
        });

        this.setupConnectionHandlers();
        return this.io;
    }

    private setupConnectionHandlers(): void {
        if (!this.io) return;

        this.io.on('connection', (socket: Socket) => {
            console.log(`[SOCKET] Client connected: ${socket.id}`);

            // Permitir que clientes se inscrevam em canais específicos
            socket.on('subscribe', (channel: string) => {
                if (!this.allowedChannels.has(channel)) {
                    return;
                }
                socket.join(channel);
                console.log(`[SOCKET] Client ${socket.id} subscribed to ${channel}`);
                
                // Emite imediatamente o último estado da room para o cliente
                this.emitLastStateToSocket(socket, channel);
            });

            socket.on('unsubscribe', (channel: string) => {
                if (!this.allowedChannels.has(channel)) {
                    return;
                }
                socket.leave(channel);
                console.log(`[SOCKET] Client ${socket.id} unsubscribed from ${channel}`);
            });

            // Handler para controle da simulação via WebSocket
            socket.on('controlSimulator', (message: ControlSimulatorMessage) => {
                void this.handleSimulatorControl(socket, message);
            });

            socket.on('disconnect', () => {
                console.log(`[SOCKET] Client disconnected: ${socket.id}`);
            });
        });
    }

    // Processa comandos de controle da simulação
    private async handleSimulatorControl(socket: Socket, message: ControlSimulatorMessage): Promise<void> {
        if (!this.simulator) {
            socket.emit('controlSimulator', {
                success: false,
                error: 'Simulator not connected',
                action: message?.action,
                status: 'unknown'
            });
            return;
        }

        const action = message?.action;
        const validActions: SimulatorAction[] = ['pause', 'restart', 'stop', 'start'];

        if (!action || !validActions.includes(action)) {
            socket.emit('controlSimulator', {
                success: false,
                error: `Invalid action. Valid actions are: ${validActions.join(', ')}`,
                action,
                status: this.simulator.state
            });
            return;
        }

        try {
            switch (action) {
                case 'pause':
                    this.simulator.pause();
                    console.log(`[SOCKET] Simulator paused by client ${socket.id}`);
                    break;
                case 'restart':
                    // Garante que o banco (e tabelas) esteja pronto antes do restart.
                    await DatabaseFactory.getDatabase();
                    this.simulator.restart();
                    console.log(`[SOCKET] Simulator restarted by client ${socket.id}`);
                    break;
                case 'stop':
                    this.simulator.stop();
                    console.log(`[SOCKET] Simulator stopped by client ${socket.id}`);
                    break;
                case 'start':
                    // Se estiver pausado, resume. Se estiver parado, inicia do zero.
                    if (this.simulator.state === 'paused') {
                        this.simulator.resume();
                        console.log(`[SOCKET] Simulator resumed by client ${socket.id}`);
                    } else if (this.simulator.state === 'stopped') {
                        // Garante que o banco (e tabelas) esteja pronto antes do start.
                        await DatabaseFactory.getDatabase();
                        this.simulator.start();
                        console.log(`[SOCKET] Simulator started by client ${socket.id}`);
                    } else {
                        // Já está rodando, não faz nada
                        console.log(`[SOCKET] Simulator already running, ignoring start from ${socket.id}`);
                    }
                    break;
            }

            socket.emit('controlSimulator', {
                success: true,
                action,
                status: this.simulator.state
            });

            // Emite health para todos os clientes inscritos na room health
            this.emitHealthAfterControl();
        } catch (error: any) {
            socket.emit('controlSimulator', {
                success: false,
                error: error.message,
                action,
                status: this.simulator.state
            });

            // Emite health mesmo em caso de erro
            this.emitHealthAfterControl();
        }
    }

    // Emite health após uma ação de controle do simulador
    private emitHealthAfterControl(): void {
        if (!this.simulator) return;

        this.emitHealth({
            serverStatus: 'healthy',
            simulatorStatus: this.simulator.state as 'running' | 'stopped' | 'paused',
            timestamp: Date.now(),
            simulatorTimestamp: this.simulator.simulatedTimestamp,
            simulatorTimeString: this.simulator.getSimulatedTimeString(),
            uptime: 0 // Será atualizado pelo próximo tick se necessário
        });
    }

    public getIO(): SocketIOServer | null {
        return this.io;
    }

    // Emite o último estado salvo de uma room para um socket específico
    private emitLastStateToSocket(socket: Socket, channel: string): void {
        const lastData = this.lastState.get(channel);
        if (lastData) {
            socket.emit(channel, lastData);
            console.log(`[SOCKET] Sent cached ${channel} state to ${socket.id}`);
        }
    }

    // Salva o último estado de uma room
    private cacheState(channel: string, payload: SocketEventData): void {
        this.lastState.set(channel, payload);
    }

    // Emite evento de movimentação de carro
    public emitCarEvent(event: {
        carId: string;
        eventType: 'CREATED' | 'MOVED' | 'COMPLETED' | 'REWORK_IN' | 'REWORK_OUT' | 'BUFFER_IN' | 'BUFFER_OUT';
        shop: string;
        line: string;
        station: string;
        timestamp: number;
        data?: any;
    }): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'CAR_EVENT',
            data: event,
            timestamp: Date.now()
        };

        // room-based (subscribe/unsubscribe passa a funcionar)
        this.io.to('events').emit('events', payload);
        // alias legado
        this.io.to('events').emit('car_event', payload);
    }

    // Emite estado das paradas
    public emitStopEvent(stop: IStopLine, action: 'STARTED' | 'ENDED' | 'UPDATED'): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'STOP_EVENT',
            data: {
                action,
                stop: {
                    id: stop.id,
                    shop: stop.shop,
                    line: stop.line,
                    station: stop.station,
                    reason: stop.reason,
                    severity: stop.severity,
                    type: stop.type,
                    category: stop.category,
                    startTime: stop.startTime,
                    endTime: stop.endTime,
                    status: stop.status,
                    durationMs: stop.durationMs
                }
            },
            timestamp: Date.now()
        };

        this.io.to('stops').emit('stops', payload);
        // alias legado
        this.io.to('stops').emit('stop_event', payload);
    }

    // Emite estado de todos os stops
    public emitAllStops(stops: Map<string, IStopLine>): void {
        if (!this.io) return;

        const stopsArray: any[] = [];
        for (const [id, stop] of stops) {
            stopsArray.push({
                id: stop.id,
                shop: stop.shop,
                line: stop.line,
                station: stop.station,
                reason: stop.reason,
                severity: stop.severity,
                type: stop.type,
                category: stop.category,
                status: stop.status,
                startTime: stop.startTime,
                endTime: stop.endTime,
                durationMs: stop.durationMs
            });
        }

        const payload: SocketEventData = {
            type: 'STOPS_STATE',
            data: stopsArray,
            timestamp: Date.now()
        };

        this.cacheState('stops', payload);
        this.io.to('stops').emit('stops', payload);
    }

    // Emite estado do buffer
    public emitBufferEvent(buffer: IBuffer, action: 'UPDATED'): void {
        if (!this.io) return;

        const carIds = buffer.cars.map(c => c.id);
        
        const payload: SocketEventData = {
            type: 'BUFFER_EVENT',
            data: {
                action,
                buffer: {
                    id: buffer.id,
                    betweenShopOrLine: buffer.betweenShopOrLine,
                    from: buffer.from,
                    to: buffer.to,
                    capacity: buffer.capacity,
                    currentCount: buffer.currentCount,
                    status: buffer.status,
                    type: buffer.type,
                    carIds
                }
            },
            timestamp: Date.now()
        };

        this.io.to('buffers').emit('buffers', payload);
        // alias legado
        this.io.to('buffers').emit('buffer_event', payload);
    }

    // Emite estado de todos os buffers
    public emitAllBuffers(buffers: Map<string, IBuffer>): void {
        if (!this.io) return;

        const buffersArray: any[] = [];
        for (const [id, buffer] of buffers) {
            buffersArray.push({
                id: buffer.id,
                betweenShopOrLine: buffer.betweenShopOrLine,
                from: buffer.from,
                to: buffer.to,
                capacity: buffer.capacity,
                currentCount: buffer.currentCount,
                status: buffer.status,
                type: buffer.type,
                carIds: buffer.cars.map(c => c.id)
            });
        }

        const payload: SocketEventData = {
            type: 'BUFFERS_STATE',
            data: buffersArray,
            timestamp: Date.now()
        };

        this.cacheState('buffers', payload);
        this.io.to('buffers').emit('buffers', payload);
    }

    // Emite estado completo da planta
    public emitPlantState(snapshot: PlantSnapshot): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'PLANT_STATE',
            data: snapshot,
            timestamp: Date.now()
        };

        this.cacheState('plantstate', payload);
        this.io.to('plantstate').emit('plantstate', payload);
        // alias legado
        this.io.to('plantstate').emit('plant_state', payload);
    }

    // Emite health check
    public emitHealth(status: {
        serverStatus: 'healthy' | 'unhealthy';
        simulatorStatus: 'running' | 'stopped' | 'paused';
        timestamp: number;
        simulatorTimestamp: number;
        simulatorTimeString: string;
        uptime: number;
    }): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'HEALTH',
            data: status,
            timestamp: Date.now()
        };

        this.cacheState('health', payload);
        this.io.to('health').emit('health', payload);
    }

    // Emite estado completo de todos os carros (estrutura completa do Car)
    public emitCars(cars: ICar[]): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'CARS_STATE',
            data: cars,
            timestamp: Date.now()
        };

        this.cacheState('cars', payload);
        this.io.to('cars').emit('cars', payload);
    }

    // Emite dados de OEE em tempo real
    public emitOEE(oeeData: any[]): void {
        if (!this.io) return;

        const payload: SocketEventData = {
            type: 'OEE_UPDATE',
            data: oeeData,
            timestamp: Date.now()
        };

        this.cacheState('oee', payload);
        this.io.to('oee').emit('oee', payload);
    }

    // Emite estado completo dos stops incluindo planned e random stops
    public emitStopsWithDetails(stops: Map<string, IStopLine>, plannedStops: any[], randomStops: IStopLine[]): void {
        if (!this.io) return;

        const stopsArray: any[] = [];
        for (const [id, stop] of stops) {
            stopsArray.push({
                id: stop.id,
                shop: stop.shop,
                line: stop.line,
                station: stop.station,
                reason: stop.reason,
                severity: stop.severity,
                type: stop.type,
                category: stop.category,
                status: stop.status,
                startTime: stop.startTime,
                endTime: stop.endTime,
                durationMs: stop.durationMs
            });
        }

        const payload: SocketEventData = {
            type: 'STOPS_STATE_DETAILED',
            data: {
                activeStops: stopsArray,
                plannedStops: plannedStops,
                randomStops: randomStops.map(s => ({
                    id: s.id,
                    shop: s.shop,
                    line: s.line,
                    station: s.station,
                    reason: s.reason,
                    severity: s.severity,
                    type: s.type,
                    category: s.category,
                    status: s.status,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    durationMs: s.durationMs
                }))
            },
            timestamp: Date.now()
        };

        this.cacheState('stops', payload);
        this.io.to('stops').emit('stops', payload);
    }

    public close(): void {
        if (this.io) {
            this.io.close();
            this.io = null;
        }
    }
}

export const socketServer = SocketServer.getInstance();
