import { ICar, IStation } from "../../utils/shared";


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
  public station: string; 

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
    this.station = config.station;
  }

}