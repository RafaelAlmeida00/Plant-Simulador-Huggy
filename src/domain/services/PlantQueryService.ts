
import { ILine, Line } from "../models/Line";
import { IShop, Shop } from "../models/Shop";
import { IStation } from "../models/Station";

export interface StationSnapshot {
  readonly id: string;
  readonly shop: string;
  readonly line: string;
  readonly index: number;
  readonly taktMn: number;
  readonly taktSg: number;
  readonly isFirstStation: boolean;
  readonly isLastStation: boolean;
  readonly occupied: boolean;
  readonly currentCarId: string | null;
  readonly currentCarSequenceNumber: number | null;
  readonly isStopped: boolean;
  readonly stopReason?: string;
  readonly startStop: number;
  readonly finishStop: number;
  readonly stopId?: string;
  readonly isFirstCar: boolean;
}


export interface LineSnapshot {
  readonly id: string;
  readonly shop: string;
  readonly line: string;
  readonly taktMn: number;
  readonly isFeederLine: boolean;
  readonly feedsToLine?: string;
  readonly feedsToStation?: string;
  readonly MTTR?: number;
  readonly MTBF?: number;
  readonly productionTimeMinutes?: number;
  readonly stationCount: number;
  readonly occupiedCount: number;
  readonly freeCount: number;
  readonly stoppedCount: number;
  readonly stations: StationSnapshot[];
}


export interface ShopSnapshot {
  readonly name: string;
  readonly bufferCapacity: number;
  readonly reworkBuffer: number;
  readonly lineCount: number;
  readonly totalStations: number;
  readonly totalOccupied: number;
  readonly totalFree: number;
  readonly totalStopped: number;
  readonly lines: LineSnapshot[];
}

export interface PlantSnapshot {
  readonly timestamp: number;
  readonly shops: ShopSnapshot[];
  readonly totalStations: number;
  readonly totalOccupied: number;
  readonly totalFree: number;
  readonly totalStopped: number;
}


export interface IPlantQueryService {
  // Queries de Linhas
  getAllLinesByShop(shopName: string): ILine[];
  getAllReverseLinesByShop(shopName: string): ILine[];
  getLineByShop(shopName: string, lineName: string): ILine | undefined;

  // Queries de Estações
  getAllStationsByLine(shopName: string, lineName: string): IStation[];
  getAllReverseStationsByLine(shopName: string, lineName: string): IStation[];
  getFreeStationsByLine(shopName: string, lineName: string): IStation[];
  getOccupiedStationsByLine(shopName: string, lineName: string): IStation[];
  getAllStoppedStationsByLine(shopName: string, lineName: string): IStation[];
  getStationByLine(shopName: string, lineName: string, stationIndex: number): IStation | undefined;

  // Snapshots (imutáveis)
  getStationSnapshot(shopName: string, lineName: string, stationIndex: number): StationSnapshot | null;
  getLineSnapshot(shopName: string, lineName: string): LineSnapshot | null;
  getShopSnapshot(shopName: string): ShopSnapshot | null;
  getPlantSnapshot(): PlantSnapshot;
}


export class PlantQueryService implements IPlantQueryService {
  
  constructor(private readonly shops: Map<string, IShop>) {}

  public getAllLinesByShop(shopName: string): ILine[] {
    const shop = this.shops.get(shopName);
    if (!shop) return [];
    
    if (shop instanceof Shop) {
      return shop.getAllLines();
    }
    return Array.from(shop.lines.values());
  }


  public getAllReverseLinesByShop(shopName: string): ILine[] {
    const shop = this.shops.get(shopName);
    if (!shop) return [];

    if (shop instanceof Shop) {
      return shop.getAllLinesReverse();
    }
    
    // shop.lines é Map<string, ILine> ou Record<string, any>
    if (shop.lines instanceof Map) {
      return Array.from(shop.lines.values() as IterableIterator<ILine>).reverse();
    }
    return Object.values(shop.lines as Record<string, ILine>).reverse();
  }

  public getLineByShop(shopName: string, lineName: string): ILine | undefined {
    const shop = this.shops.get(shopName);
    if (!shop) return undefined;

    if (shop instanceof Shop) {
      return shop.getLine(lineName);
    }
    return shop.lines.get(lineName);
  }

  public getAllStationsByLine(shopName: string, lineName: string): IStation[] {
    const line = this.getLineByShop(shopName, lineName);
    if (!line) return [];

    if (line instanceof Line) {
      return line.getAllStations();
    }
    return line.stations;
  }

  public getAllReverseStationsByLine(shopName: string, lineName: string): IStation[] {
    const line = this.getLineByShop(shopName, lineName);
    if (!line) return [];

    if (line instanceof Line) {
      return line.getAllStationsReverse();
    }
    const stations = line.stations;
    const len = stations.length;
    const result = new Array<IStation>(len);
    for (let i = 0; i < len; i++) {
      result[i] = stations[len - 1 - i];
    }
    return result;
  }

  public getFreeStationsByLine(shopName: string, lineName: string): IStation[] {
    const stations = this.getAllStationsByLine(shopName, lineName);
    const result: IStation[] = [];
    const len = stations.length;
    for (let i = 0; i < len; i++) {
      if (!stations[i].occupied) result.push(stations[i]);
    }
    return result;
  }

