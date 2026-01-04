// models/Shop.ts
import { ILine } from "./Line";

export interface IShop {
  name: string;
  lines: Map<string, ILine> | Record<string, any>;
  bufferCapacity?: number;
  reworkBuffer?: number;
}

export class Shop implements IShop {
  public name: string;
  public lines: Map<string, ILine>;
  public bufferCapacity: number;
  public reworkBuffer: number;
  private _linesArray: ILine[] | null = null;

  constructor(config: IShop) {
    this.name = config.name;
    this.bufferCapacity = config.bufferCapacity ?? 0;    
    this.reworkBuffer = config.reworkBuffer ?? 0;

    if (config.lines instanceof Map) {
      this.lines = config.lines;
    } else {
      this.lines = new Map();
      const entries = Object.entries(config.lines);
      for (let i = 0; i < entries.length; i++) {
        this.lines.set(entries[i][0], entries[i][1]);
      }
    }
  }
  
  /** Retorna todas as linhas do shop em ordem */
  public getAllLines(): ILine[] {
    if (!this._linesArray) {
      this._linesArray = Array.from(this.lines.values());
    }
    return this._linesArray;
  }

  /** Retorna todas as linhas em ordem reversa */
  public getAllLinesReverse(): ILine[] {
    const lines = this.getAllLines();
    const len = lines.length;
    const result = new Array<ILine>(len);
    for (let i = 0; i < len; i++) {
      result[i] = lines[len - 1 - i];
    }
    return result;
  }

  /** Retorna uma linha pelo nome */
  public getLine(lineName: string): ILine | undefined {
    return this.lines.get(lineName);
  }

  /** Retorna o número total de linhas */
  public getLineCount(): number {
    return this.lines.size;
  }

  /** Verifica se uma linha existe no shop */
  public hasLine(lineName: string): boolean {
    return this.lines.has(lineName);
  }
}
