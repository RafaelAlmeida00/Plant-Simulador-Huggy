import { EventEmitter } from "events";
import { ISimulationClock, TickEvent, ClockState, TickListener, SimulationCallbacks, SimulationState, ICar } from "../utils/shared";
import { FlowPlant } from "../domain/config/flowPlant";
import { IShop } from "../utils/shared";
import { IStopLine } from "../utils/shared";
import { IBuffer } from "../utils/shared";
import { SimulationFlow } from "./SimulationFlow";
import { logger } from "../utils/logger";
import { DatabaseFactory } from "../adapters/database/DatabaseFactory";
import { ServiceLocator } from "../domain/services/ServiceLocator";
import { getActiveFlowPlant, loadDefaultPlantConfig } from "../domain/factories/plantFactory";

/**
 * Configuration options for SimulationClock
 */
export interface SimulationClockOptions {
  speedFactor: number;
  callbacks?: SimulationCallbacks;
  /** Session ID for session-based mode (Worker Threads) */
  sessionId?: string;
  /** ServiceLocator instance for session-based mode. If not provided, uses static ServiceLocator */
  serviceLocator?: ServiceLocator;
}

export class SimulationClock implements ISimulationClock {
  private emitter: EventEmitter;
  private intervalId: NodeJS.Timeout | null = null;
  private _state: ClockState = "stopped";
  private _speedFactor: number;
  private _currentTick: number = 0;
  private _currentSimulatedTime: number = 0;
  private _simulatedTimestamp: number = 0;
  private _startRealTime: number = 0;
  private _pausedAt: number = 0;
  private _totalPausedTime: number = 0;
  private readonly BASE_TICK_INTERVAL_MS = 1000;
  private readonly START_HOUR: number;
  private readonly START_MINUTE: number;

  // Instance-based simulatedDays (no longer static for session isolation)
  private simulatedDays: Set<string> = new Set();

  // Session-based mode support
  private readonly sessionId: string;
  private readonly serviceLocator: ServiceLocator | null;

  private callbacks: SimulationCallbacks;
  private flow: SimulationFlow | null = null;
  private readonly tickEvent: TickEvent = { tickNumber: 0, simulatedTimeMs: 0, simulatedTimestamp: 0, simulatedTimeString: '', realTimeMs: 0, deltaMs: 0, realTimestamp: 0 };

