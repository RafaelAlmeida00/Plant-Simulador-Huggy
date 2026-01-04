import { Server } from "./adapters/http/server";
import { SimulationFactory } from "./domain/factories/SimulationFactory";
import { simulationEventEmitter } from "./adapters/http/websocket/SimulationEventEmitter";
import { socketServer } from "./adapters/http/websocket/SocketServer";
import { DatabaseFactory } from "./adapters/database/DatabaseFactory";
import { loadDefaultPlantConfig } from "./domain/factories/plantFactory";

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
            void simulationEventEmitter.emitPlantState(simulation.getPlantSnapshot());
        },
        onCars: (cars, timestamp) => {
            simulationEventEmitter.emitCars(cars, timestamp);
        },
        onCarCreated: (carId, shop, line, station, timestamp) => {
            void simulationEventEmitter.emitCarCreated(carId, shop, line, station, timestamp);
        },
        onCarMoved: (carId, fromShop, fromLine, fromStation, toShop, toLine, toStation, timestamp) => {
            void simulationEventEmitter.emitCarMoved(carId, fromShop, fromLine, fromStation, toShop, toLine, toStation, timestamp);
        },
        onCarCompleted: (carId, shop, line, station, totalLeadtimeMs, timestamp) => {
            void simulationEventEmitter.emitCarCompleted(carId, shop, line, station, timestamp, totalLeadtimeMs);
        },
        onBufferIn: (carId, bufferId, shop, line, fromStation, timestamp) => {
            void simulationEventEmitter.emitBufferIn(carId, bufferId, shop, line, fromStation, timestamp);
        },
        onBufferOut: (carId, bufferId, shop, line, toStation, timestamp) => {
            void simulationEventEmitter.emitBufferOut(carId, bufferId, shop, line, toStation, timestamp);
        },
        onReworkInDetailed: (carId, bufferId, shop, line, station, defectId, timestamp) => {
            void simulationEventEmitter.emitReworkIn(carId, bufferId, shop, line, station, defectId, timestamp);
        },
        onReworkOutDetailed: (carId, bufferId, shop, line, station, timestamp) => {
            void simulationEventEmitter.emitReworkOut(carId, bufferId, shop, line, station, timestamp);
        },
        onStopStartedStopLine: (stop) => {
            void simulationEventEmitter.emitStopStarted(stop);
        },
        onStopEndedStopLine: (stop) => {
            void simulationEventEmitter.emitStopEnded(stop);
        },
        // OEE dinâmico - emite quando há mudança na produção
        onOEECalculated: (oeeData) => {
            simulationEventEmitter.emitOEE(oeeData);
        },
        // OEE no fim do turno - persiste no banco
        onOEEShiftEnd: (oeeData) => {
            void simulationEventEmitter.persistOEE(oeeData);
        },
        // MTTR/MTBF no fim do turno - persiste no banco
        onMTTRMTBFCalculated: (data) => {
            void simulationEventEmitter.persistMTTRMTBF(data);
        },
        // Stops com detalhes (planned e random)
        onStopsWithDetails: (stops, plannedStops, randomStops) => {
            simulationEventEmitter.emitAllStopsWithDetails(stops, plannedStops, randomStops);
        },
        // Persiste paradas geradas (planejadas e aleatórias) no banco de dados
        onStopGenerated: (stop) => {
            void simulationEventEmitter.persistGeneratedStop(stop);
        }
    });

    simulation.start();
    return simulation;
}

async function main(): Promise<void> {
    startMemoryLogging();

    // Primeiro processo do boot: banco (inclui criação de tabelas via connect()).
    await DatabaseFactory.getDatabase();

    const server = new Server();
    const simulation = await StartSimulation();

    server.setSimulatorClock(simulation);

    // Conecta o socket server ao simulador para controle via WebSocket
    socketServer.setSimulator(simulation);

    // Emit estados periódicos (com throttling dentro do emitter)
    simulation.onTick((tick) => {
        void simulationEventEmitter.emitAllStops(simulation.getStops());
        void simulationEventEmitter.emitAllBuffers(simulation.getBuffers(), tick.simulatedTimestamp);
    });

    await server.listen();
}

main().catch((error) => {
    console.error('[BOOT] Fatal error during startup:', error);
    process.exitCode = 1;
});
