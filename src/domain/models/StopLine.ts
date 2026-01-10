import { IStopLine, StopCategory, StopSeverity, StopStatus, StopType } from "../../utils/shared";


export class StopLine implements IStopLine {
    public id: number;
    public shop: string;
    public line: string;
    public station: string;
    public reason: string;
    public startTime: number;
    public endTime: number | undefined;
    public status: StopStatus;
    public severity?: StopSeverity | null;
    public type: StopType;
    public category: StopCategory;
    public durationMs?: number;

    constructor(config: IStopLine) {
        this.id = config.id;
        this.shop = config.shop;
        this.line = config.line;
        this.station = config.station;
        this.reason = config.reason;
        this.startTime = config.startTime;
        this.endTime = config.endTime;
        this.status = config.status;
        this.severity = config.severity;
        this.type = config.type;
        this.category = config.category;
        this.durationMs = config.durationMs;
    }

}