// ============================================
// ENUMS E CONSTANTES DE DOMÍNIO (Tipagem Forte)
// ============================================

export type StopStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED";
export type StopSeverity = "LOW" | "MEDIUM" | "HIGH" | "PLANNED";
export type StopType = "MICRO" | "RANDOM_GENERATE" | "PROPAGATION" | "PLANNED";
export type BufferType = "BUFFER" | "REWORK_BUFFER" | "PART_BUFFER";
export type BufferStatus = "EMPTY" | "AVAILABLE" | "FULL";
export type ClockState = "stopped" | "running" | "paused";
export type LogEventType =
  | "MOVE" | "STOP_START" | "STOP_END" | "CAR_CREATED" | "CAR_COMPLETED"
  | "DEFECT_DETECTED" | "REWORK_START" | "REWORK_END" | "SHIFT_START"
  | "SHIFT_END" | "BUFFER_FULL" | "BUFFER_EMPTY";

export type StopReason =
  | "NEXT_FULL"           // próximo posto/buffer cheio
  | "PREV_EMPTY"          // posto anterior vazio
  | "RANDOM_FAILURE"      // falha aleatória (OEE)
  | "PLANNED_STOP"        // parada planejada
  | "SHIFT_CHANGE"        // troca de turno
  | "NIGHT_STOP"          // parada noturna
  | "LUNCH"               // almoço
  | "MEETING"             // reunião
  | "PROCESS_STOP"        // parada de processo genérica
  | "FALTA_PORTAS"        // Falta de peças específicas
  | "FALTA_MATERIAL"      // material geral
  | "BLOCKED_DOWNSTREAM"  // propagação: downstream cheio
  | "STARVED_UPSTREAM"    // propagação: upstream vazio
  | "DEFECT_REWORK"       // carro desviado para retrabalho
  | "PROCESS_QUALITY_FAILURE";

export type StopCategory = "MICRO" | "CAUSE" | "PROCESS_QUALITY_FAILURE" | "PROPAGATION" | "PLANNED_STOP" | "SHIFT_CHANGE" | "NIGHT_STOP" | "LUNCH" | "MEETING";

// ============================================
// INTERFACES BASE E LOCALIZAÇÃO
// ============================================

export interface ShopLineLocation {
  shop: string;
  line: string;
}

export interface StationLocation extends ShopLineLocation {
  station: string;
  shop: string;
  line: string;
}

// ============================================
// MODELOS DE DADOS (Interfaces de Estado)
// ============================================

  export interface ICarTrace {
    shop?: string;
    line?: string;
    station?: string;
    enter?: number;
    leave?: number;
  }

export interface ICarShopLeadtime {
  shop?: string;
  line?: string;
  enteredAt?: number;
  exitedAt?: number;
  leadtimeMs?: number;
}

export interface ICar {
  id: string;
  sequenceNumber: number;
  model: string;
  color: string[];
  createdAt: number;
  completedAt?: number;
  metadata?: Record<string, any>;
  trace: ICarTrace[];
  hasDefect: boolean;
  defects?: string[];
  inRework: boolean;
  reworkEnteredAt?: number;
  reworkCompletedAt?: number;
  shopLeadtimes: ICarShopLeadtime[];
  totalLeadtimeMs?: number;
  isPart: boolean;
  partName?: string;
}

export interface IStopLine extends StationLocation {
  id: number;
  reason: string | StopReason;
  startTime: number;
  endTime?: number;
  status: StopStatus;
  severity?: StopSeverity | null;
  type: StopType;
  category: StopCategory;
  durationMs?: number;
  station: string;
}

export interface IStation extends StationLocation {
  id: string;
  index: number;
  taktMn: number;
  taktSg: number;
  isFirstStation?: boolean;
  isLastStation?: boolean;
  occupied: boolean;
  currentCar: ICar | null;
  isStopped: boolean;
  stopReason?: string;
  startStop: number;
  finishStop: number;
  stopId?: string;
  isFirstCar: boolean;
}

export interface IBuffer {
  id: string;
  betweenShopOrLine: "shop" | "line";
  to: string;
  from: string;
  capacity: number;
  currentCount: number;
  cars: any[];
  type: BufferType;
  status?: BufferStatus;
}

export interface IShop {
  name: string;
  lines: Map<string, ILine> | Record<string, any>;
  bufferCapacity?: number;
  reworkBuffer?: number;
}


export interface ILine {
  id: string;
  shop: string;
  line: string;
  stations: IStation[];
  taktMn: number;
  isFeederLine?: boolean;
  feedsToLine?: string;
  feedsToStation?: string;
  MTTR?: number;
  MTBF?: number;
  productionTimeMinutes?: number;
  // Part Line fields
  partType?: string;                    // If set, this line produces parts of this type
  requiredParts?: RequiredPart[];       // Parts required by this line to operate
  partConsumptionStation?: string;      // Station that consumes parts (default: first station)
  // CreateWith - only create parts when specified line/station has output
  createWith?: { line: string; station: string };  // Sync part creation with another line's output
  buffers: RequiredBuffer[];
  routes: RequiredRoutes[];
  takt: TaktConfig;
}

// ============================================
// CONFIGURAÇÕES DO SISTEMA
// ============================================

export interface RequiredPart {
  partType: string;
  consumeStation?: string;
}

export interface RequiredBuffer {
  to: { shop: string; line: string }
  capacity: number;
}

export interface RequiredRoutes {
  fromStation: string;
  to: [{ shop: string; line: string, station: string }];
}

