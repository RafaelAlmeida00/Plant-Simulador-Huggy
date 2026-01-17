// Load environment variables BEFORE any other imports
import 'dotenv/config';

import { Server } from "./adapters/http/server";
import { SimulationFactory } from "./domain/factories/SimulationFactory";
import { simulationEventEmitter } from "./app/SimulationEventEmitter";
import { socketServer } from "./adapters/http/websocket/SocketServer";
import { DatabaseFactory } from "./adapters/database/DatabaseFactory";
import { loadDefaultPlantConfig } from "./domain/factories/plantFactory";
import { OEEData } from "./utils/shared";
import { MTTRMTBFData } from "./utils/shared";
import { IStopLine } from "./utils/shared";
import { logger } from "./utils/logger";
import { validateSecurityEnvironment } from "./config/security-config";

const serverStartTime = Date.now();

const MEMORY_LOG_INTERVAL_MS = 30_000;
let memoryLogInterval: NodeJS.Timeout | undefined;

function bytesToMiB(bytes: number): number {
    return bytes / 1024 / 1024;
}

function logMemoryUsage(reason: string): void {
    const mem = process.memoryUsage();
    const uptimeMs = Date.now() - serverStartTime;

    console.log(
        `[MEM] reason=${reason} uptimeMs=${uptimeMs} ` +
        `rssMiB=${bytesToMiB(mem.rss).toFixed(1)} ` +
        `heapUsedMiB=${bytesToMiB(mem.heapUsed).toFixed(1)} ` +
        `heapTotalMiB=${bytesToMiB(mem.heapTotal).toFixed(1)} ` +
        `externalMiB=${bytesToMiB(mem.external).toFixed(1)} ` +
        `arrayBuffersMiB=${bytesToMiB(mem.arrayBuffers).toFixed(1)}`
    );
}

function startMemoryLogging(): void {
    if (memoryLogInterval) return;

    logMemoryUsage('startup');
    memoryLogInterval = setInterval(() => {
        logMemoryUsage('interval');
    }, MEMORY_LOG_INTERVAL_MS);
}

function stopMemoryLogging(): void {
    if (!memoryLogInterval) return;
    clearInterval(memoryLogInterval);
    memoryLogInterval = undefined;
}

process.on('SIGTERM', () => {
    console.log('[SIGNAL] SIGTERM received. Logging memory snapshot and shutting down.');
    logMemoryUsage('SIGTERM');
    stopMemoryLogging();

    // Since we added a SIGTERM handler, Node will not exit by default.
    // Give stdout a brief moment to flush.
    setTimeout(() => {
        process.exit(0);
    }, 250);
});

