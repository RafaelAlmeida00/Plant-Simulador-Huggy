import { ICar } from "./Car";
import { IStation } from "./Station";
import { RequiredPart } from "../../utils/shared";

export interface ILine {
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
}

export class Line {
  public id: string;
  public shop: string;
  public line: string;
  public stations: IStation[];
  public taktMn: number;
  public isFeederLine: boolean;
  public feedsToLine?: string;
  public feedsToStation?: string;
  public MTTR?: number;
  public MTBF?: number;
  productionTimeMinutes?: number;
  // Part Line fields
  public partType?: string;
  public requiredParts?: RequiredPart[];
  public partConsumptionStation?: string;
  // CreateWith - only create parts when specified line/station has output
  public createWith?: { line: string; station: string };

  constructor(config: ILine) {
    this.id = `${config.shop}-${config.line}`;
    this.shop = config.shop;
    this.line = config.line;
    this.stations = config.stations;
    this.taktMn = config.taktMn;
    this.isFeederLine = config.isFeederLine ?? false;
    this.feedsToLine = config.feedsToLine;
    this.feedsToStation = config.feedsToStation;
    this.MTTR = config.MTTR;
    this.MTBF = config.MTBF;
    this.productionTimeMinutes = config.productionTimeMinutes;
    this.partType = config.partType;
    this.requiredParts = config.requiredParts;
    this.partConsumptionStation = config.partConsumptionStation;
    this.createWith = config.createWith;
  }

  /** Retorna todas as estações da linha em ordem */
  public getAllStations(): IStation[] {
    return this.stations;
  }

  /** Retorna todas as estações em ordem reversa (última -> primeira) */
  public getAllStationsReverse(): IStation[] {
    const len = this.stations.length;
    const result = new Array<IStation>(len);
    for (let i = 0; i < len; i++) {
      result[i] = this.stations[len - 1 - i];
    }
    return result;
  }

  /** Retorna uma estação pelo índice */
  public getStationByIndex(index: number): IStation | undefined {
    return this.stations[index];
  }

  /** Retorna a primeira estação da linha */
  public getFirstStation(): IStation | undefined {
    return this.stations[0];
  }

  /** Retorna a última estação da linha */
  public getLastStation(): IStation | undefined {
    return this.stations[this.stations.length - 1];
  }

  /** Retorna o número total de estações */
  public getStationCount(): number {
    return this.stations.length;
  }
}
