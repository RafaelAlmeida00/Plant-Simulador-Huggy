import { log } from "console";
import { CarService } from "../domain/services/CarService";
import { MTTRMTBFService } from "../domain/services/MTTRMTBFService";
import { OEEService } from "../domain/services/OEEService";
import { PlantService } from "../domain/services/PlantService";
import { StopLineService } from "../domain/services/StopLineService";
import { logger } from "../utils/logger";
import { TickEvent, SimulationCallbacks, IStation, ILine, IBuffer, ICar, ICarTrace, StationLocation, IStopLine, OEECalculationInput, MTTRMTBFData, OEEData, IShop } from "../utils/shared";
import { BufferService } from "../domain/services/BufferService";
import { getActiveFlowPlant } from "../domain/factories/plantFactory";

export class SimulationFlow {
    private event: TickEvent;
    private callbacks?: SimulationCallbacks;
    private alternateReworkPull: boolean = false;
    private flowPlant = getActiveFlowPlant();
    private reworkTimeMs: number = (this.flowPlant.Rework_Time || 60) * 60000;
    private carService: CarService;
    private stopService: StopLineService;
    private bufferService: BufferService;
    private plantService: PlantService;
    private oeeService: OEEService;
    private mttrmtbfService: MTTRMTBFService;
    private prevSimulatedTimestamp: number = 0;
    private processedShiftEnds: Set<string> = new Set();
    private processedShiftStarts: Set<string> = new Set();

    constructor(context: any) {
        this.carService = context.carService;
        this.stopService = context.stopService;
        this.bufferService = context.bufferService;
        this.plantService = context.plantService;
        this.oeeService = context.oeeService;
        this.mttrmtbfService = context.mttrmtbfService;
        this.event = context.event;
        this.callbacks = context.callbacks;
    }

    public updateEvent(event: TickEvent): void {
        this.event = event;
    }

    public execute(): void {
        this.updateStopsLines();
        logger().debug(`Stops updated for tick ${this.event.tickNumber}`);
        this.createCarsAndParts();
        logger().debug(`Cars and parts created for tick ${this.event.tickNumber}`);
        this.moveCarsThroughStations();
        logger().debug(`Cars moved through stations for tick ${this.event.tickNumber}`);
        this.moveCarsThroughBuffers();
        logger().debug(`Cars moved through buffers for tick ${this.event.tickNumber}`);
        this.checkProductionDayEnd();
        logger().debug(`Production day end checked for tick ${this.event.tickNumber}`);

        this.prevSimulatedTimestamp = this.event.simulatedTimestamp;
    }

    private updateStopsLines(): void {
        const stops = this.stopService.getStops();
        logger().debug(`Checking stops. Total loaded: ${stops.size}`);

        stops.forEach(stop => {
            if (this.shouldEndStop(stop)) {
                this.endScheduledStop(stop);
            }
            if (this.shouldStartStop(stop)) {
                this.startScheduledStop(stop);
            }
        });
    }

    private shouldEndStop(stop: IStopLine): boolean {
        if (stop.status !== "IN_PROGRESS") return false;
        if (typeof stop.endTime !== "number") return false;
        return stop.endTime <= this.event.simulatedTimestamp;
    }

    private shouldStartStop(stop: IStopLine): boolean {
        if (stop.status !== "PLANNED") return false;
        const startTimePassed = stop.startTime <= this.event.simulatedTimestamp;
        const notProcessedBefore = this.prevSimulatedTimestamp === 0 ||
            stop.startTime > this.prevSimulatedTimestamp;

        return startTimePassed && notProcessedBefore;
    }

    private endScheduledStop(stop: IStopLine): void {
        if (stop.station === "ALL") {
            const stations = this.plantService.getStationsOfLine(stop.shop, stop.line);
            this.stopService.endStop(stop.id, this.event.simulatedTimestamp);
            stations.forEach(station => {
                this.plantService.clearStopStation(station.id);
            });
            this.notifyStopEnded(stop);
        } else {
            this.stopService.endStop(stop.id, this.event.simulatedTimestamp);
            this.notifyStopEnded(stop);
        }
    }

    private startScheduledStop(stop: IStopLine): void {
        if (stop.station === "ALL") {
            const stations = this.plantService.getStationsOfLine(stop.shop, stop.line);
            if (stop.type === "RANDOM_GENERATE" && this.shouldRescheduleStop(stations)) {
                this.stopService.reescheduleStop(stop.id);
                return;
            }
            this.stopService.activeStopsInManyStation(String(stop.id), this.event.simulatedTimestamp, stations);
            this.notifyStopStarted(stop);
        } else {
            const station = this.plantService.getById("station", stop.station) as IStation;
            if (stop.type === "RANDOM_GENERATE" && this.shouldRescheduleStop([station])) {
                this.stopService.reescheduleStop(stop.id);
                return;
            }
            this.stopService.activeStopsInManyStation(String(stop.id), this.event.simulatedTimestamp, [station]);
            this.notifyStopStarted(stop);
        }
    }

    private shouldRescheduleStop(stations: IStation[]): boolean {
        return stations.some(station => station.occupied || station.isStopped);
    }

    private notifyStopEnded(stop: IStopLine): void {
        if (this.callbacks?.onStopEndedStopLine) {
            this.callbacks.onStopEndedStopLine(stop);
        }
    }

    private notifyStopStarted(stop: IStopLine): void {
        if (this.callbacks?.onStopStartedStopLine) {
            this.callbacks.onStopStartedStopLine(stop);
        }
    }

