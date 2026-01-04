// ============================================
// TIPOS DE CONFIGURAÇÃO
// ============================================

import type { IShop } from "../domain/models/Shop";
import type { IStopLine } from "../domain/models/StopLine";
import type { ICar } from "../domain/models/Car";

export interface TaktConfig {
  jph: number;         // carros por hora
  taktMs?: number;     // derived = 3600000 / jph (optional)
  shiftStart: string;  // "07:00"
  shiftEnd: string;    // "23:48"
}

// Configuração de turnos
export interface ShiftConfig {
  id: string;
  start: string;       // "07:00"
  end: string;         // "16:48"
}

// Paradas planejadas
export interface PlannedStopConfig {
  id: string;
  name: string;        // nome da parada para logs
  type: "LUNCH" | "MEETING" | "MAINTENANCE" | "SHIFT_CHANGE" | "NIGHT_STOP";
  reason: StopReason;  // motivo para o StopDetector
  affectsShops?: string[];    // quais shops afeta (undefined = todas)
  affectsLines?: string[];    // quais linhas afeta (undefined = todas)
  startTime: string;   // "12:00"
  durationMn: number;  // duração em ms
  daysOfWeek?: number[];  // 0=Dom, 1=Seg, 2=Ter... (undefined = todos)
}

// Routing / buffer types used in configs
export interface BufferTarget { shop: string; line: string; station?: string; }
export interface BufferConfig { capacity: number; }
export interface RouteTo { shop: string; line: string; station?: string; }
export interface Route { fromStation: string; to: RouteTo[]; }

// Part Line configuration - required parts for consuming lines
export interface RequiredPart {
  partType: string;           // Type of part required (e.g., "DOOR", "ENGINE")
  consumeStation?: string;    // Station that consumes this part (default: first station)
}

export interface StartProductionStation {
  shop: string;
  line: string;
  station: string;
}

// Top-level system configuration
export interface IFlowPlant {
  shops: Record<string, IShop>;
  oeeTargets?: Record<string, number>;
  shifts?: ShiftConfig[];
  plannedStops?: PlannedStopConfig[];
  DPHU?: number;                    // Defeitos por 100 unidades
  targetJPH?: number;               // JPH alvo padrão
  typeSpeedFactor?: number;
  Rework_Time?: number;         // Fator de velocidade da simulação (1 = tempo real, 10 = 10x mais rápido)

  // Distribuição do takt entre stations (balanceamento)
  // Frações relativas ao takt da linha. Ex.: 0.7 = 70% do takt.
  stationTaktMinFraction?: number;
  stationTaktMaxFraction?: number;
  
  // Lista de postos que recebem carros "novos" (injeção no fluxo)
  // Por padrão, deve conter apenas o 1º posto da 1ª linha do fluxo.
  stationstartProduction?: StartProductionStation[];
}

// ============================================
// TIPOS DE DEFEITOS E RETRABALHO
// ============================================

export type DefectSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface DefectInfo {
  id: string;
  carId: string;
  shop: string;
  line: string;
  station: string;
  detectedAt: number;
  severity: DefectSeverity;
  description: string;
  estimatedRepairMs: number;
}

export interface ReworkEntry {
  car: any;  // Car object
  defect: DefectInfo;
  enteredAt: number;
  estimatedCompleteAt: number;
  completedAt?: number;
  priority: number;  // maior = mais prioritário
}

// ============================================
// TIPOS DE PARADAS
// ============================================

export type StopCategory = "MICRO" | "CAUSE" | "PROPAGATION";

export type StopReason =
  | "NEXT_FULL"           // próximo posto/buffer cheio
  | "PREV_EMPTY"          // posto anterior vazio
  | "RANDOM_FAILURE"      // falha aleatória (OEE)
  | "PLANNED_STOP"        // parada planejada
  | "SHIFT_CHANGE"        // troca de turno
  | "NIGHT_STOP"          // parada noturna
  | "LUNCH"               // almoço
  | "MEETING"             // reunião
  | "FALTA_PORTAS"        // Door Line não entregou
  | "FALTA_MATERIAL"      // material não chegou
  | "BLOCKED_DOWNSTREAM"  // propagação: downstream cheio
  | "STARVED_UPSTREAM"    // propagação: upstream vazio
  | "DEFECT_REWORK";      // carro desviado para retrabalho

export interface StopRecord {
  id: string;
  category: StopCategory;
  reason: StopReason;
  severity: DefectSeverity;
  shop: string;
  line: string;
  station: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  propagatedFrom?: string;  // ID da parada que causou esta
  propagatedTo?: string[];  // IDs das paradas causadas por esta
  carsImpacted?: number;
}


