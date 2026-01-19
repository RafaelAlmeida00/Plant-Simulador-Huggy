// src/workers/SimulationWorker.ts

import { parentPort, workerData } from 'worker_threads';
import { ServiceLocator } from '../domain/services/ServiceLocator';
import { SimulationClock, SimulationClockOptions } from '../app/SimulationClock';
import { setActiveFlowPlant } from '../domain/factories/plantFactory';
import { IFlowPlant } from '../utils/shared';
import { DatabaseFactory } from '../adapters/database/DatabaseFactory';
import { logger } from '../utils/logger';

// Types for worker communication
interface WorkerMessage {
    type: 'INIT' | 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RECOVER';
    sessionId: string;
    payload?: any;
}

// Recovery payload structure
interface RecoveryPayload {
    simulatedTimestamp: number;
    currentTick: number;
    plantSnapshot: any | null;
    bufferStates: Array<{
        bufferId: string;
        carIds: string[];
        currentCount: number;
        status: string;
    }>;
    completedCarIds: string[];
    activeStops: Array<{
        stopId: string;
        shop: string;
        line: string;
        station: string;
        reason?: string;
        type?: string;
        category?: string;
        severity?: string;
        startTime: number;
        durationMs?: number;
    }>;
}

interface WorkerEvent {
    type: string;
    sessionId: string;
    data?: any;
    timestamp: number;
}

/**
 * SimulationWorker is the entry point for Worker Thread-based simulation sessions.
 *
 * Each worker runs an isolated simulation with its own:
 * - ServiceLocator instance
 * - SimulationClock instance
 * - Domain services and factories
 */
class SimulationWorker {
    private readonly sessionId: string;
    private serviceLocator: ServiceLocator | null = null;
    private simulationClock: SimulationClock | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private initialized: boolean = false;