  public getOccupiedStationsByLine(shopName: string, lineName: string): IStation[] {
    const stations = this.getAllStationsByLine(shopName, lineName);
    const result: IStation[] = [];
    const len = stations.length;
    for (let i = 0; i < len; i++) {
      if (stations[i].occupied) result.push(stations[i]);
    }
    return result;
  }

  public getAllStoppedStationsByLine(shopName: string, lineName: string): IStation[] {
    const stations = this.getAllStationsByLine(shopName, lineName);
    const result: IStation[] = [];
    const len = stations.length;
    for (let i = 0; i < len; i++) {
      if (stations[i].isStopped) result.push(stations[i]);
    }
    return result;
  }

  public getStationByLine(shopName: string, lineName: string, stationIndex: number): IStation | undefined {
    const line = this.getLineByShop(shopName, lineName);
    if (!line) return undefined;

    if (line instanceof Line) {
      return line.getStationByIndex(stationIndex);
    }
    return line.stations[stationIndex];
  }

  public getStationSnapshot(shopName: string, lineName: string, stationIndex: number): StationSnapshot | null {
    const station = this.getStationByLine(shopName, lineName, stationIndex);
    if (!station) return null;

    return this.buildStationSnapshot(station);
  }


  public getLineSnapshot(shopName: string, lineName: string): LineSnapshot | null {
    const line = this.getLineByShop(shopName, lineName);
    if (!line) return null;

    return this.buildLineSnapshot(line);
  }


  public getShopSnapshot(shopName: string): ShopSnapshot | null {
    const shop = this.shops.get(shopName);
    if (!shop) return null;

    return this.buildShopSnapshot(shop);
  }

  public getPlantSnapshot(): PlantSnapshot {
    const shopSnapshots: ShopSnapshot[] = [];
    let totalStations = 0;
    let totalOccupied = 0;
    let totalFree = 0;
    let totalStopped = 0;

    for (const shop of this.shops.values()) {
      const snapshot = this.buildShopSnapshot(shop);
      shopSnapshots.push(snapshot);
      totalStations += snapshot.totalStations;
      totalOccupied += snapshot.totalOccupied;
      totalFree += snapshot.totalFree;
      totalStopped += snapshot.totalStopped;
    }

    return {
      timestamp: Date.now(),
      shops: shopSnapshots,
      totalStations,
      totalOccupied,
      totalFree,
      totalStopped
    };
  }

  private buildStationSnapshot(station: IStation): StationSnapshot {
    return {
      id: station.id,
      shop: station.shop,
      line: station.line,
      index: station.index,
      taktMn: station.taktMn,
      taktSg: station.taktSg ?? station.taktMn * 60,
      isFirstStation: station.isFirstStation ?? false,
      isLastStation: station.isLastStation ?? false,
      occupied: station.occupied,
      currentCarId: station.currentCar?.id ?? null,
      currentCarSequenceNumber: station.currentCar?.sequenceNumber ?? null,
      isStopped: station.isStopped,
      stopReason: station.stopReason,
      startStop: station.startStop,
      finishStop: station.finishStop,
      stopId: station.stopId,
      isFirstCar: station.isFirstCar
    };
  }

  private buildLineSnapshot(line: ILine): LineSnapshot {
    const stations = line.stations;
    const len = stations.length;
    const stationSnapshots = new Array<StationSnapshot>(len);
    let occupiedCount = 0;
    let stoppedCount = 0;
    
    for (let i = 0; i < len; i++) {
      const s = stations[i];
      stationSnapshots[i] = this.buildStationSnapshot(s);
      if (s.occupied) occupiedCount++;
      if (s.isStopped) stoppedCount++;
    }

    return {
      id: `${line.shop}-${line.line}`,
      shop: line.shop,
      line: line.line,
      taktMn: line.taktMn,
      isFeederLine: line.isFeederLine ?? false,
      feedsToLine: line.feedsToLine,
      feedsToStation: line.feedsToStation,
      MTTR: line.MTTR,
      MTBF: line.MTBF,
      productionTimeMinutes: line.productionTimeMinutes,
      stationCount: len,
      occupiedCount,
      freeCount: len - occupiedCount,
      stoppedCount,
      stations: stationSnapshots
    };
  }

  private buildShopSnapshot(shop: IShop): ShopSnapshot {
    let lines: ILine[];
    
    if (shop instanceof Shop) {
      lines = shop.getAllLines();
    } else if (shop.lines instanceof Map) {
      lines = Array.from(shop.lines.values() as IterableIterator<ILine>);
    } else {
      lines = Object.values(shop.lines as Record<string, ILine>);
    }
    
    const linesLen = lines.length;
    const lineSnapshots = new Array<LineSnapshot>(linesLen);
    let totalStations = 0;
    let totalOccupied = 0;
    let totalStopped = 0;

    for (let i = 0; i < linesLen; i++) {
      const lineSnap = this.buildLineSnapshot(lines[i]);
      lineSnapshots[i] = lineSnap;
      totalStations += lineSnap.stationCount;
      totalOccupied += lineSnap.occupiedCount;
      totalStopped += lineSnap.stoppedCount;
    }

    return {
      name: shop.name,
      bufferCapacity: shop.bufferCapacity ?? 0,
      reworkBuffer: shop.reworkBuffer ?? 0,
      lineCount: linesLen,
      totalStations,
      totalOccupied,
      totalFree: totalStations - totalOccupied,
      totalStopped,
      lines: lineSnapshots
    };
  }
}
