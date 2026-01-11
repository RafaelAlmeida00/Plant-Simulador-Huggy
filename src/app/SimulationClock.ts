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
  private readonly START_HOUR = Number(getActiveFlowPlant().shifts?.[0]?.start?.split(":")[0] ?? "7");
  private readonly START_MINUTE = Number(getActiveFlowPlant().shifts?.[0]?.start?.split(":")[1] ?? "0");

  private static simulatedDays: Set<string> = new Set();

  private callbacks: SimulationCallbacks;
  private flow: SimulationFlow | null = null;
  private readonly tickEvent: TickEvent = { tickNumber: 0, simulatedTimeMs: 0, simulatedTimestamp: 0, simulatedTimeString: '', realTimeMs: 0, deltaMs: 0, realTimestamp: 0 };

  constructor(speedFactor: number, callbacks: SimulationCallbacks = {}) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this._speedFactor = speedFactor;
    this.callbacks = callbacks;
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
    while (SimulationClock.simulatedDays.has(dayKey)) {
      candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
      dayKey = formatUtcDayKey(candidateDate);
    }

    SimulationClock.simulatedDays.add(dayKey);

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
    await ServiceLocator.initialize();

    await this.resetMemoryState();

    this.flow = new SimulationFlow({
      oeeService: ServiceLocator.getOEEService(),
      mttrmtbfService: ServiceLocator.getMTTRMTBFService(),
      carService: ServiceLocator.getCarService(),
      stopService: ServiceLocator.getStopLineService(),
      plantService: ServiceLocator.getPlantService(),
      bufferService: ServiceLocator.getBufferService(),
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

    SimulationClock.simulatedDays.delete(this.getSimulatedDateString());
    this.stopInterval();

    this._currentTick = 0;
    this._currentSimulatedTime = 0;
    this._simulatedTimestamp = this.createInitialTimestamp();
    this._startRealTime = 0;
    this._pausedAt = 0;
    this._totalPausedTime = 0;

    await this.resetMemoryState();

    this.flow = new SimulationFlow({
      oeeService: ServiceLocator.getOEEService(),
      mttrmtbfService: ServiceLocator.getMTTRMTBFService(),
      carService: ServiceLocator.getCarService(),
      stopService: ServiceLocator.getStopLineService(),
      plantService: ServiceLocator.getPlantService(),
      bufferService: ServiceLocator.getBufferService(),
      event: this.tickEvent,
      callbacks: this.callbacks
    });

    this._startRealTime = Date.now();
    this.startInterval();
    this.setState("running");
  }

  private async resetMemoryState(): Promise<void> {
    if (!ServiceLocator.isInitialized()) {
      await ServiceLocator.initialize();
    }

    await DatabaseFactory.getDatabase();

    await loadDefaultPlantConfig();

    const finalTick = this._currentTick;
    const finalTime = this._currentSimulatedTime;

    this._currentTick = 0;
    this._currentSimulatedTime = 0;
    this._pausedAt = 0;
    this._totalPausedTime = 0;

    ServiceLocator.getBufferService().resetBuffers();
    ServiceLocator.getStopLineService().resetAndStart();
    ServiceLocator.getPlantService().resetFactory();
    ServiceLocator.getCarService().cleanCarsCompleted();

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
    return ServiceLocator.getBufferService().getBuffers();
  }

  public getCars(): Map<string, ICar> {
    const carService = ServiceLocator.getCarService();
    const cars = carService.getAllCars();
    const parts = carService.getAllParts();
    const carsAndParts = new Map<string, ICar>([...cars, ...parts]);
    return carsAndParts
  }

  public getStops(): Map<string, IStopLine> {
    return ServiceLocator.getStopLineService().getStops();
  }

  public getPlantSnapshot() {
    return ServiceLocator.getPlantService().getPlantSnapshot();
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
