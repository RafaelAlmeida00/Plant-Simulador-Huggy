import { ICar, ICarShopLeadtime, ICarTrace } from "../../utils/shared";

export class Car implements ICar {
    // Performance: Maximum trace entries to prevent unbounded memory growth
    public static readonly MAX_TRACE_LENGTH = 500;
    public static readonly MAX_LEADTIME_LENGTH = 100;

    public id: string;
    public sequenceNumber: number;
    public model: string;
    public color: string[];
    public createdAt: number;
    public completedAt?: number;
    public metadata?: Record<string, any>;
    public trace: ICarTrace[];
    public hasDefect: boolean;
    public defects: string[];
    public inRework: boolean;
    public reworkEnteredAt?: number;
    public reworkCompletedAt?: number;
    public shopLeadtimes: ICarShopLeadtime[];
    public totalLeadtimeMs?: number;
    // Part Line fields
    public isPart: boolean;
    public partName?: string;

    // Performance: Map for O(1) trace lookups by station
    private _traceByStation: Map<string, ICarTrace> = new Map();

    constructor(config: ICar) {
        this.id = config.id;
        this.sequenceNumber = config.sequenceNumber;
        this.model = config.model;
        this.color = config.color;
        this.createdAt = config.createdAt;
        this.hasDefect = config.hasDefect;
        this.defects = config.defects || [];
        this.trace = config.trace || [];
        this.shopLeadtimes = config.shopLeadtimes || [];
        this.inRework = config.inRework || false;
        this.isPart = config.isPart || false;
        this.partName = config.partName;

        // Build trace index from existing trace
        this._buildTraceIndex();
    }

    /**
     * Build trace index for O(1) lookups
     */
    private _buildTraceIndex(): void {
        this._traceByStation.clear();
        for (const t of this.trace) {
            if (t.station) {
                this._traceByStation.set(t.station, t);
            }
        }
    }

    /**
     * Get trace by station ID - O(1) instead of O(n)
     */
    public getTraceByStation(stationId: string): ICarTrace | undefined {
        return this._traceByStation.get(stationId);
    }

    /**
     * Add trace entry with automatic limit enforcement
     */
    public addTrace(trace: ICarTrace): void {
        // Trim oldest entries if exceeding limit
        if (this.trace.length >= Car.MAX_TRACE_LENGTH) {
            const toRemove = Math.floor(Car.MAX_TRACE_LENGTH * 0.1); // Remove 10%
            const removed = this.trace.splice(0, toRemove);
            // Remove from index
            for (const t of removed) {
                if (t.station) this._traceByStation.delete(t.station);
            }
        }

        this.trace.push(trace);
        if (trace.station) {
            this._traceByStation.set(trace.station, trace);
        }
    }

    /**
     * Update existing trace entry (sets leave time)
     */
    public updateTraceLeave(stationId: string, leaveTime: number): boolean {
        const trace = this._traceByStation.get(stationId);
        if (trace) {
            trace.leave = leaveTime;
            return true;
        }
        return false;
    }

    /**
     * Add shop leadtime entry with automatic limit enforcement
     */
    public addShopLeadtime(leadtime: ICarShopLeadtime): void {
        if (this.shopLeadtimes.length >= Car.MAX_LEADTIME_LENGTH) {
            const toRemove = Math.floor(Car.MAX_LEADTIME_LENGTH * 0.1);
            this.shopLeadtimes.splice(0, toRemove);
        }
        this.shopLeadtimes.push(leadtime);
    }

    /**
     * Find shop leadtime by shop (and optionally line)
     */
    public findShopLeadtime(shop: string, line?: string): ICarShopLeadtime | undefined {
        if (line) {
            return this.shopLeadtimes.find(t => t.shop === shop && t.line === line && !t.exitedAt);
        }
        return this.shopLeadtimes.find(t => t.shop === shop && !t.exitedAt && !t.line);
    }
}
