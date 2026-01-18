// src/adapters/http/websocket/SocketServer.ts

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import msgpackParser from 'socket.io-msgpack-parser';
import { ICar, IStopLine, IBuffer, IShop, ILine, IStation, PlantSnapshot } from '../../../utils/shared';
import { SimulationClock } from '../../../app/SimulationClock';
import { DatabaseFactory } from '../../database/DatabaseFactory';
import { DeltaService, DeltaResult } from './DeltaService';
import { BackpressureManager, AckPayload } from './BackpressureManager';
import { ChunkingService } from './ChunkingService';
import { setupOptionalSocketAuth } from '../middleware/socketAuth';

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

    // Performance: Track socket subscriptions for cleanup
    private socketSubscriptions: Map<string, Set<string>> = new Map();

    // Performance: Car state hashes for delta updates
    private carStateHashes: Map<string, string> = new Map();

    // Delta tracking service for efficient updates
    private deltaService: DeltaService = new DeltaService();

    // Backpressure management for flow control
    private backpressureManager: BackpressureManager = new BackpressureManager();

    // Chunking service for large payloads
    private chunkingService: ChunkingService = new ChunkingService();

    // Flag to enable/disable delta mode (can be toggled)
    private deltaEnabled: boolean = true;

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
            path: '/socket.io',
            // Performance: Use MessagePack for binary serialization (~30% smaller payloads)
            parser: msgpackParser,
            // Connection stability: Configure ping/pong intervals for reliable connections
            pingInterval: 30000,      // 30s between pings (default: 25s)
            pingTimeout: 60000,       // 60s timeout before disconnect (default: 20s)
            upgradeTimeout: 30000,    // 30s for transport upgrade
            maxHttpBufferSize: 1e6,   // 1MB max buffer size
            // Performance: Enable WebSocket compression for large payloads
            perMessageDeflate: {
                threshold: 2048,  // Lower threshold since MessagePack is already compact
                zlibDeflateOptions: { level: 6 },
                zlibInflateOptions: { chunkSize: 16 * 1024 }
            },
            httpCompression: true
        });

        // Setup optional socket authentication middleware
        // Allows connections without token but attaches user if token is valid
        setupOptionalSocketAuth(this.io);

        this.setupConnectionHandlers();
        this.setupEngineErrorHandlers();
        return this.io;
    }

    private setupEngineErrorHandlers(): void {
        if (!this.io) return;

        const engine = this.io.engine;

        console.log('[SOCKET ENGINE] Setting up engine-level event handlers...');
        console.log(`[SOCKET ENGINE] Config: pingInterval=${30000}ms, pingTimeout=${60000}ms`);

        // Handle engine-level connection errors (before socket is established)
        engine.on('connection_error', (err: { req: any; code: number; message: string; context: any }) => {
            console.error(`[SOCKET ENGINE] Connection error: code=${err.code}, message=${err.message}`);
        });

        // Log when a new raw connection is initiated
        engine.on('connection', (rawSocket: any) => {
            const socketId = rawSocket.id;
            console.log(`[SOCKET ENGINE] Raw connection initiated: ${socketId}`);
            console.log(`[SOCKET ENGINE] Transport: ${rawSocket.transport?.name || 'unknown'}`);

            // Monitor transport changes (polling -> websocket upgrade)
            rawSocket.on('upgrade', (transport: any) => {
                console.log(`[SOCKET ENGINE] Transport upgraded: ${socketId} -> ${transport.name}`);
            });

            // Monitor upgrade errors
            rawSocket.on('upgradeError', (err: Error) => {
                console.error(`[SOCKET ENGINE] Upgrade error for ${socketId}:`, err.message);
            });

            // Monitor packet events for debugging
            rawSocket.on('packet', (packet: any) => {
                if (packet.type === 'ping') {
                    console.log(`[SOCKET ENGINE] Ping sent to ${socketId}`);
                } else if (packet.type === 'pong') {
                    console.log(`[SOCKET ENGINE] Pong received from ${socketId}`);
                }
            });

            // Monitor heartbeat events
            rawSocket.on('heartbeat', () => {
                console.log(`[SOCKET ENGINE] Heartbeat for ${socketId}`);
            });

            // Monitor drain events (buffer flushed)
            rawSocket.on('drain', () => {
                console.log(`[SOCKET ENGINE] Buffer drained for ${socketId}`);
            });

            // Monitor packetCreate for debugging outgoing packets
            rawSocket.on('packetCreate', (packet: any) => {
                if (packet.type !== 'ping' && packet.type !== 'pong') {
                    console.log(`[SOCKET ENGINE] Packet created for ${socketId}: type=${packet.type}`);
                }
            });

            // Monitor close at engine level
            rawSocket.on('close', (reason: string, description: any) => {
                console.error(`[SOCKET ENGINE] Raw socket closed: ${socketId}, reason=${reason}, description=${JSON.stringify(description)}`);
            });

            // Monitor errors at engine level
            rawSocket.on('error', (err: Error) => {
                console.error(`[SOCKET ENGINE] Raw socket error for ${socketId}:`, err.message);
            });
        });

        // Monitor initial handshake
        engine.on('initial_headers', (_headers: any, req: any) => {
            console.log(`[SOCKET ENGINE] Initial headers sent for request from ${req.socket?.remoteAddress || 'unknown'}`);
        });

        // Monitor headers
        engine.on('headers', (_headers: any, req: any) => {
            console.log(`[SOCKET ENGINE] Headers event for ${req.url}`);
        });
    }

    private setupConnectionHandlers(): void {
        if (!this.io) return;

        this.io.on('connection', (socket: Socket) => {
            const conn = socket.conn;
            const user = socket.user;
            console.log(`[SOCKET] ========== NEW CONNECTION ==========`);
            console.log(`[SOCKET] Client connected: ${socket.id}`);
            console.log(`[SOCKET] Transport: ${conn?.transport?.name || 'unknown'}`);
            console.log(`[SOCKET] Remote address: ${socket.handshake?.address || 'unknown'}`);
            console.log(`[SOCKET] Query params: ${JSON.stringify(socket.handshake?.query || {})}`);
            console.log(`[SOCKET] Headers origin: ${socket.handshake?.headers?.origin || 'unknown'}`);
            console.log(`[SOCKET] Authenticated user: ${user ? user.email : 'anonymous'}`);
            console.log(`[SOCKET] =====================================`);

            // Performance: Initialize subscription tracking for this socket
            this.socketSubscriptions.set(socket.id, new Set());

            // Register client in backpressure manager
            this.backpressureManager.registerClient(socket.id);

            // Setup session-specific event handlers
            this.setupSessionHandlers(socket);

            // Permitir que clientes se inscrevam em canais específicos
            socket.on('subscribe', (channel: string) => {
                if (!this.allowedChannels.has(channel)) {
                    return;
                }
                socket.join(channel);

                // Track subscription for cleanup
                const subs = this.socketSubscriptions.get(socket.id);
                if (subs) subs.add(channel);

                // Track in backpressure manager
                this.backpressureManager.subscribe(socket.id, channel);

                // Reset delta state for this socket/channel (force full update on subscribe)
                this.deltaService.resetSocketChannel(`${channel}:${socket.id}`);

                console.log(`[SOCKET] Client ${socket.id} subscribed to ${channel}`);

                // Emite imediatamente o último estado da room para o cliente
                this.emitLastStateToSocket(socket, channel);
            });

            socket.on('unsubscribe', (channel: string) => {
                if (!this.allowedChannels.has(channel)) {
                    return;
                }
                socket.leave(channel);

                // Remove from tracking
                const subs = this.socketSubscriptions.get(socket.id);
                if (subs) subs.delete(channel);

                // Remove from backpressure manager
                this.backpressureManager.unsubscribe(socket.id, channel);

                console.log(`[SOCKET] Client ${socket.id} unsubscribed from ${channel}`);
            });

            // Handler for client acknowledgments (backpressure)
            socket.on('ack', (ack: AckPayload) => {
                this.backpressureManager.handleAck(socket.id, ack);
            });

            // Handler para controle da simulação via WebSocket
            socket.on('controlSimulator', (message: ControlSimulatorMessage) => {
                void this.handleSimulatorControl(socket, message);
            });

            // Error handler for debugging connection issues
            socket.on('error', (error: Error) => {
                console.error(`[SOCKET] Error for ${socket.id}:`, error.message);
            });

            socket.on('disconnect', (reason: string) => {
                // Log disconnect reason with detailed explanation
                console.log(`[SOCKET] ========== DISCONNECT ==========`);
                console.log(`[SOCKET] Client disconnected: ${socket.id}`);
                console.log(`[SOCKET] Reason: ${reason}`);
                console.log(`[SOCKET] Reason explanation: ${this.getDisconnectReasonExplanation(reason)}`);
                console.log(`[SOCKET] ===================================`);

                // Performance: Explicit cleanup on disconnect to prevent memory leaks
                const subs = this.socketSubscriptions.get(socket.id);
                if (subs) {
                    subs.forEach(channel => socket.leave(channel));
                }
                this.socketSubscriptions.delete(socket.id);

                // Cleanup backpressure and delta state
                this.backpressureManager.unregisterClient(socket.id);
                this.deltaService.clearSocket(socket.id);

                socket.removeAllListeners();
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
        // Note: Legacy alias 'car_event' removed for performance (was duplicating messages)
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
        // Note: Legacy alias 'stop_event' removed for performance (was duplicating messages)
    }

    // Emite estado de todos os stops
    // Uses optimized delta emission for bandwidth reduction
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

        // Use optimized emission with delta tracking
        this.emitOptimized('stops', { activeStops: stopsArray }, {
            type: 'STOPS_STATE',
            computeDelta: (channelKey, data) => this.deltaService.computeStopsDelta(channelKey, data)
        });
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
        // Note: Legacy alias 'buffer_event' removed for performance (was duplicating messages)
    }

    // Emite estado de todos os buffers
    // Uses optimized delta emission for bandwidth reduction
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

        // Use optimized emission with delta tracking
        this.emitOptimized('buffers', buffersArray, {
            type: 'BUFFERS_STATE',
            computeDelta: (channelKey, data) => this.deltaService.computeBuffersDelta(channelKey, data)
        });
    }

    // Emite estado completo da planta (sanitizado - sem trace/shopLeadtimes)
    // Uses optimized delta emission for bandwidth reduction
    public emitPlantState(snapshot: PlantSnapshot): void {
        if (!this.io) return;

        // Sanitize snapshot to remove heavy trace/shopLeadtimes from nested cars
        const sanitizedSnapshot = this.sanitizePlantSnapshot(snapshot);

        // Use optimized emission with delta tracking
        this.emitOptimized('plantstate', sanitizedSnapshot, {
            type: 'PLANT_STATE',
            computeDelta: (channelKey, data) => this.deltaService.computePlantStateDelta(channelKey, data)
        });
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

    /**
     * Optimized emission with delta tracking, backpressure, and chunking support
     * Emits only changes to each socket individually
     */
    private emitOptimized(
        channel: string,
        rawData: any,
        options: {
            type: string;
            computeDelta: (channelKey: string, data: any) => DeltaResult;
        }
    ): void {
        if (!this.io) return;

        const room = this.io.sockets.adapter.rooms.get(channel);
        if (!room || room.size === 0) {
            // No subscribers, just cache the state
            const payload: SocketEventData = {
                type: options.type,
                data: rawData,
                timestamp: Date.now()
            };
            this.cacheState(channel, payload);
            return;
        }

        // Process each subscribed socket individually
        for (const socketId of room) {
            const socket = this.io.sockets.sockets.get(socketId);
            if (!socket) continue;

            // Check backpressure - skip if client hasn't acknowledged previous message
            if (!this.backpressureManager.canEmit(socketId, channel)) {
                continue;
            }

            // Compute delta for this socket
            const channelKey = `${channel}:${socketId}`;
            const deltaResult = this.deltaEnabled
                ? options.computeDelta(channelKey, rawData)
                : { hasChanges: true, operations: [], delta: rawData, version: 0, isFullUpdate: true };

            // Skip if no changes
            if (!deltaResult.hasChanges) continue;

            // Build payload - use hierarchical delta format
            let payload: any;
            if (deltaResult.isFullUpdate) {
                payload = {
                    type: 'FULL',
                    channel,
                    version: deltaResult.version,
                    data: rawData,
                    timestamp: Date.now(),
                    requiresAck: true
                };
            } else {
                // Send only changed fields in hierarchical format
                payload = {
                    type: 'DELTA',
                    channel,
                    version: deltaResult.version,
                    baseVersion: deltaResult.version - 1,
                    data: deltaResult.delta,  // Hierarchical delta with only changed fields
                    timestamp: Date.now(),
                    requiresAck: true
                };
            }

            // Check if chunking is needed
            if (this.chunkingService.shouldChunk(payload.data)) {
                // Chunk by logical boundaries for plantstate
                if (channel === 'plantstate' && payload.data.shops) {
                    const chunks = this.chunkingService.chunkPlantSnapshot(payload.data);
                    for (const chunk of chunks) {
                        socket.emit(`${channel}:chunk`, {
                            ...payload,
                            data: chunk.data,
                            chunkInfo: chunk.chunkInfo
                        });
                    }
                } else {
                    // Fallback to byte chunking for large deltas
                    const chunks = this.chunkingService.chunkByBytes(payload.data);
                    for (const chunk of chunks) {
                        socket.emit(`${channel}:chunk`, {
                            ...payload,
                            data: chunk.data,
                            chunkInfo: chunk.chunkInfo
                        });
                    }
                }
            } else {
                // Mark as pending and emit
                this.backpressureManager.markPending(socketId, channel);
                socket.emit(channel, payload);
            }
        }

        // Update global cache for new clients
        const cachePayload: SocketEventData = {
            type: options.type,
            data: rawData,
            timestamp: Date.now()
        };
        this.cacheState(channel, cachePayload);
    }

    /**
     * Toggle delta mode on/off
     */
    public setDeltaEnabled(enabled: boolean): void {
        this.deltaEnabled = enabled;
        console.log(`[SOCKET] Delta mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Serialize car to minimal payload - excludes trace[] and shopLeadtimes[] to reduce bandwidth
     * Full trace is typically 20KB+ per car; minimal is ~200 bytes
     */
    private serializeCarMinimal(car: ICar): object {
        const lastTrace = car.trace[car.trace.length - 1];
        return {
            id: car.id,
            sequenceNumber: car.sequenceNumber,
            model: car.model,
            color: car.color,
            createdAt: car.createdAt,
            completedAt: car.completedAt,
            hasDefect: car.hasDefect,
            inRework: car.inRework,
            isPart: car.isPart,
            partName: car.partName,
            // Include only current location, not full trace
            currentLocation: lastTrace ? {
                shop: lastTrace.shop,
                line: lastTrace.line,
                station: lastTrace.station
            } : null,
            // Include trace count for debugging
            traceCount: car.trace.length
        };
    }

    /**
     * Sanitize PlantSnapshot removing trace[] and shopLeadtimes[] from all nested cars
     * This reduces payload size significantly for plantstate emissions
     */
    private sanitizePlantSnapshot(snapshot: PlantSnapshot): object {
        return {
            timestamp: snapshot.timestamp,
            totalStations: snapshot.totalStations,
            totalOccupied: snapshot.totalOccupied,
            totalFree: snapshot.totalFree,
            totalStopped: snapshot.totalStopped,
            shops: snapshot.shops.map(shop => this.sanitizeShop(shop))
        };
    }

    /**
     * Sanitize shop object, converting lines Map to array and sanitizing stations
     */
    private sanitizeShop(shop: IShop): object {
        const lines: object[] = [];

        // Handle both Map and Record types for lines
        const linesIterable = shop.lines instanceof Map
            ? shop.lines.entries()
            : Object.entries(shop.lines || {});

        for (const [, line] of linesIterable) {
            lines.push(this.sanitizeLine(line as ILine));
        }

        return {
            name: shop.name,
            bufferCapacity: shop.bufferCapacity,
            reworkBuffer: shop.reworkBuffer,
            lines
        };
    }

    /**
     * Sanitize line object, sanitizing all stations within
     */
    private sanitizeLine(line: ILine): object {
        return {
            id: line.id,
            shop: line.shop,
            line: line.line,
            taktMn: line.taktMn,
            isFeederLine: line.isFeederLine,
            partType: line.partType,
            stations: (line.stations || []).map(station => this.sanitizeStation(station))
        };
    }

    /**
     * Sanitize station object, removing trace/shopLeadtimes from currentCar
     */
    private sanitizeStation(station: IStation): object {
        return {
            id: station.id,
            index: station.index,
            shop: station.shop,
            line: station.line,
            station: station.station,
            taktMn: station.taktMn,
            taktSg: station.taktSg,
            isFirstStation: station.isFirstStation,
            isLastStation: station.isLastStation,
            occupied: station.occupied,
            isStopped: station.isStopped,
            stopReason: station.stopReason,
            stopId: station.stopId,
            currentCar: station.currentCar
                ? this.serializeCarMinimal(station.currentCar)
                : null
        };
    }

    /**
     * Emits optimized car state with minimal payload (no full traces)
     * Uses delta tracking to only send changed cars
     */
    public emitCars(cars: ICar[]): void {
        if (!this.io) return;

        // Performance: Serialize cars without full trace for reduced bandwidth
        const minimalCars = cars.map(car => this.serializeCarMinimal(car));

        // Use optimized emission with delta tracking
        this.emitOptimized('cars', minimalCars, {
            type: 'CARS_STATE',
            computeDelta: (channelKey, data) => this.deltaService.computeCarsDelta(channelKey, data)
        });
    }

    /**
     * Emits car state (now also sanitized - trace/shopLeadtimes removed for bandwidth)
     * @deprecated Use emitCars() instead - this method now returns same minimal payload
     */
    public emitCarsFull(cars: ICar[]): void {
        if (!this.io) return;

        // Performance: Serialize cars without full trace for reduced bandwidth
        // trace[] and shopLeadtimes[] are removed to save ~30KB per car
        const minimalCars = cars.map(car => this.serializeCarMinimal(car));

        const payload: SocketEventData = {
            type: 'CARS_STATE_FULL',
            data: minimalCars,
            timestamp: Date.now()
        };

        this.io.to('cars').emit('cars_full', payload);
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

    /**
     * Returns a human-readable explanation for disconnect reasons
     */
    private getDisconnectReasonExplanation(reason: string): string {
        const explanations: Record<string, string> = {
            'transport close': 'The connection was closed (browser tab closed, network issue, or server restart)',
            'transport error': 'Transport error occurred (network failure or proxy issue)',
            'ping timeout': 'Client did not respond to ping in time (network latency or client frozen)',
            'server namespace disconnect': 'Server manually disconnected the socket',
            'client namespace disconnect': 'Client manually disconnected',
            'server shutting down': 'Server is shutting down',
            'forced close': 'Connection forcefully closed',
            'forced server close': 'Server forced the connection to close',
            'parse error': 'Invalid packet received from client'
        };
        return explanations[reason] || `Unknown reason: ${reason}`;
    }

    // ============================================================
    // SESSION-BASED ROOM SUPPORT
    // ============================================================

    /**
     * Get the session room name for a given session and channel
     */
    private getSessionRoom(sessionId: string, channel: string): string {
        return `session:${sessionId}:${channel}`;
    }

    /**
     * Subscribe a socket to a session's events
     * Clients can call this to receive events from a specific session
     */
    public subscribeToSession(socket: Socket, sessionId: string, channel: string): void {
        const room = this.getSessionRoom(sessionId, channel);
        socket.join(room);

        // Track subscription
        const subs = this.socketSubscriptions.get(socket.id);
        if (subs) subs.add(room);

        // Reset delta state for this socket/channel
        this.deltaService.resetSocketChannel(`${room}:${socket.id}`);

        console.log(`[SOCKET] Client ${socket.id} subscribed to session ${sessionId}:${channel}`);
    }

    /**
     * Unsubscribe a socket from a session's events
     */
    public unsubscribeFromSession(socket: Socket, sessionId: string, channel: string): void {
        const room = this.getSessionRoom(sessionId, channel);
        socket.leave(room);

        // Remove from tracking
        const subs = this.socketSubscriptions.get(socket.id);
        if (subs) subs.delete(room);

        console.log(`[SOCKET] Client ${socket.id} unsubscribed from session ${sessionId}:${channel}`);
    }

    /**
     * Broadcast data to all clients subscribed to a session's channel
     */
    public broadcastToSession(sessionId: string, channel: string, data: any): void {
        if (!this.io) return;

        const room = this.getSessionRoom(sessionId, channel);
        const payload: SocketEventData = {
            type: channel,
            data,
            timestamp: Date.now()
        };

        this.io.to(room).emit(channel, payload);
    }

    /**
     * Emit a session-specific event (with session context)
     */
    public emitSessionEvent(sessionId: string, eventType: string, data: any): void {
        if (!this.io) return;

        const room = this.getSessionRoom(sessionId, 'events');
        const payload: SocketEventData = {
            type: eventType,
            data: { ...data, sessionId },
            timestamp: Date.now()
        };

        this.io.to(room).emit('events', payload);
    }

    /**
     * Setup session-specific event handlers for a socket
     * Call this after socket connection to enable session subscriptions
     */
    public setupSessionHandlers(socket: Socket): void {
        // Subscribe to a session
        socket.on('subscribe:session', (data: { sessionId: string; channel: string }) => {
            if (!data.sessionId || !data.channel) {
                socket.emit('error', { message: 'sessionId and channel are required' });
                return;
            }
            if (!this.allowedChannels.has(data.channel)) {
                socket.emit('error', { message: `Invalid channel: ${data.channel}` });
                return;
            }
            this.subscribeToSession(socket, data.sessionId, data.channel);
        });

        // Unsubscribe from a session
        socket.on('unsubscribe:session', (data: { sessionId: string; channel: string }) => {
            if (!data.sessionId || !data.channel) return;
            this.unsubscribeFromSession(socket, data.sessionId, data.channel);
        });
    }

    public close(): void {
        if (this.io) {
            this.io.close();
            this.io = null;
        }
    }
}

export const socketServer = SocketServer.getInstance();