    private moveCarsThroughStations(): void {
        const stations = Array.from(this.plantService.getStations())
            .map(([_, station]) => station)
            .filter(station => station != null)
            .reverse() as IStation[];

        stations.forEach(station => {
            if (!station) {
                logger().warn(`Invalid station found, skipping`);
                return;
            }

            if (!station.occupied) {
                this.handleEmptyStation(station);
                return;
            }

            if (stations.indexOf(station) === 0 && station.isLastStation && station.occupied) {
                const car = station.currentCar as ICar;
                this.carService.completeCar(car.id, this.event.simulatedTimestamp, station.id);
                const location: StationLocation = { shop: station.shop, line: station.line, station: station.id };
                if (this.callbacks?.onCarCompleted) {
                    this.callbacks.onCarCompleted(
                        car.id,
                        location,
                        ((car.completedAt || this.event.simulatedTimestamp) - car.createdAt),
                        this.event.simulatedTimestamp
                    );
                }
            }

            this.handleOccupiedStation(station);
        });
    }

    private handleEmptyStation(station: IStation): void {
        if (!this.hasBlockingStop(station) && !station.isFirstCar && !station.isFirstStation) {
            this.startPropagationStop(station, "PREV_EMPTY");
            logger().debug(`Started PREV_EMPTY at empty station ${station.id}`);
        }
    }

    private handleOccupiedStation(station: IStation): void {
        const car = station.currentCar as ICar;
        if (!car) {
            logger().error(`Car not found at station ${station.id}`);
            return;
        }

        const trace = car.trace?.find(t => t.station === station.id);
        if (!trace) return;

        const taktExpired = typeof trace.enter === "number" &&
            (trace.enter + (station.taktMn * 60000)) <= this.event.simulatedTimestamp;

        if (!taktExpired) return;

        const line = this.plantService.getById("line", `${station.shop}-${station.line}`) as ILine;
        if (!line) {
            logger().error(`Line not found for station ${station.line}`);
            return;
        }

        const isStartStation = this.isStartStation(station);
        if (!isStartStation && this.shouldConsumePartsAtStation(line, station)) {
            const hasRequiredParts = this.checkAndConsumeRequiredParts(station, line, car);
            if (!hasRequiredParts) {
                logger().debug(`Station ${station.id} waiting for parts: car ${car.id} model ${car.model}`);
                return;
            }
        }

        if (station.isLastStation) {
            this.handleLastStation(station, car, trace);
            return;
        }

        const nextStation = this.plantService.getNextStationId(station.id) as IStation;
        if (!nextStation) {
            logger().warn(`No next station found for ${station.id}`);
            return;
        }

        if (this.canMoveToNextStation(station, nextStation)) {
            this.moveCarToStation(station, nextStation, car);
            this.endPropagationStops(station, nextStation);
            this.notifyCarMoved(car, station, nextStation);
        } else {
            this.handleBlockedStation(station);
        }
    }

    private shouldConsumePartsAtStation(line: ILine, station: IStation): boolean {
        if (!line.requiredParts || line.requiredParts.length === 0) return false;
        const stationNumber = station.id.split('-')[2];
        return line.requiredParts.some(part => part.consumeStation === stationNumber);
    }

    private isStartStation(station: IStation): boolean {
        const startStations = this.plantService.getStartStations();
        const stationNumber = station.id.split('-')[2];
        return startStations.some(s =>
            s.station === stationNumber &&
            s.line === station.line &&
            s.shop === station.shop
        );
    }

    private hasBlockingStop(station: IStation): boolean {
        return station.isStopped &&
            station.stopReason !== "NEXT_FULL" &&
            station.stopReason !== "PREV_EMPTY";
    }

    private canMoveToNextStation(currentStation: IStation, nextStation: IStation): boolean {
        if (nextStation.occupied) return false;
        if (this.hasBlockingStop(nextStation)) {
            logger().debug(`Next station ${nextStation.id} blocked: ${nextStation.stopReason}`);
            return false;
        }
        if (this.hasBlockingStop(currentStation)) {
            logger().debug(`Current station ${currentStation.id} blocked: ${currentStation.stopReason}`);
            return false;
        }
        return true;
    }

    private handleBlockedStation(station: IStation): void {
        if (!this.hasBlockingStop(station) && !(station.isStopped && station.stopReason === "NEXT_FULL")) {
            this.startPropagationStop(station, "NEXT_FULL");
            logger().debug(`Started NEXT_FULL at ${station.id}`);
        }
    }

    private startPropagationStop(station: IStation, reason: "NEXT_FULL" | "PREV_EMPTY"): void {
        const stop = this.stopService.startStop(
            this.event.simulatedTimestamp,
            station.shop,
            station.line,
            station.id,
            reason,
            "PROPAGATION",
            "PROPAGATION"
        );
        this.notifyStopStarted(stop);
    }

    private checkAndConsumeRequiredParts(station: IStation, line: ILine, car: ICar): boolean {
        const stationNumber = station.id.split('-')[2];
        const gatheredBuffersData = this.gatherBufferDataForParts(line, stationNumber);

        if (gatheredBuffersData.length === 0) return true;

        const hasEnoughParts = gatheredBuffersData.every(data => {
            const amountInBuffer = data.counts[car.model] || 0;
            return amountInBuffer >= 1;
        });

        if (!hasEnoughParts) {
            const shouldFallback = this.shouldSendToReworkForMissingParts(gatheredBuffersData, car.model);
            if (shouldFallback) {
                const sent = this.sendCarToReworkForMissingParts(station, car);
                if (sent) {
                    return true; // Carro foi para rework, station liberada
                }
            }
            logger().debug(`Not enough parts for model ${car.model} at ${station.id}`);
            return false;
        }

        this.consumePartsFromBuffers(gatheredBuffersData, car.model, station.id);
        return true;
    }

