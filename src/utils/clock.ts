type TimeUnit = "h" | "m" | "s" | "ms";

const TO_MS: Record<TimeUnit, number> = {
    h: 3600000,
    m: 60000,
    s: 1000,
    ms: 1
};

export function convertTime(value: number, from: TimeUnit, to: TimeUnit): number {
    const inMs = value * TO_MS[from];
    return inMs / TO_MS[to];
}

export function timestampToTime(timestamp: number): { hours: number; minutes: number; seconds: number; ms: number } {
    const hours = Math.floor(timestamp / 3600000);
    const minutes = Math.floor((timestamp % 3600000) / 60000);
    const seconds = Math.floor((timestamp % 60000) / 1000);
    const ms = timestamp % 1000;
    return { hours, minutes, seconds, ms };
}

export function timestampToArray(timestamp: number): [number, number, number, number] {
    const { hours, minutes, seconds, ms } = timestampToTime(timestamp);
    return [hours, minutes, seconds, ms];
}

export function formatTimestamp(timestamp: number): string {
    const { hours, minutes, seconds } = timestampToTime(timestamp);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function timeToTimestamp(hours: number, minutes: number, seconds: number, ms: number = 0): number {
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}
