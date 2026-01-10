import { ILine, IStation, RequiredBuffer, RequiredPart, RequiredRoutes, TaktConfig } from "../../utils/shared";

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
  public productionTimeMinutes?: number;
  // Part Line fields
  public partType?: string;
  public requiredParts?: RequiredPart[];
  public partConsumptionStation?: string;
  // CreateWith - only create parts when specified line/station has output
  public createWith?: { line: string; station: string };
  // Add missing ILine properties
  public buffers: RequiredBuffer[];
  public routes: RequiredRoutes[];
  public takt: TaktConfig;

  constructor(config: ILine) {
    this.id = config.id;
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
    // Assign missing properties
    this.buffers = config.buffers;
    this.routes = config.routes;
    this.takt = config.takt;
  }

}