    private gatherBufferDataForParts(line: ILine, stationNumber: string): Array<{ bufferId: string, counts: Record<string, number> }> {
        const gatheredBuffersData: Array<{ bufferId: string, counts: Record<string, number> }> = [];

        line.requiredParts?.forEach(partType => {
            if (partType.consumeStation !== stationNumber) return;

            const bufferData = this.getPartBufferData(line, partType.partType);
            if (bufferData) {
                gatheredBuffersData.push(bufferData);
            }
        });

        return gatheredBuffersData;
    }

    private consumePartsFromBuffers(buffersData: Array<{ bufferId: string, counts: Record<string, number> }>, model: string, stationId: string): void {
        buffersData.forEach(data => {
            const consumedPart = this.bufferService.consumePartByModel(data.bufferId, model, this.event.simulatedTimestamp, stationId);
            if (consumedPart) {
                logger().debug(`Consumed part ${consumedPart.id} model ${model} from buffer ${data.bufferId}`);
            }
        });
    }

    private shouldSendToReworkForMissingParts(
        buffersData: Array<{ bufferId: string, counts: Record<string, number> }>,
        model: string
    ): boolean {
        for (const data of buffersData) {
            const buffer = this.bufferService.getBuffer(data.bufferId);
            if (!buffer) continue;

            const hasModelPart = (data.counts[model] || 0) >= 1;
            const isBufferFull = buffer.status === "FULL";

            if (isBufferFull && !hasModelPart) {
                logger().warn(
                    `[FALLBACK] Buffer ${data.bufferId} is FULL but has no ${model} parts.`
                );
                return true;
            }
        }
        return false;
    }

    private sendCarToReworkForMissingParts(station: IStation, car: ICar): boolean {
        const reworkBufferId = `${station.shop}-REWORK`;
        const reworkBuffer = this.bufferService.getBuffer(reworkBufferId);

        if (!reworkBuffer) {
            logger().error(`[FALLBACK] Rework buffer not found: ${reworkBufferId}`);
            return false;
        }

        if (reworkBuffer.status === "FULL") {
            logger().warn(`[FALLBACK] Rework buffer ${reworkBufferId} is FULL, cannot send car ${car.id}`);
            return false;
        }

        car.hasDefect = true;
        car.inRework = true;
        car.reworkEnteredAt = this.event.simulatedTimestamp;
        car.defects = car.defects || [];
        car.defects.push(`MISSING_PARTS: ${car.model} at ${station.id}`);

        const success = this.carService.exitStationToBuffer(
            car.id,
            station.id,
            reworkBuffer.id,
            this.event.simulatedTimestamp
        );
        if (!success) {
            logger().error(`[FALLBACK] Failed to add car ${car.id} to rework buffer ${reworkBuffer.id}`);
            car.hasDefect = false;
            car.inRework = false;
            car.reworkEnteredAt = undefined;
            car.defects.pop();
            return false;
        }
        this.endPropagationStopsAtStation(station);

        logger().info(
            `[FALLBACK] Car ${car.id} (${car.model}) → rework buffer ${reworkBuffer.id} due to missing parts at ${station.id}`
        );

        if (this.callbacks?.onBufferIn) {
            this.callbacks.onBufferIn(
                car.id,
                reworkBuffer.id,
                { shop: station.shop, line: station.line },
                station.id,
                this.event.simulatedTimestamp
            );
        }

        return true;
    }