export interface TaktConfig {
  jph: number;
  taktMs?: number;
  shiftStart: string;
  shiftEnd: string;
}

export interface ShiftConfig {
  id: string;
  start: string;
  end: string;
}

export interface PlannedStopConfig {
  id: string;
  name: string;
  type: "LUNCH" | "MEETING" | "MAINTENANCE" | "SHIFT_CHANGE" | "NIGHT_STOP";
  reason: StopReason;
  affectsShops?: string[];
  affectsLines?: string[];
  startTime: string;
  durationMn: number;
  daysOfWeek?: number[];
}

export interface IFlowPlant {
  MIX_ITEMS_PER_LINE?: number;
  colors: string[];
  models: string[];
  BUFFER_EMIT_INTERVAL: number;
  BUFFER_PERSIST_INTERVAL: number;
  PLANT_EMIT_INTERVAL: number;
  STOPS_EMIT_INTERVAL: number;
  OEE_EMIT_INTERVAL: number;
  CARS_EMIT_INTERVAL: number;
  shops: Record<string, IShop>; // Tipado dinamicamente para IShop
  oeeTargets?: Record<string, number>;
  shifts?: ShiftConfig[];
  plannedStops?: PlannedStopConfig[];
  DPHU?: number;
  targetJPH?: number;
  typeSpeedFactor?: number;
  Rework_Time?: number;
  stationTaktMinFraction?: number;
  stationTaktMaxFraction?: number;
  stationstartProduction?: StationLocation[];
}

// ============================================
// EVENTOS E LOGS
// ============================================

export interface LogEvent extends Partial<StationLocation> {
  id: string;
  timestamp: number;
  type: LogEventType;
  carId?: string;
  data?: Record<string, any>;
}

export interface MovementLog {
  id: string;
  timestamp: number;
  carId: string;
  from?: Partial<StationLocation>;
  to?: Partial<StationLocation>;
  toBuffer?: string;
  eventType: "MOVE" | "BUFFER_IN" | "BUFFER_OUT" | "REWORK" | "COMPLETE";
  dwellTimeMs?: number;
}

export interface TickEvent {
  tickNumber: number;
  simulatedTimeMs: number;
  simulatedTimestamp: number;
  simulatedTimeString: string;
  realTimeMs: number;
  deltaMs: number;
  realTimestamp: number;
}

// ============================================
// CALLBACKS DA SIMULAÇÃO
// ============================================

export type TickListener = (event: TickEvent) => void | Promise<void>;

export interface SimulationCallbacks {
  onTick?: (event: TickEvent, state: any) => void;
  onStateChange?: (state: any) => void;
  onCarCreated?: (carId: string, shop: string, line: string, station: string, timestamp: number) => void;
  onCars?: (cars: any, timestamp: number) => void;
  onCarMoved?: (carId: string, from: StationLocation, to: StationLocation, timestamp: number) => void;
  onCarCompleted?: (carId: string, location: StationLocation, totalLeadtimeMs: number, timestamp: number) => void;
  onBufferIn?: (carId: string, bufferId: string, loc: ShopLineLocation, fromStation: string, timestamp: number) => void;
  onStopStartedStopLine?: (stop: IStopLine) => void;
  onStopEndedStopLine?: (stop: IStopLine) => void;
  [key: string]: any; // Permite extensões de adapters
}

export interface ISimulationClock {
  readonly state: ClockState;
  readonly speedFactor: number;
  readonly currentSimulatedTime: number;
  readonly currentTick: number;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  onTick(listener: TickListener): () => void;
  offTick(listener: TickListener): void;
  onStateChange(listener: (state: ClockState) => void): () => void;
}

export interface OEEData {
  date: string;
  shop: IShop | 'ALL';
  line: ILine | 'ALL';
  productionTime: number;       // em minutos
  carsProduction: number;
  taktTime: number;             // em minutos
  diffTime: number;             // em minutos
  oee: number;                  // percentual (0-100)
  jph: number;                  // carros por hora
}

// Interface para envio via WebSocket (usa apenas strings para identificadores)
export interface OEEDataEmit {
  date: string;
  shop: string;                 // Nome do shop ou 'ALL'
  line: string;                 // ID da linha ou 'ALL'
  productionTime: number;       // em minutos
  carsProduction: number;
  taktTime: number;             // em minutos
  diffTime: number;             // em minutos
  oee: number;                  // percentual (0-100)
  jph: number;                  // carros por hora
}

export interface OEECalculationInput {
  shop: IShop | "ALL";
  line: ILine | "ALL";
  productionTimeMinutes: number;
  taktTimeMinutes: number;
  simulatedTimestamp: number;
  shiftStart: string;           // "07:00"
  shiftEnd: string;             // "23:48"
  lastStationId: string;        // ID da última station da linha
}


export interface MTTRMTBFData {
  date: string;
  shop: string;
  line: string;
  station: string;
  mttr: number;    // Mean Time To Repair (em minutos)
  mtbf: number;    // Mean Time Between Failures (em minutos)
}

export interface MTTRMTBFCalculationInput {
  shop: string;
  line: string;
  station: string;
  productionTimeMinutes: number;
  stops: IStopLine[];
  simulatedTimestamp: number;
}

export interface PlantSnapshot {
  readonly timestamp: number;
  readonly shops: IShop[];
  readonly totalStations: number;
  readonly totalOccupied: number;
  readonly totalFree: number;
  readonly totalStopped: number;
}

export interface SimulationState {
  status: ClockState;
  currentTick: number;
  simulatedTimeMs: number;
  simulatedTimeFormatted: string;
  speedFactor: number;
}