export async function StartSimulation() {
    // Garante que o banco esteja conectado e com tabelas criadas antes de iniciar
    // qualquer tick/persistência/evento da simulação.
    await DatabaseFactory.getDatabase();

    // Carrega configuração da planta do banco de dados (ou usa FlowPlant como fallback)
    await loadDefaultPlantConfig();

    const simulation = SimulationFactory.create({
        onTick: (event, state) => {
            // Health a cada tick
            simulationEventEmitter.emitHealth({
                serverStatus: 'healthy',
                simulatorStatus: state.status === 'running' ? 'running' : state.status === 'paused' ? 'paused' : 'stopped',
                timestamp: Date.now(),
                simulatorTimestamp: event.simulatedTimestamp,
                simulatorTimeString: event.simulatedTimeString,
                uptime: Date.now() - serverStartTime
            });

            // Plantstate a cada tick
            const plantSnapshot = simulation.getPlantSnapshot();
            if (plantSnapshot) {
                void simulationEventEmitter.emitPlantState(plantSnapshot);
            }
        },
        onCars: (cars, timestamp) => {
            simulationEventEmitter.emitCars(cars, timestamp);
        },
        onCarCreated: (carId, shop, line, station, timestamp) => {
            void simulationEventEmitter.emitCarCreated(carId, shop, line, station, timestamp);
        },
        onCarMoved: (carId: string, from: { shop: string, line: string, station: string }, to: { shop: string, line: string, station: string }, timestamp: number) => {
            void simulationEventEmitter.emitCarMoved(
                carId,
                from.shop, from.line, from.station,
                to.shop, to.line, to.station,
                timestamp
            );
        },
        onCarCompleted: (carId: string, location: { shop: string, line: string, station: string }, totalLeadtimeMs: number, timestamp: number) => {
            const { shop, line, station } = location;
            void simulationEventEmitter.emitCarCompleted(carId, shop, line, station, timestamp, totalLeadtimeMs);
        },
        onBufferIn: (carId: string, bufferId: string, loc: { shop: string, line: string }, fromStation: string, timestamp: number) => {
            void simulationEventEmitter.emitBufferIn(carId, bufferId, loc.shop, loc.line, fromStation, timestamp);
        },
        onBufferOut: (carId: string, bufferId: string, shop: string, line: string, toStation: string, timestamp: number) => {
            void simulationEventEmitter.emitBufferOut(carId, bufferId, shop, line, toStation, timestamp);
        },
        onReworkInDetailed: (carId: string, bufferId: string, shop: string, line: string, station: string, defectId: string, timestamp: number) => {
            void simulationEventEmitter.emitReworkIn(carId, bufferId, shop, line, station, defectId, timestamp);
        },
        onReworkOutDetailed: (carId: string, bufferId: string, shop: string, line: string, station: string, timestamp: number) => {
            void simulationEventEmitter.emitReworkOut(carId, bufferId, shop, line, station, timestamp);
        },
        onStopStartedStopLine: (stop) => {
            void simulationEventEmitter.emitStopStarted(stop);
        },
        onStopEndedStopLine: (stop) => {
            void simulationEventEmitter.emitStopEnded(stop);
        },
        // OEE dinâmico - emite quando há mudança na produção (recebe um OEEData por vez)
        onOEECalculated: (oeeData: OEEData) => {
            simulationEventEmitter.emitOEE(oeeData);
        },
        // OEE no fim do turno - persiste no banco
        onOEEShiftEnd: (oeeData: OEEData) => {
            void simulationEventEmitter.persistOEE(oeeData);
        },
        // MTTR/MTBF no fim do turno - persiste no banco
        onMTTRMTBFCalculated: (data: MTTRMTBFData) => {
            void simulationEventEmitter.persistMTTRMTBF(data);
        },

    });

    simulation.start();
    return simulation;
}

async function main(): Promise<void> {
    startMemoryLogging();

    logger().info('[BOOT] Starting simulation server...');

    // Security validation FIRST - fail fast if misconfigured
    logger().info('[BOOT] Validating security environment...');
    validateSecurityEnvironment();

    // Primeiro processo do boot: banco (inclui criação de tabelas via connect()).
    await DatabaseFactory.getDatabase();

    logger().info('[BOOT] Database connected. Starting simulation...');
    const server = new Server();
    logger().info('[BOOT] HTTP Server created. Starting simulation instance...');
    const simulation = await StartSimulation();
    logger().info('[BOOT] Simulation started. Starting HTTP server...');

    server.setSimulatorClock(simulation);
    logger().info('[BOOT] HTTP Server connected to simulation. Starting WebSocket server...');

    // Conecta o socket server ao simulador para controle via WebSocket
    socketServer.setSimulator(simulation);
    logger().info('[BOOT] WebSocket server connected to simulation. Boot process complete.');

    // Emit estados periódicos (com throttling dentro do emitter)
    simulation.onTick((tick) => {
        void simulationEventEmitter.emitAllStops(simulation.getStops());
        void simulationEventEmitter.emitAllBuffers(simulation.getBuffers(), tick.simulatedTimestamp);
        void simulationEventEmitter.emitCars(simulation.getCars(), tick.simulatedTimestamp);
    });

    await server.listen();
}

main().catch((error) => {
    console.error('[BOOT] Fatal error during startup:', error);
    process.exitCode = 1;
});