    private getPartBufferData(line: ILine, partType: string): { bufferId: string, counts: Record<string, number> } | null {
        const lineThatProducesPart = this.plantService.getLineThatProducePartType(line.shop, partType) as ILine;

        if (!lineThatProducesPart) {
            logger().error(`Line that produces part type ${partType} not found for shop ${line.shop}`);
            return null;
        }

        const bufferPartId = this.bufferService.findPartBuffer(
            lineThatProducesPart.shop,
            lineThatProducesPart.partType as string
        );

        if (!bufferPartId) {
            logger().error(`Buffer ID not found for part type ${partType}`);
            return null;
        }

        const bufferPart = this.bufferService.getBuffer(bufferPartId) as IBuffer;
        if (!bufferPart) {
            logger().error(`Buffer not found with id ${bufferPartId}`);
            return null;
        }

        const partsInBuffer = this.bufferService.getAllCarsByBuffer(bufferPart.id) as ICar[];
        const counts = partsInBuffer.reduce((acc, part) => {
            acc[part.model] = (acc[part.model] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return { bufferId: bufferPart.id, counts };
    }

    private moveCarToStation(currentStation: IStation, nextStation: IStation, car: ICar): void {
        this.carService.moveCarToNextStation(
            car.id,
            currentStation.id,
            nextStation.id,
            this.event.simulatedTimestamp
        );
        logger().info(`✓ Car ${car.id} moved: ${currentStation.id} → ${nextStation.id}`);
    }

    private endPropagationStops(currentStation: IStation, nextStation: IStation): void {
        if (currentStation.isStopped &&
            (currentStation.stopReason === "NEXT_FULL" || currentStation.stopReason === "PREV_EMPTY") &&
            currentStation.stopId) {
            this.stopService.endStop(Number(currentStation.stopId), this.event.simulatedTimestamp);
            const stop = this.stopService.getStopById(Number(currentStation.stopId)) as IStopLine;
            if (!stop) {
                logger().error(`Stop not found with id ${currentStation.stopId}`);
                return
            }
            this.notifyStopEnded(stop);
            logger().debug(`✓ Ended ${currentStation.stopReason} at ${currentStation.id}`);
        }

        if (nextStation.isStopped &&
            nextStation.stopReason === "PREV_EMPTY" &&
            !nextStation.isFirstCar &&
            nextStation.stopId) {
            this.stopService.endStop(Number(nextStation.stopId), this.event.simulatedTimestamp);
            const stop = this.stopService.getStopById(Number(nextStation.stopId)) as IStopLine;
            if (!stop) {
                logger().error(`Stop not found with id ${nextStation.stopId}`);
                return
            }
            this.notifyStopEnded(stop);
            logger().debug(`✓ Ended PREV_EMPTY at ${nextStation.id}`);
        }
    }

    private createCarsAndParts(): void {
        const startStations = this.plantService.getStartStations();
        if (startStations.length === 0) {
            logger().debug("No start stations found");
            return;
        }

        startStations.forEach(startStation => {
            const stationId = `${startStation.shop}-${startStation.line}-${startStation.station}`;
            const station = this.plantService.getById("station", stationId) as IStation;
            const line = this.plantService.getById("line", `${startStation.shop}-${startStation.line}`) as ILine;

            if (!station || !line) {
                logger().error(`Station or line not found: ${stationId}`);
                return;
            }

            if (station.occupied || this.hasBlockingStop(station)) {
                return;
            }

            this.createCarOrPartAtStation(station, line, startStation.station);
        });
    }

    private createCarOrPartAtStation(station: IStation, line: ILine, stationNumber: string): void {
        if (line.requiredParts && line.requiredParts.length > 0) {
            this.handleLineWithRequiredParts(station, line, stationNumber);
            return;
        }

        if (line.partType) {
            this.createPart(station, line, null);
        } else {
            this.createCar(station, null);
        }
    }

    private handleLineWithRequiredParts(station: IStation, line: ILine, stationNumber: string): void {
        const gatheredBuffersData = this.gatherBufferDataForParts(line, stationNumber);

        if (gatheredBuffersData.length === 0) {
            if (line.partType) {
                this.createPart(station, line, null);
            } else {
                this.createCar(station, null);
            }
            return;
        }

        const approvedModels = this.getApprovedModels(gatheredBuffersData);

        if (approvedModels.length === 0) {
            logger().debug(`No approved models for station ${station.id}`);
            return;
        }

        const selectedModel = approvedModels[0];
        this.consumePartsFromBuffers(gatheredBuffersData, selectedModel, station.id);

        if (line.partType) {
            this.createPart(station, line, selectedModel);
        } else {
            this.createCar(station, selectedModel);
        }
    }

    private getApprovedModels(gatheredBuffersData: Array<{ bufferId: string, counts: Record<string, number> }>): string[] {
        const allUniqueModels = new Set<string>();
        gatheredBuffersData.forEach(data => {
            Object.keys(data.counts).forEach(model => allUniqueModels.add(model));
        });

        const approvedModels: string[] = [];
        allUniqueModels.forEach(model => {
            const isReady = gatheredBuffersData.every(data => {
                const amountInBuffer = data.counts[model] || 0;
                return amountInBuffer >= 1;
            });
            if (isReady) approvedModels.push(model);
        });

        return approvedModels;
    }

    private createCar(station: IStation, model: string | null): void {
        const newCar = model
            ? this.carService.createCarWithModel(this.event.simulatedTimestamp, model)
            : this.carService.createRandomCar(this.event.simulatedTimestamp);

        this.carService.moverCarToFirstStation(newCar.id, station.id, this.event.simulatedTimestamp);
        logger().debug(`Created car ${model ? `model ${model}` : 'random'} at ${station.id}`);

        if (this.callbacks?.onCarCreated) {
            this.callbacks.onCarCreated(newCar.id, station.shop, station.line, station.id, this.event.simulatedTimestamp);
        }
    }

    private createPart(station: IStation, line: ILine, model: string | null): void {
        const newPart = this.carService.createPart(
            this.event.simulatedTimestamp,
            line.partType as string,
            model as any
        );

        this.carService.moverCarToFirstStation(newPart.id, station.id, this.event.simulatedTimestamp);
        logger().debug(`Created part ${line.partType} ${model ? `model ${model}` : ''} at ${station.id}`);

        if (this.callbacks?.onCarCreated) {
            this.callbacks.onCarCreated(newPart.id, station.shop, station.line, station.id, this.event.simulatedTimestamp);
        }
    }

    private moveCarsThroughBuffers(): void {
        const stations = this.plantService.getStations();
        const startStations = this.plantService.getStartStations();

        stations.forEach(station => {
            if (this.shouldPullFromBuffer(station, startStations)) {
                this.pullCarFromBufferToStation(station);
            }
        });
    }

    private handleLastStation(station: IStation, car: ICar, trace: ICarTrace): void {
        if (this.hasBlockingStop(station)) {
            logger().debug(`Last station ${station.id} has blocking stop: ${station.stopReason}`);
            return;
        }

        const buffer = this.findBufferForLastStation(station);
        if (!buffer) {
            logger().error(`Buffer not found for last station ${station.id}`);
            return;
        }

        if (buffer.status === "FULL") {
            this.handleBlockedStation(station);
            return;
        }

        if (this.shouldSendToRework(station, car)) {
            this.sendCarToRework(station, car, buffer);
        } else {
            this.moveCarFromLastStationToBuffer(station, car, buffer);
        }
    }

    private shouldSendToRework(station: IStation, car: ICar): boolean {
        if (!car.hasDefect) return false;

        const line = this.plantService.getById("line", `${station.shop}-${station.line}`) as ILine;
        if (!line) return false;

        const linesOfShop = this.plantService.getLinesOfShop(station.shop);
        const isLastLineOfShop = linesOfShop[linesOfShop.length - 1]?.id === line.id;

        return isLastLineOfShop;
    }

    private sendCarToRework(station: IStation, car: ICar, normalBuffer: IBuffer): void {
        const reworkBufferId = `${station.shop}-REWORK`;
        const reworkBuffer = this.bufferService.getBuffer(reworkBufferId);

        if (!reworkBuffer) {
            this.moveCarFromLastStationToBuffer(station, car, normalBuffer);
            return;
        }

        if (reworkBuffer.status === "FULL") {
            this.handleBlockedStation(station);
            return;
        }

        const success = this.carService.exitStationToBuffer(
            car.id,
            station.id,
            reworkBuffer.id,
            this.event.simulatedTimestamp
        );
        if (!success) {
            logger().error(`Failed to add car ${car.id} to rework buffer ${reworkBuffer.id}`);
            return;
        }
        this.endPropagationStopsAtStation(station);

        logger().info(`✓ Car ${car.id} → rework buffer ${reworkBuffer.id} from last station ${station.id}`);

        if (this.callbacks?.onBufferIn) {
            this.callbacks.onBufferIn(
                car.id,
                reworkBuffer.id,
                { shop: station.shop, line: station.line },
                station.id,
                this.event.simulatedTimestamp
            );
        }
    }

    private findBufferForLastStation(station: IStation): IBuffer | undefined {
        const line = this.plantService.getById("line", `${station.shop}-${station.line}`) as ILine;
        if (!line) {
            logger().error(`Line not found for station ${station.id}`);
            return undefined;
        }

        const isPartLine = !!line.partType;
        const hasRoutes = line.routes && line.routes.length > 0;

        if (isPartLine && !hasRoutes) {
            if (line.buffers && line.buffers.length > 0) {
                const destShop = line.buffers[0].to.shop;
                const partBufferId = this.bufferService.findPartBuffer(destShop, line.partType as string);
                if (!partBufferId) {
                    logger().error(`Part Buffer not found for ${destShop} ${line.partType}`);
                    return undefined;
                }
                const partBuffer = this.bufferService.getBuffer(partBufferId);
                return partBuffer;
            }
            logger().error(`Part line ${line.id} has no buffer config`);
            return undefined;
        }

        const routeDestination = this.plantService.getRouteFromStation(station.id);
        if (routeDestination) {
            const buffer = this.bufferService.getBufferByFromTo(
                `${station.shop}-${station.line}`,
                `${routeDestination.shop}-${routeDestination.line}`
            );
            if (buffer) {
                return buffer;
            }
        }

        let nextLine = this.plantService.getNextLine(station.id) as ILine;
        let buffer: IBuffer | undefined;

        if (!nextLine) {
            const keysShops = this.plantService.getShopsKeys();
            for (const shop of keysShops) {
                if (shop === station.shop) continue;

                const linesOfShop = this.plantService.getLinesOfShop(shop);
                const firstLineOfShop = linesOfShop[0];

                buffer = this.bufferService.getBufferByFromTo(
                    `${station.shop}-${station.line}`,
                    `${shop}-${firstLineOfShop.line}`
                );

                if (buffer) break;
            }
        } else {
            buffer = this.bufferService.getBufferByFromTo(
                `${station.shop}-${station.line}`,
                `${nextLine.shop}-${nextLine.line}`
            );
        }

        return buffer;
    }

    private moveCarFromLastStationToBuffer(station: IStation, car: ICar, buffer: IBuffer): void {
        const success = this.carService.exitStationToBuffer(
            car.id,
            station.id,
            buffer.id,
            this.event.simulatedTimestamp
        );
        if (!success) {
            logger().error(`Failed to add car ${car.id} to buffer ${buffer.id}`);
            return;
        }
        this.endPropagationStopsAtStation(station);

        logger().info(`✓ Car ${car.id} → buffer ${buffer.id} from last station ${station.id}`);

        if (this.callbacks?.onBufferIn) {
            this.callbacks.onBufferIn(
                car.id,
                buffer.id,
                { shop: station.shop, line: station.line },
                station.id,
                this.event.simulatedTimestamp
            );
        }
    }

    private endPropagationStopsAtStation(station: IStation): void {
        if (station.isStopped &&
            (station.stopReason === "NEXT_FULL" || station.stopReason === "PREV_EMPTY") &&
            station.stopId) {
            this.stopService.endStop(Number(station.stopId), this.event.simulatedTimestamp);
            logger().debug(`✓ Ended ${station.stopReason} at ${station.id}`);
        }
    }

    private shouldPullFromBuffer(station: IStation, startStations: StationLocation[]): boolean {
        if (!station) return false;
        const line = this.plantService.getById("line", `${station.shop}-${station.line}`) as ILine;
        if (!line) {
            logger().error(`Line not found for station ${station.id}`);
            return false
        };
        if (station.id !== line.stations[0].id) {
            return false;
        }

        const isStartStation = startStations.some(s =>
            s.station === station.id.split('-')[2] &&
            s.line === station.line &&
            s.shop === station.shop
        );

        return !isStartStation;
    }

    private pullCarFromBufferToStation(station: IStation): void {
        if (station.occupied || this.hasBlockingStop(station)) return;

        const buffer = this.findBufferForFirstStation(station);
        if (!buffer) return;

        if (buffer.status === "EMPTY") return;

        const shouldUseRework = this.shouldPullFromRework(station, buffer);

        if (shouldUseRework) {
            this.pullFromReworkBuffer(station, buffer);
        } else {
            this.pullFromNormalBuffer(station, buffer);
        }
    }

    private shouldPullFromRework(station: IStation, normalBuffer: IBuffer): boolean {
        if (!this.isCrossShopBuffer(normalBuffer, station)) return false;

        const reworkBufferId = this.getReworkBufferIdForStation(station);
        if (!reworkBufferId) return false;

        const reworkBuffer = this.bufferService.getBuffer(reworkBufferId);
        if (!reworkBuffer || reworkBuffer.status === "EMPTY") return false;

        if (!this.alternateReworkPull) return false;

        const cars = this.bufferService.getAllCarsByBuffer(reworkBuffer.id) as ICar[];
        const readyCar = cars.find(car => this.isCarReadyForReworkExit(car, station));

        return !!readyCar;
    }

    private isCrossShopBuffer(buffer: IBuffer, station: IStation): boolean {
        const fromShop = buffer.from.split('-')[0];
        const toShop = buffer.to.split('-')[0];
        return fromShop !== toShop && toShop === station.shop;
    }

    private getReworkBufferIdForStation(station: IStation): string | null {
        const prevLine = this.findPreviousLineAcrossShops(station);
        if (!prevLine) return null;
        return `${prevLine.shop}-REWORK`;
    }

    private isCarReadyForReworkExit(car: ICar, targetStation: IStation): boolean {
        const prevLine = this.findPreviousLineAcrossShops(targetStation);
        if (!prevLine) return false;

        const shopLeadtime = car.shopLeadtimes.find(t => t.shop === prevLine.shop);
        if (!shopLeadtime || !shopLeadtime.exitedAt) return false;

        const timeSinceExit = this.event.simulatedTimestamp - shopLeadtime.exitedAt;
        return timeSinceExit >= this.reworkTimeMs;
    }

    private findPreviousLineAcrossShops(station: IStation): ILine | null {
        let prevLine = this.plantService.getPrevLine(station.id) as ILine;

        if (!prevLine) {
            const keysShops = this.plantService.getShopsKeys();
            for (const shop of keysShops) {
                if (shop === station.shop) continue;

                const linesOfShop = this.plantService.getLinesOfShop(shop);
                const lastLineOfShop = linesOfShop[linesOfShop.length - 1];

                const buffer = this.bufferService.getBufferByFromTo(
                    `${shop}-${lastLineOfShop.line}`,
                    `${station.shop}-${station.line}`
                );

                if (buffer) {
                    prevLine = this.plantService.getById("line", `${shop}-${lastLineOfShop.line}`) as ILine;
                    break;
                }
            }
        }

        return prevLine;
    }

    private pullFromReworkBuffer(station: IStation, normalBuffer: IBuffer): void {
        const reworkBufferId = this.getReworkBufferIdForStation(station);
        if (!reworkBufferId) {
            this.pullFromNormalBuffer(station, normalBuffer);
            return;
        }

        const reworkBuffer = this.bufferService.getBuffer(reworkBufferId);
        if (!reworkBuffer) {
            this.pullFromNormalBuffer(station, normalBuffer);
            return;
        }

        const cars = this.bufferService.getAllCarsByBuffer(reworkBuffer.id) as ICar[];
        const readyCar = cars.find(car => this.isCarReadyForReworkExit(car, station));

        if (!readyCar) {
            this.alternateReworkPull = !this.alternateReworkPull;
            this.pullFromNormalBuffer(station, normalBuffer);
            return;
        }

        const car = this.carService.enterStationFromBuffer(
            reworkBuffer.id,
            readyCar.id,
            station.id,
            this.event.simulatedTimestamp
        );
        if (!car) {
            this.alternateReworkPull = !this.alternateReworkPull;
            this.pullFromNormalBuffer(station, normalBuffer);
            return;
        }

        this.alternateReworkPull = !this.alternateReworkPull;

        logger().info(`✓ Car ${car.id} → station ${station.id} from rework buffer ${reworkBuffer.id}`);

        if (this.callbacks?.onCarMoved) {
            this.callbacks.onCarMoved(
                car.id,
                { shop: reworkBuffer.from.split('-')[0], line: reworkBuffer.from.split('-')[1], station: "buffer" },
                { shop: station.shop, line: station.line, station: station.id },
                this.event.simulatedTimestamp
            );
        }
    }

    private pullFromNormalBuffer(station: IStation, buffer: IBuffer): void {
        const car = this.carService.enterStationFromBuffer(
            buffer.id,
            null,
            station.id,
            this.event.simulatedTimestamp
        );
        if (!car) {
            logger().debug(`No car available in buffer ${buffer.id} for station ${station.id}`);
            return;
        }

        if (this.isCrossShopBuffer(buffer, station)) {
            this.alternateReworkPull = !this.alternateReworkPull;
        }

        logger().info(`✓ Car ${car.id} → station ${station.id} from buffer ${buffer.id}`);

        if (this.callbacks?.onCarMoved) {
            this.callbacks.onCarMoved(
                car.id,
                { shop: buffer.from.split('-')[0], line: buffer.from.split('-')[1], station: "buffer" },
                { shop: station.shop, line: station.line, station: station.id },
                this.event.simulatedTimestamp
            );
        }
    }

    private findBufferForFirstStation(station: IStation): IBuffer | undefined {
        const currentLine = this.plantService.getById("line", `${station.shop}-${station.line}`) as ILine;
        if (!currentLine) {
            logger().debug(`Current line not found for station ${station.id}`);
            return undefined;
        }

        const stationNumber = station.id.split('-')[2]; // Extract station number from id
        const sourceLines = this.plantService.getLinesThatRouteToStation(
            station.shop,
            station.line,
            stationNumber
        );

        if (sourceLines.length > 0) {
            const sourceLine = sourceLines[0]; // Use first matching source line
            const buffer = this.bufferService.getBufferByFromTo(
                `${sourceLine.shop}-${sourceLine.line}`,
                `${station.shop}-${station.line}`
            );
            if (buffer) {
                return buffer;
            }
        }

        let prevLine = this.plantService.getPrevLine(station.id) as ILine;
        let buffer: IBuffer | undefined;

        if (!prevLine) {
            const keysShops = this.plantService.getShopsKeys();
            for (const shop of keysShops) {
                if (shop === station.shop) continue;

                const linesOfShop = this.plantService.getLinesOfShop(shop);
                const lastLineOfShop = linesOfShop[linesOfShop.length - 1];

                buffer = this.bufferService.getBufferByFromTo(
                    `${shop}-${lastLineOfShop.line}`,
                    `${station.shop}-${station.line}`
                );

                if (buffer) {
                    prevLine = this.plantService.getById("line", `${shop}-${lastLineOfShop.line}`) as ILine;
                    break;
                }
            }
        } else {
            buffer = this.bufferService.getBufferByFromTo(
                `${prevLine.shop}-${prevLine.line}`,
                `${station.shop}-${station.line}`
            );
        }

        return buffer;
    }

    private notifyCarMoved(car: ICar, from: IStation, to: IStation): void {
        if (this.callbacks?.onCarMoved) {
            this.callbacks.onCarMoved(
                car.id,
                { shop: from.shop, line: from.line, station: from.id },
                { shop: to.shop, line: to.line, station: to.id },
                this.event.simulatedTimestamp
            );
        }
    }

    private calculateOEE(isShiftEnd: boolean): void {
        const lines = Array.from(this.plantService.getLines());
        const shops = Array.from(this.plantService.getShops());

        const productionTimeByShop = new Map<string, { total: number; count: number }>();

        for (const [_, line] of lines) {
            const productionTimeMinutes = line.productionTimeMinutes ?? 0;
            const lastStation = line.stations[line.stations.length - 1];
            const shop = this.plantService.getById("shop", line.shop) as IShop;

            const shopData = productionTimeByShop.get(line.shop) || { total: 0, count: 0 };
            shopData.total += productionTimeMinutes;
            shopData.count += 1;
            productionTimeByShop.set(line.shop, shopData);

            const lineInput: OEECalculationInput = {
                shop: shop,
                line: line,
                productionTimeMinutes: productionTimeMinutes,
                taktTimeMinutes: line.taktMn,
                simulatedTimestamp: this.event.simulatedTimestamp,
                shiftStart: line.takt.shiftStart,
                shiftEnd: line.takt.shiftEnd,
                lastStationId: lastStation?.id ?? ""
            };

            const lineOEE: OEEData = this.oeeService.calculateLineOEE(lineInput, true);
            this.callbacks?.onOEECalculated(lineOEE);
            if (isShiftEnd) {
                this.callbacks?.onOEEShiftEnd(lineOEE);
            }
        }

        for (const [_, shop] of shops) {
            const shopLines = this.plantService.getLinesOfShop(shop.name);
            if (shopLines.length === 0) continue;

            const shopData = productionTimeByShop.get(shop.name);
            const avgProductionTime = shopData ? shopData.total / shopData.count : 0;

            let totalTaktMn = 0;
            let firstLine: ILine | null = null;
            for (const line of shopLines) {
                totalTaktMn += line.taktMn;
                if (!firstLine) firstLine = line;
            }
            const avgTaktMn = totalTaktMn / shopLines.length;

            const shopInput: OEECalculationInput = {
                shop: shop,
                line: "ALL",
                productionTimeMinutes: avgProductionTime,
                taktTimeMinutes: avgTaktMn,
                simulatedTimestamp: this.event.simulatedTimestamp,
                shiftStart: firstLine?.takt.shiftStart ?? "07:00",
                shiftEnd: firstLine?.takt.shiftEnd ?? "23:48",
                lastStationId: ""
            };

            const shopOEE: OEEData = this.oeeService.calculateShopOEE(shopInput, true);
            this.callbacks?.onOEECalculated(shopOEE);
            if (isShiftEnd) {
                this.callbacks?.onOEEShiftEnd(shopOEE);
            }
        }
    }

    private calculateMTTRMTBF(): void {
        const lines = Array.from(this.plantService.getLines());
        const shops = Array.from(this.plantService.getShops());
        const allStops = Array.from(this.stopService.getStops().values());

        // Build stop index ONCE for O(1) lookups - optimizes from O(n²) to O(n)
        const stopIndex = this.mttrmtbfService.buildStopIndex(allStops);

        const shopResults = new Map<string, MTTRMTBFData[]>();

        for (const [_, line] of lines) {
            const productionTimeMinutes = line.productionTimeMinutes ?? 0;
            const stationMTTRMTBFData: MTTRMTBFData[] = [];

            for (const station of line.stations) {
                // Get pre-filtered stops from index - O(1) instead of O(n)
                const stationStops = this.mttrmtbfService.getStopsForStation(
                    stopIndex,
                    station.shop,
                    station.line,
                    station.id
                );

                // Use optimized calculation with pre-filtered stops
                const stationData: MTTRMTBFData = this.mttrmtbfService.calculateStationMTTRMTBFOptimized(
                    station.shop,
                    station.line,
                    station.id,
                    productionTimeMinutes,
                    stationStops,
                    this.event.simulatedTimestamp
                );

                this.callbacks?.onMTTRMTBFCalculated(stationData);
                stationMTTRMTBFData.push(stationData);
            }

            const lineMTTRMTBF = this.mttrmtbfService.calculateLineMTTRMTBF(stationMTTRMTBFData, productionTimeMinutes);
            if (lineMTTRMTBF) {
                this.callbacks?.onMTTRMTBFCalculated(lineMTTRMTBF);
                const shopLineData = shopResults.get(line.shop) || [];
                shopLineData.push(lineMTTRMTBF);
                shopResults.set(line.shop, shopLineData);
            }
        }

        for (const [_, shop] of shops) {
            const shopLineData = shopResults.get(shop.name);
            if (!shopLineData || shopLineData.length === 0) continue;

            const shopMTTRMTBF = this.mttrmtbfService.calculateShopMTTRMTBF(shopLineData);
            this.callbacks?.onMTTRMTBFCalculated(shopMTTRMTBF);
        }
    }


    private checkProductionDayEnd(): void {
        const lines = Array.from(this.plantService.getLines());

        const simulatedDate = new Date(this.event.simulatedTimestamp);
        const todayBaseTimestamp = Date.UTC(
            simulatedDate.getUTCFullYear(),
            simulatedDate.getUTCMonth(),
            simulatedDate.getUTCDate(),
            0, 0, 0, 0
        );

        const dayKey = `${simulatedDate.getUTCFullYear()}-${String(simulatedDate.getUTCMonth() + 1).padStart(2, '0')}-${String(simulatedDate.getUTCDate()).padStart(2, '0')}`;

        for (const [_, line] of lines) {
            const startHour = parseInt(line.takt.shiftStart.substring(0, 2), 10);
            const startMinute = parseInt(line.takt.shiftStart.substring(3, 5), 10);
            const endHour = parseInt(line.takt.shiftEnd.substring(0, 2), 10);
            const endMinute = parseInt(line.takt.shiftEnd.substring(3, 5), 10);

            const shiftEndTimestamp = todayBaseTimestamp + endHour * 3600000 + endMinute * 60000;
            const shiftStartTimestamp = todayBaseTimestamp + startHour * 3600000 + startMinute * 60000;

            const shiftEndKey = `${line.id}-${dayKey}-end`;
            const shiftStartKey = `${line.id}-${dayKey}-start`;

            const shiftEndPassedInRange = this.isTimestampInRange(shiftEndTimestamp);
            if (shiftEndPassedInRange && !this.processedShiftEnds.has(shiftEndKey)) {
                this.processedShiftEnds.add(shiftEndKey);
                logger().info(`Shift end detected for line ${line.id} at ${new Date(shiftEndTimestamp).toISOString()}`);
                this.calculateOEE(true);
                this.calculateMTTRMTBF();
                 logger().info(`OEE and MTTR/MTBF calculated for Shift End`);
            }

            const shiftStartPassedInRange = this.isTimestampInRange(shiftStartTimestamp);
            if (shiftStartPassedInRange && !this.processedShiftStarts.has(shiftStartKey)) {
                this.processedShiftStarts.add(shiftStartKey);
                logger().info(`Shift start detected for line ${line.id} at ${new Date(shiftStartTimestamp).toISOString()}`);
                this.stopService.resetAndStart();
                this.carService.cleanCarsCompleted();
            }
        }

        if (this.flowPlant.shifts) {
            const starProduction = this.flowPlant.shifts[0]?.start;
            const endProduction = this.flowPlant.shifts[this.flowPlant.shifts.length - 1]?.end;

            const startHour = parseInt(starProduction.substring(0, 2), 10);
            const startMinute = parseInt(starProduction.substring(3, 5), 10);
            const endHour = parseInt(endProduction.substring(0, 2), 10);
            const endMinute = parseInt(endProduction.substring(3, 5), 10);

            const shiftEndTimestamp = todayBaseTimestamp + endHour * 3600000 + endMinute * 60000;
            const shiftStartTimestamp = todayBaseTimestamp + startHour * 3600000 + startMinute * 60000;

            if (this.event.simulatedTimestamp >= shiftStartTimestamp && this.event.simulatedTimestamp <= shiftEndTimestamp) {
                this.calculateOEE(false);
                logger().info(`OEE calculated`);
            }

        }


        this.cleanOldTrackingEntries();
    }


    private isTimestampInRange(targetTimestamp: number): boolean {
        if (this.prevSimulatedTimestamp === 0) {
            return targetTimestamp <= this.event.simulatedTimestamp;
        }

        return targetTimestamp > this.prevSimulatedTimestamp &&
            targetTimestamp <= this.event.simulatedTimestamp;
    }

    private cleanOldTrackingEntries(): void {
        const currentDate = new Date(this.event.simulatedTimestamp);
        const twoDaysAgo = Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate() - 2,
            0, 0, 0, 0
        );

        const twoDaysAgoDate = new Date(twoDaysAgo);
        const oldDayKey = `${twoDaysAgoDate.getUTCFullYear()}-${String(twoDaysAgoDate.getUTCMonth() + 1).padStart(2, '0')}-${String(twoDaysAgoDate.getUTCDate()).padStart(2, '0')}`;

        for (const key of this.processedShiftEnds) {
            if (key.includes(oldDayKey)) {
                this.processedShiftEnds.delete(key);
            }
        }
        for (const key of this.processedShiftStarts) {
            if (key.includes(oldDayKey)) {
                this.processedShiftStarts.delete(key);
            }
        }
    }
}