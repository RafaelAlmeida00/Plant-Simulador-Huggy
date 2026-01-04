
export interface IStopLine {
    id: number;
    shop: string;
    line: string;
    station: string;
    reason: string;
    startTime: number;
    endTime: number;
    status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
    severity?: "LOW" | "MEDIUM" | "HIGH" | "PLANNED" | null;
    type: "MICRO" | "RANDOM_GENERATE" | "PROPAGATION" | "PLANNED";
    category: "NEXT_FULL" | "PREV_EMPTY" | "PROCESS_QUALITY_FAILURE" | "PLANNED_STOP" | "SHIFT_CHANGE" | "NIGHT_STOP" | "LUNCH" | "MEETING";
    durationMs?: number;
}

export class StopLine {
    public id: number;
    public shop: string;
    public line: string;
    public station: string;
    public reason: string;
    public startTime: number;
    public endTime: number;
    public status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
    public severity?: "LOW" | "MEDIUM" | "HIGH" | "PLANNED" | null;
    public type: "MICRO" | "RANDOM_GENERATE" | "PROPAGATION" | "PLANNED";
    public category: "NEXT_FULL" | "PREV_EMPTY" | "PROCESS_QUALITY_FAILURE" | "PLANNED_STOP" | "SHIFT_CHANGE" | "NIGHT_STOP" | "LUNCH" | "MEETING";
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