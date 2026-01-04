import { ICar } from "./Car";

export type StationStopType =
  | "NONE"
  | "BLOCKED_NEXT_FULL"
  | "STARVED_PREV_EMPTY"
  | "PROCESS_STOP"
  | "PLANNED_STOP"
  | "SHIFT_CHANGE"
  | "NIGHT_STOP"
  | "LUNCH"
  | "MEETING";

// Tipos de parada que bloqueiam operações
const REAL_STOP_TYPES: ReadonlySet<StationStopType> = new Set([
  "PROCESS_STOP",
  "PLANNED_STOP",
  "SHIFT_CHANGE",
  "NIGHT_STOP",
  "LUNCH",
  "MEETING",
]);

export interface IStation {
  id: string;
  shop: string;
  line: string;
  index: number;
  taktMn: number;
  isFirstStation?: boolean;  // primeira estação da linha
  isLastStation?: boolean;   // última estação da linha
  occupied: boolean;
  currentCar: ICar | null;
  isStopped: boolean;
  stopReason?: string;
  startStop: number;
  finishStop: number;
  stopId?: string;
  isFirstCar: boolean;
  taktSg: number;
}

export class Station implements IStation {
  public id: string;
  public shopId: string;
  public lineId: string;
  public shop: string;
  public line: string;
  public index: number;
  public taktMn: number;
  public taktSg: number;
  public isFirstStation: boolean;
  public isLastStation: boolean;
  public occupied = false;
  public currentCar: ICar | null;
  public isStopped: boolean;
  public stopReason?: string;
  public startStop: number;
  public finishStop: number;
  public stopId?: string;
  public isFirstCar: boolean = true;

  constructor(config: IStation) {
    this.id = config.id;
    this.shop = config.shop;
    this.shopId = config.shop;
    this.line = config.line;
    this.lineId = config.line;
    this.index = config.index;
    this.taktMn = config.taktMn;
    this.isFirstStation = config.isFirstStation ?? false;
    this.isLastStation = config.isLastStation ?? false;
    this.occupied = config.occupied;
    this.currentCar = config.currentCar;
    this.isStopped = config.isStopped;
    this.stopReason = config.stopReason;
    this.startStop = config.startStop;
    this.finishStop = config.finishStop;
    this.stopId = config.stopId;
    this.isFirstCar = true;
    this.taktSg = config.taktSg;
  }

}