    private readonly HEARTBEAT_INTERVAL_MS = 5_000;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.setupMessageHandler();
        this.log('Worker created');
    }

    /**
     * Initialize the worker with configuration
     */
    private async initialize(payload: { configSnapshot?: string; speedFactor?: number }): Promise<void> {
        if (this.initialized) {
            this.log('Already initialized, skipping');
            return;
        }

        this.log('Initializing...');

        try {
            // Ensure database is connected
            await DatabaseFactory.getDatabase();

            // Parse and set plant configuration if provided
            if (payload.configSnapshot) {
                try {
                    const config = JSON.parse(payload.configSnapshot) as IFlowPlant;
                    setActiveFlowPlant(config);
                    this.log('Loaded custom plant configuration');
                } catch (parseError) {
                    this.log('Failed to parse config snapshot, using default');
                }
            }

            // Create session-specific ServiceLocator
            this.serviceLocator = new ServiceLocator(this.sessionId);
            await this.serviceLocator.initializeInstance();

            this.log('ServiceLocator initialized');

            // Create simulation clock with session-aware configuration
            const clockOptions: SimulationClockOptions = {
                speedFactor: payload.speedFactor ?? 60,
                sessionId: this.sessionId,
                serviceLocator: this.serviceLocator,
                callbacks: this.createCallbacks()
            };

            this.simulationClock = new SimulationClock(clockOptions);

            this.initialized = true;

            // Start heartbeat
            this.startHeartbeat();

            // Notify main thread
            this.sendEvent('INIT_COMPLETE', { sessionId: this.sessionId });

            this.log('Initialization complete');

        } catch (error) {
            const err = error as Error;
            this.log(`Initialization failed: ${err.message}`);
            this.sendEvent('ERROR', {
                message: err.message,
                stack: err.stack
            });
        }
    }

    /**
     * Start the simulation
     */
    private async start(): Promise<void> {
        if (!this.initialized || !this.simulationClock) {
            this.sendEvent('ERROR', { message: 'Worker not initialized' });
            return;
        }

        this.log('Starting simulation...');

        try {
            await this.simulationClock.start();
            this.sendEvent('STATE_CHANGE', { status: 'running' });
            this.log('Simulation started');
        } catch (error) {
            const err = error as Error;
            this.sendEvent('ERROR', { message: err.message });
        }
    }

    /**
     * Pause the simulation
     */
    private pause(): void {
        if (!this.simulationClock) {
            this.sendEvent('ERROR', { message: 'Worker not initialized' });
            return;
        }

        this.log('Pausing simulation...');
        this.simulationClock.pause();
        this.sendEvent('STATE_CHANGE', { status: 'paused' });
        this.log('Simulation paused');
    }

    /**
     * Resume the simulation
     */
    private resume(): void {
        if (!this.simulationClock) {
            this.sendEvent('ERROR', { message: 'Worker not initialized' });
            return;
        }

        this.log('Resuming simulation...');
        this.simulationClock.resume();
        this.sendEvent('STATE_CHANGE', { status: 'running' });
        this.log('Simulation resumed');
    }

    /**
     * Stop the simulation and clean up
     */
    private stop(): void {
        this.log('Stopping simulation...');

        this.stopHeartbeat();

        if (this.simulationClock) {
            this.simulationClock.stop();
            this.simulationClock = null;
        }

        this.serviceLocator = null;
        this.initialized = false;

        this.sendEvent('STATE_CHANGE', { status: 'stopped' });
        this.log('Simulation stopped');

        // Gracefully exit the worker thread with code 0
        // This signals to the main thread that shutdown was intentional
        // Small delay ensures STATE_CHANGE message is sent before exit
        setTimeout(() => {
            process.exit(0);
        }, 100);
    }

    /**
     * Recover session state from recovery data
     * This restores the simulation to its previous state before the server restart
     */
    private async recover(payload: RecoveryPayload): Promise<void> {
        if (!this.initialized || !this.serviceLocator || !this.simulationClock) {
            this.sendEvent('ERROR', { message: 'Worker not initialized, cannot recover' });
            return;
        }

        this.log('Recovering session state...');

        try {
            // 1. Restore completed car IDs to CarService
            const carService = this.serviceLocator.getCarServiceInstance();
            if (carService.restoreCompletedCars && payload.completedCarIds.length > 0) {
                carService.restoreCompletedCars(new Set(payload.completedCarIds));
                this.log(`Restored ${payload.completedCarIds.length} completed car IDs`);
            }

            // 2. Restore buffer states
            const bufferService = this.serviceLocator.getBufferServiceInstance();
            if (bufferService.restoreBufferStates && payload.bufferStates.length > 0) {
                bufferService.restoreBufferStates(payload.bufferStates);
                this.log(`Restored ${payload.bufferStates.length} buffer states`);
            }

            // 3. Restore active stops
            const stopService = this.serviceLocator.getStopLineServiceInstance();
            if (stopService.restoreActiveStops && payload.activeStops.length > 0) {
                stopService.restoreActiveStops(payload.activeStops);
                this.log(`Restored ${payload.activeStops.length} active stops`);
            }

            // 4. Restore plant state from snapshot
            const plantService = this.serviceLocator.getPlantServiceInstance();
            if (plantService.restoreFromSnapshot && payload.plantSnapshot) {
                plantService.restoreFromSnapshot(payload.plantSnapshot);
                this.log('Restored plant state from snapshot');
            }

            // 5. Set initial clock state (timestamp and tick)
            if (this.simulationClock.setInitialState) {
                this.simulationClock.setInitialState(payload.simulatedTimestamp, payload.currentTick);
                this.log(`Restored clock state: tick=${payload.currentTick}, timestamp=${payload.simulatedTimestamp}`);
            }

            this.sendEvent('EVENT', {
                eventType: 'recoveryComplete',
                recoveredAt: Date.now(),
                restoredTick: payload.currentTick,
                restoredTimestamp: payload.simulatedTimestamp
            });

            this.log('Session recovery complete');

        } catch (error) {
            const err = error as Error;
            this.log(`Recovery failed: ${err.message}`);
            this.sendEvent('ERROR', {
                message: `Recovery failed: ${err.message}`,
                stack: err.stack
            });
        }
    }

    /**
     * Create simulation callbacks that forward events to main thread
     */
    private createCallbacks() {
        return {
            onTick: (event: any, state: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'tick',
                    tick: {
                        tickNumber: event.tickNumber,
                        simulatedTimestamp: event.simulatedTimestamp,
                        simulatedTimeString: event.simulatedTimeString
                    },
                    state: {
                        status: state.status,
                        currentTick: state.currentTick,
                        simulatedTimeMs: state.simulatedTimeMs
                    }
                });
            },
            onCarCreated: (carId: string, shop: string, line: string, station: string, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'carCreated',
                    carId, shop, line, station, timestamp
                });
            },
            onCarMoved: (carId: string, from: any, to: any, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'carMoved',
                    carId, from, to, timestamp
                });
            },
            onCarCompleted: (carId: string, location: any, totalLeadtimeMs: number, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'carCompleted',
                    carId, location, totalLeadtimeMs, timestamp
                });
            },
            onBufferIn: (carId: string, bufferId: string, loc: any, fromStation: string, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'bufferIn',
                    carId, bufferId, loc, fromStation, timestamp
                });
            },
            onBufferOut: (carId: string, bufferId: string, shop: string, line: string, toStation: string, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'bufferOut',
                    carId, bufferId, shop, line, toStation, timestamp
                });
            },
            onStopStartedStopLine: (stop: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'stopStarted',
                    stop: this.serializeStop(stop)
                });
            },
            onStopEndedStopLine: (stop: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'stopEnded',
                    stop: this.serializeStop(stop)
                });
            },
            onOEECalculated: (oeeData: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'oeeCalculated',
                    oee: oeeData
                });
            },
            onOEEShiftEnd: (oeeData: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'oeeShiftEnd',
                    oee: oeeData
                });
            },
            onMTTRMTBFCalculated: (data: any) => {
                this.sendEvent('EVENT', {
                    eventType: 'mttrMtbfCalculated',
                    data
                });
            },
            onCars: (cars: any, timestamp: number) => {
                // Only send periodically to avoid flooding
                // This is handled by throttling in the main thread
            },
            onReworkInDetailed: (carId: string, bufferId: string, shop: string, line: string, station: string, defectId: string, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'reworkIn',
                    carId, bufferId, shop, line, station, defectId, timestamp
                });
            },
            onReworkOutDetailed: (carId: string, bufferId: string, shop: string, line: string, station: string, timestamp: number) => {
                this.sendEvent('EVENT', {
                    eventType: 'reworkOut',
                    carId, bufferId, shop, line, station, timestamp
                });
            }
        };
    }

    /**
     * Serialize stop object for transmission
     */
    private serializeStop(stop: any): any {
        return {
            id: stop.id,
            reason: stop.reason,
            type: stop.type,
            category: stop.category,
            startTime: stop.startTime instanceof Date ? stop.startTime.getTime() : stop.startTime,
            endTime: stop.endTime instanceof Date ? stop.endTime.getTime() : stop.endTime,
            durationMs: stop.durationMs,
            status: stop.status,
            severity: stop.severity,
            shop: stop.shop,
            line: stop.line,
            station: stop.station
        };
    }

    /**
     * Setup message handler for commands from main thread
     */
    private setupMessageHandler(): void {
        if (!parentPort) {
            throw new Error('SimulationWorker must be run as a Worker Thread');
        }

        parentPort.on('message', async (message: WorkerMessage) => {
            this.log(`Received command: ${message.type}`);

            try {
                switch (message.type) {
                    case 'INIT':
                        await this.initialize(message.payload || {});
                        break;

                    case 'START':
                        await this.start();
                        break;

                    case 'PAUSE':
                        this.pause();
                        break;

                    case 'RESUME':
                        this.resume();
                        break;

                    case 'STOP':
                        this.stop();
                        break;

                    case 'RECOVER':
                        await this.recover(message.payload as RecoveryPayload);
                        break;

                    default:
                        this.log(`Unknown command: ${message.type}`);
                }
            } catch (error) {
                const err = error as Error;
                this.sendEvent('ERROR', {
                    command: message.type,
                    message: err.message,
                    stack: err.stack
                });
            }
        });
    }

    /**
     * Send event to main thread
     */
    private sendEvent(type: string, data?: any): void {
        if (!parentPort) return;

        const event: WorkerEvent = {
            type,
            sessionId: this.sessionId,
            data,
            timestamp: Date.now()
        };

        parentPort.postMessage(event);
    }

    /**
     * Start heartbeat to signal worker is alive
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) return;

        this.heartbeatInterval = setInterval(() => {
            this.sendEvent('HEARTBEAT', {
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            });
        }, this.HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Stop heartbeat
     */
    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Log message with session prefix
     */
    private log(message: string): void {
        logger().debug(`[Worker:${this.sessionId}] ${message}`);
    }
}

// ============================================================
// WORKER ENTRY POINT
// ============================================================

// Get session ID from worker data
const { sessionId } = workerData as { sessionId: string };

if (!sessionId) {
    throw new Error('sessionId is required in workerData');
}

// Create and run the worker
const worker = new SimulationWorker(sessionId);
