// models/Shop.ts

import { ILine, IShop } from "../../utils/shared";

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
  
}