  /**
   * Create a new SimulationClock
   * @param speedFactor - Speed multiplier (legacy constructor signature)
   * @param callbacks - Simulation callbacks (legacy constructor signature)
   */
  constructor(speedFactor: number, callbacks?: SimulationCallbacks);
  /**
   * Create a new SimulationClock with options
   * @param options - Configuration options including session support
   */
  constructor(options: SimulationClockOptions);
  constructor(speedFactorOrOptions: number | SimulationClockOptions, callbacks: SimulationCallbacks = {}) {
    // Parse constructor arguments (support both legacy and new signatures)
    let speedFactor: number;
    let sessionId: string;
    let serviceLocator: ServiceLocator | null;
    let callbacksToUse: SimulationCallbacks;

    if (typeof speedFactorOrOptions === 'number') {
      // Legacy signature: constructor(speedFactor, callbacks)
      speedFactor = speedFactorOrOptions;
      sessionId = 'default';
      serviceLocator = null;
      callbacksToUse = callbacks;
    } else {
      // New signature: constructor(options)
      speedFactor = speedFactorOrOptions.speedFactor;
      sessionId = speedFactorOrOptions.sessionId ?? 'default';
      serviceLocator = speedFactorOrOptions.serviceLocator ?? null;
      callbacksToUse = speedFactorOrOptions.callbacks ?? {};
    }

    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this._speedFactor = speedFactor;
    this.sessionId = sessionId;
    this.serviceLocator = serviceLocator;
    this.callbacks = callbacksToUse;

    // Get shift start time from active plant config
    const flowPlant = getActiveFlowPlant();
    this.START_HOUR = Number(flowPlant.shifts?.[0]?.start?.split(":")[0] ?? "7");
    this.START_MINUTE = Number(flowPlant.shifts?.[0]?.start?.split(":")[1] ?? "0");

    const now = new Date();
    this._simulatedTimestamp = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      this.START_HOUR,
      this.START_MINUTE,
      0,
      0
    );
    this.setupClockListeners();
  }

  /**
   * Get the session ID for this clock instance
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Helper to get services - uses instance ServiceLocator if available, otherwise static
   */
  private getServices() {
    if (this.serviceLocator) {
      return {
        oeeService: this.serviceLocator.getOEEServiceInstance(),
        mttrmtbfService: this.serviceLocator.getMTTRMTBFServiceInstance(),
        carService: this.serviceLocator.getCarServiceInstance(),
        stopService: this.serviceLocator.getStopLineServiceInstance(),
        plantService: this.serviceLocator.getPlantServiceInstance(),
        bufferService: this.serviceLocator.getBufferServiceInstance(),
      };
    }
    return {
      oeeService: ServiceLocator.getOEEService(),
      mttrmtbfService: ServiceLocator.getMTTRMTBFService(),
      carService: ServiceLocator.getCarService(),
      stopService: ServiceLocator.getStopLineService(),
      plantService: ServiceLocator.getPlantService(),
      bufferService: ServiceLocator.getBufferService(),
    };
  }

  /**
   * Helper to check if ServiceLocator is initialized
   */
  private async ensureServiceLocatorInitialized(): Promise<void> {
    if (this.serviceLocator) {
      if (!this.serviceLocator.isInstanceInitialized()) {
        await this.serviceLocator.initializeInstance();
      }
    } else {
      if (!ServiceLocator.isInitialized()) {
        await ServiceLocator.initialize();
      }
    }
  }

  private createInitialTimestamp(): number {
    const now = new Date();
    const candidateDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

    const formatUtcDayKey = (d: Date): string => {
      const year = d.getUTCFullYear();
      const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = d.getUTCDate().toString().padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    let dayKey = formatUtcDayKey(candidateDate);
    while (this.simulatedDays.has(dayKey)) {
      candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
      dayKey = formatUtcDayKey(candidateDate);
    }

    this.simulatedDays.add(dayKey);

    return Date.UTC(
      candidateDate.getUTCFullYear(),
      candidateDate.getUTCMonth(),
      candidateDate.getUTCDate(),
      this.START_HOUR,
      this.START_MINUTE,
      0,
      0
    );
  }

  get state(): ClockState {
    return this._state;
  }

  get speedFactor(): number {
    return this._speedFactor;
  }

  get currentSimulatedTime(): number {
    return this._currentSimulatedTime;
  }

  get currentTick(): number {
    return this._currentTick;
  }

  get simulatedDate(): Date {
    return new Date(this._simulatedTimestamp);
  }

  get simulatedTimestamp(): number {
    return this._simulatedTimestamp;
  }

  public getSimulatedHour(): number {
    return new Date(this._simulatedTimestamp).getUTCHours();
  }

  public getSimulatedMinute(): number {
    return new Date(this._simulatedTimestamp).getUTCMinutes();
  }

  public getSimulatedSecond(): number {
    return new Date(this._simulatedTimestamp).getUTCSeconds();
  }

  public getSimulatedTimeString(): string {
    const d = new Date(this._simulatedTimestamp);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const s = d.getUTCSeconds();
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  public getSimulatedDateString(): string {
    const d = new Date(this._simulatedTimestamp);
    const day = d.getUTCDate().toString().padStart(2, '0');
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  public async start(): Promise<void> {
    if (this._state === "running") return;

    // Ensure ServiceLocator is initialized
    await this.ensureServiceLocatorInitialized();

    await this.resetMemoryState();

    const services = this.getServices();
    this.flow = new SimulationFlow({
      oeeService: services.oeeService,
      mttrmtbfService: services.mttrmtbfService,
      carService: services.carService,
      stopService: services.stopService,
      plantService: services.plantService,
      bufferService: services.bufferService,
      event: this.tickEvent,
      callbacks: this.callbacks
    });

    this.startInterval();
    this.setState("running");
  }

  public pause(): void {
    if (this._state !== "running") {
      return;
    }

    this.stopInterval();
    this._pausedAt = Date.now();
    this.setState("paused");

  }


  public resume(): void {
    if (this._state !== "paused") {
      return;
    }

    this._totalPausedTime += Date.now() - this._pausedAt;

    this.startInterval();
    this.setState("running");

  }


  public stop(): void {
    this.stopInterval();

    this.resetMemoryState();

    this.setState("stopped");
  }

  public async restart(): Promise<void> {

    this.simulatedDays.delete(this.getSimulatedDateString());
    this.stopInterval();

    this._currentTick = 0;
    this._currentSimulatedTime = 0;
    this._simulatedTimestamp = this.createInitialTimestamp();
    this._startRealTime = 0;
    this._pausedAt = 0;
    this._totalPausedTime = 0;

    await this.resetMemoryState();

    const services = this.getServices();
    this.flow = new SimulationFlow({
      oeeService: services.oeeService,
      mttrmtbfService: services.mttrmtbfService,
      carService: services.carService,
      stopService: services.stopService,
      plantService: services.plantService,
      bufferService: services.bufferService,
      event: this.tickEvent,
      callbacks: this.callbacks
    });

    this._startRealTime = Date.now();
    this.startInterval();
    this.setState("running");
  }

  /**
   * Set initial state for recovery
   * This allows restoring the clock to a specific point in time
   */
  public setInitialState(simulatedTimestamp: number, currentTick: number): void {
    this._simulatedTimestamp = simulatedTimestamp;
    this._currentTick = currentTick;
    this._currentSimulatedTime = currentTick * this._speedFactor * 1000;

    // Update the tick event with restored values
    this.tickEvent.tickNumber = currentTick;
    this.tickEvent.simulatedTimestamp = simulatedTimestamp;
    this.tickEvent.simulatedTimeMs = this._currentSimulatedTime;
    this.tickEvent.simulatedTimeString = this.getSimulatedTimeString();

    logger().info(`[SimulationClock] Initial state set: tick=${currentTick}, timestamp=${simulatedTimestamp}`);
  }

  private async resetMemoryState(): Promise<void> {
    await this.ensureServiceLocatorInitialized();

    await DatabaseFactory.getDatabase();

    await loadDefaultPlantConfig();

    this._currentTick = 0;
    this._currentSimulatedTime = 0;
    this._pausedAt = 0;
    this._totalPausedTime = 0;

    const services = this.getServices();
    services.bufferService.resetBuffers();
    services.stopService.resetAndStart();
    services.plantService.resetFactory();
    services.carService.cleanCarsCompleted();

    this._simulatedTimestamp = this.createInitialTimestamp();
    this._startRealTime = Date.now();
    this.flow = null;

  }



  public onTick(listener: TickListener): () => void {
    this.emitter.on("tick", listener);
    logger().debug(`Listener added for tick events.`);
    return () => this.offTick(listener);
  }

  public offTick(listener: TickListener): void {
    this.emitter.off("tick", listener);
  }

  public onStateChange(listener: (state: ClockState) => void): () => void {
    this.emitter.on("stateChange", listener);
    return () => this.emitter.off("stateChange", listener);
  }



  private startInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      this.tick();
    }, this.BASE_TICK_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    this._currentTick++;

    const deltaMs = this._speedFactor * 1000;
    this._currentSimulatedTime += deltaMs;
    this._simulatedTimestamp += deltaMs;

    const now = Date.now();

    this.tickEvent.tickNumber = this._currentTick;
    this.tickEvent.simulatedTimeMs = this._currentSimulatedTime;
    this.tickEvent.simulatedTimestamp = this._simulatedTimestamp;
    this.tickEvent.simulatedTimeString = this.getSimulatedTimeString();
    this.tickEvent.realTimeMs = now - this._startRealTime - this._totalPausedTime;
    this.tickEvent.deltaMs = deltaMs;
    this.tickEvent.realTimestamp = now;

    this.emitter.emit("tick", this.tickEvent);
  }

  private setState(newState: ClockState): void {
    const oldState = this._state;
    this._state = newState;

    if (oldState !== newState) {
      this.emitter.emit("stateChange", newState);
    }
  }

  private formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }


  public getState(): SimulationState {
    return {
      status: this.state,
      currentTick: this.currentTick,
      simulatedTimeMs: this.currentSimulatedTime,
      simulatedTimeFormatted: this.formatTime(this.currentSimulatedTime),
      speedFactor: this.speedFactor,
    };
  }


  public getBuffers(): Map<string, IBuffer> {
    return this.getServices().bufferService.getBuffers();
  }

  public getCars(): Map<string, ICar> {
    const carService = this.getServices().carService;
    const cars = carService.getAllCars();
    const parts = carService.getAllParts();
    const carsAndParts = new Map<string, ICar>([...cars, ...parts]);
    return carsAndParts
  }

  public getStops(): Map<string, IStopLine> {
    return this.getServices().stopService.getStops();
  }

  public getPlantSnapshot() {
    return this.getServices().plantService.getPlantSnapshot();
  }

  private processTick(event: TickEvent): void {
    if (this.flow) {
      this.flow.updateEvent(event);
      logger().debug(`Processing tick ${event.tickNumber} at simulated day ${new Date(event.simulatedTimestamp).toLocaleString("pt-BR", {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })} and time ${event.simulatedTimeString} (${event.simulatedTimestamp})`);
      this.flow.execute();
    }
  }

  private setupClockListeners(): void {
    this.onTick((event) => {
      this.processTick(event);

      if (this.callbacks.onTick) {
        this.callbacks.onTick(event, this.getState());
      }
    });

    this.onStateChange((state) => {

      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange(this.getState());
      }
    });
  }

}