export interface LogEvent {
  id: string;
  timestamp: number;
  type: "MOVE" | "STOP_START" | "STOP_END" | "CAR_CREATED" | "CAR_COMPLETED" | 
        "DEFECT_DETECTED" | "REWORK_START" | "REWORK_END" | "SHIFT_START" | 
        "SHIFT_END" | "BUFFER_FULL" | "BUFFER_EMPTY";
  shop: string;
  line?: string;
  station?: string;
  carId?: string;
  data?: Record<string, any>;
}

export interface MovementLog {
  id: string;
  timestamp: number;
  carId: string;
  fromShop?: string;
  fromLine?: string;
  fromStation?: string;
  toShop?: string;
  toLine?: string;
  toStation?: string;
  toBuffer?: string;         // se foi para buffer
  eventType: "MOVE" | "BUFFER_IN" | "BUFFER_OUT" | "REWORK" | "COMPLETE";
  dwellTimeMs?: number;       // tempo que ficou no posto anterior
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
export type TickListener = (event: TickEvent) => void | Promise<void>;
export type ClockState = "stopped" | "running" | "paused";
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


export interface SimulationState {
  status: ClockState;
  currentTick: number;
  simulatedTimeMs: number;
  simulatedTimeFormatted: string;
  speedFactor: number;
}

export interface SimulationCallbacks {
  // Eventos básicos de simulação
  onTick?: (event: TickEvent, state: SimulationState) => void;
  onStateChange?: (state: SimulationState) => void;
  
  // Eventos de carros
  onCarCreated?: (carId: string, shop: string, line: string, station: string, timestamp: number) => void;
  // Estado completo dos carros (em memória) - emitido sempre que um novo carro é criado
  onCars?: (cars: ICar[], timestamp: number) => void;
  onCarMoved?: (carId: string, fromShop: string, fromLine: string, fromStation: string, 
                toShop: string, toLine: string, toStation: string, timestamp: number) => void;
  onCarCompleted?: (carId: string, shop: string, line: string, station: string, 
                    totalLeadtimeMs: number, timestamp: number) => void;
  onCarProduced?: (carId: string) => void;
  onCarEnterStation?: (carId: string, stationId: string) => void;
  
  // Eventos de buffer
  onBufferIn?: (carId: string, bufferId: string, shop: string, line: string, 
                fromStation: string, timestamp: number) => void;
  onBufferOut?: (carId: string, bufferId: string, shop: string, line: string, 
                 toStation: string, timestamp: number) => void;
  
  // Eventos de rework
  onReworkIn?: (carId: string, bufferId: string, shop: string, defectId: string, timestamp: number) => void;
  onReworkOut?: (carId: string, bufferId: string, shop: string, toStation: string, timestamp: number) => void;

  // Versões detalhadas (adapters)
  onReworkInDetailed?: (carId: string, bufferId: string, shop: string, line: string, station: string, defectId: string, timestamp: number) => void;
  onReworkOutDetailed?: (carId: string, bufferId: string, shop: string, line: string, station: string, timestamp: number) => void;

  // Eventos de peças (Part Lines)
  onPartCreated?: (partId: string, partType: string, model: string, shop: string, line: string, station: string, timestamp: number) => void;
  onPartConsumed?: (partId: string, partType: string, model: string, carId: string, shop: string, line: string, station: string, timestamp: number) => void;
  onPartShortage?: (carId: string, partType: string, model: string, shop: string, line: string, station: string, timestamp: number) => void;
  
  // Eventos de paradas
  onStopStarted?: (stopId: string, shop: string, line: string, station: string, 
                   reason: string, category: string, timestamp: number) => void;
  onStopEnded?: (stopId: string, shop: string, line: string, station: string, 
                 reason: string, durationMs: number, timestamp: number) => void;
  onStationStop?: (stationId: string, reason: string) => void;

  // Versões detalhadas (adapters)
  onStopStartedStopLine?: (stop: IStopLine) => void;
  onStopEndedStopLine?: (stop: IStopLine) => void;

  // Eventos de OEE (emitidos ao fim do turno e dinamicamente)
  onOEECalculated?: (oeeData: any[]) => void;
  onOEEShiftEnd?: (oeeData: any) => void;

  // Eventos de MTTR/MTBF (emitidos ao fim do turno)
  onMTTRMTBFCalculated?: (data: any) => void;

  // Eventos de stops com detalhes (inclui planned e random)
  onStopsWithDetails?: (stops: Map<string, IStopLine>, plannedStops: any[], randomStops: IStopLine[]) => void;

  // Evento para persistir paradas geradas (planejadas e aleatórias)
  onStopGenerated?: (stop: IStopLine) => void;
}