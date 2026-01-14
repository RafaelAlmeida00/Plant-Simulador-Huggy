// src/adapters/http/websocket/DeltaService.ts

/**
 * DeltaService - Computes granular hierarchical deltas for WebSocket emissions
 *
 * Tracks changes at EVERY level of nested objects:
 * - Root level (metadata fields)
 * - Shop level (each shop's fields)
 * - Line level (each line's fields)
 * - Station level (each station's fields)
 * - Car level (currentCar fields)
 *
 * Only sends fields that actually changed, with IDs at each level for client validation.
 */

export interface DeltaOperation {
    op: 'ADD' | 'UPDATE' | 'REMOVE';
    path: string;
    id: string;
    data?: any;
}

export interface DeltaResult {
    hasChanges: boolean;
    operations: DeltaOperation[];
    delta: any;  // Hierarchical delta object
    version: number;
    isFullUpdate: boolean;
}

// Hash cache structure for hierarchical tracking
interface HierarchicalCache {
    rootHash: string;
    rootFields: Record<string, any>;
    shops: Map<string, ShopCache>;
}

interface ShopCache {
    hash: string;
    fields: Record<string, any>;
    lines: Map<string, LineCache>;
}

interface LineCache {
    hash: string;
    fields: Record<string, any>;
    stations: Map<string, StationCache>;
}

interface StationCache {
    hash: string;
    fields: Record<string, any>;
    carCache: CarCache | null;
}

interface CarCache {
    hash: string;
    fields: Record<string, any>;
}

export class DeltaService {
    // Map: "channel:socketId" -> HierarchicalCache
    private stateCache: Map<string, HierarchicalCache> = new Map();

    // Map: "channel:socketId" -> version number
    private versionCounter: Map<string, number> = new Map();

    // Simple hash cache for non-hierarchical data (stops, buffers, cars arrays)
    private simpleCache: Map<string, Map<string, string>> = new Map();

    /**
     * Compute hierarchical delta for plantstate channel
     * Tracks changes at every nesting level
     */
    public computePlantStateDelta(
        channelKey: string,
        snapshot: any
    ): DeltaResult {
        const isFirstEmission = !this.stateCache.has(channelKey);
        const currentCache = this.stateCache.get(channelKey);

        // Build new cache and delta simultaneously
        const newCache: HierarchicalCache = {
            rootHash: '',
            rootFields: {},
            shops: new Map()
        };

        const delta: any = {};
        let hasChanges = false;

        // === Level 0: Root metadata fields ===
        const rootFields = ['timestamp', 'totalStations', 'totalOccupied', 'totalFree', 'totalStopped'];
        for (const field of rootFields) {
            const value = snapshot[field];
            newCache.rootFields[field] = value;

            if (!isFirstEmission && currentCache) {
                if (currentCache.rootFields[field] !== value) {
                    delta[field] = value;
                    hasChanges = true;
                }
            }
        }
        newCache.rootHash = this.hashObject(newCache.rootFields);

        // === Level 1: Shops ===
        const shops = snapshot.shops || [];
        const deltaShops: any[] = [];
        const currentShopIds = new Set<string>();

        for (const shop of shops) {
            const shopId = shop.name;
            currentShopIds.add(shopId);

            const shopResult = this.processShopDelta(
                shop,
                shopId,
                isFirstEmission,
                currentCache?.shops.get(shopId)
            );

            newCache.shops.set(shopId, shopResult.cache);

            if (shopResult.hasChanges || isFirstEmission) {
                deltaShops.push(shopResult.delta);
                hasChanges = true;
            }
        }

        // Detect removed shops
        if (currentCache) {
            for (const [shopId] of currentCache.shops) {
                if (!currentShopIds.has(shopId)) {
                    deltaShops.push({ id: shopId, _removed: true });
                    hasChanges = true;
                }
            }
        }

        if (deltaShops.length > 0) {
            delta.shops = deltaShops;
        }

        // Update cache
        this.stateCache.set(channelKey, newCache);

        // Increment version
        const version = (this.versionCounter.get(channelKey) || 0) + 1;
        this.versionCounter.set(channelKey, version);

        return {
            hasChanges: hasChanges || isFirstEmission,
            operations: [], // Legacy field, kept for compatibility
            delta: isFirstEmission ? snapshot : (hasChanges ? delta : {}),
            version,
            isFullUpdate: isFirstEmission
        };
    }

    /**
     * Process shop-level delta
     */
    private processShopDelta(
        shop: any,
        shopId: string,
        isFirstEmission: boolean,
        currentShopCache: ShopCache | undefined
    ): { cache: ShopCache; delta: any; hasChanges: boolean } {
        const newCache: ShopCache = {
            hash: '',
            fields: {},
            lines: new Map()
        };

        const delta: any = { id: shopId };  // ID always included
        let hasChanges = false;

        // Shop-level fields
        const shopFields = ['name', 'bufferCapacity', 'reworkBuffer'];
        for (const field of shopFields) {
            const value = shop[field];
            newCache.fields[field] = value;

            if (!isFirstEmission && currentShopCache) {
                if (currentShopCache.fields[field] !== value) {
                    delta[field] = value;
                    hasChanges = true;
                }
            }
        }
        newCache.hash = this.hashObject(newCache.fields);

        // === Level 2: Lines ===
        const lines = shop.lines || [];
        const deltaLines: any[] = [];
        const currentLineIds = new Set<string>();

        for (const line of lines) {
            const lineId = line.id || line.line;
            currentLineIds.add(lineId);

            const lineResult = this.processLineDelta(
                line,
                lineId,
                isFirstEmission,
                currentShopCache?.lines.get(lineId)
            );

            newCache.lines.set(lineId, lineResult.cache);

            if (lineResult.hasChanges || isFirstEmission) {
                deltaLines.push(lineResult.delta);
                hasChanges = true;
            }
        }

        // Detect removed lines
        if (currentShopCache) {
            for (const [lineId] of currentShopCache.lines) {
                if (!currentLineIds.has(lineId)) {
                    deltaLines.push({ id: lineId, _removed: true });
                    hasChanges = true;
                }
            }
        }

        if (deltaLines.length > 0) {
            delta.lines = deltaLines;
        }

        return { cache: newCache, delta, hasChanges };
    }

    /**
     * Process line-level delta
     */
    private processLineDelta(
        line: any,
        lineId: string,
        isFirstEmission: boolean,
        currentLineCache: LineCache | undefined
    ): { cache: LineCache; delta: any; hasChanges: boolean } {
        const newCache: LineCache = {
            hash: '',
            fields: {},
            stations: new Map()
        };

        const delta: any = { id: lineId };  // ID always included
        let hasChanges = false;

        // Line-level fields
        const lineFields = ['shop', 'line', 'taktMn', 'isFeederLine', 'partType'];
        for (const field of lineFields) {
            const value = line[field];
            newCache.fields[field] = value;

            if (!isFirstEmission && currentLineCache) {
                if (currentLineCache.fields[field] !== value) {
                    delta[field] = value;
                    hasChanges = true;
                }
            }
        }
        newCache.hash = this.hashObject(newCache.fields);

        // === Level 3: Stations ===
        const stations = line.stations || [];
        const deltaStations: any[] = [];
        const currentStationIds = new Set<string>();

        for (const station of stations) {
            const stationId = station.id;
            currentStationIds.add(stationId);

            const stationResult = this.processStationDelta(
                station,
                stationId,
                isFirstEmission,
                currentLineCache?.stations.get(stationId)
            );

            newCache.stations.set(stationId, stationResult.cache);

            if (stationResult.hasChanges || isFirstEmission) {
                deltaStations.push(stationResult.delta);
                hasChanges = true;
            }
        }

        // Detect removed stations
        if (currentLineCache) {
            for (const [stationId] of currentLineCache.stations) {
                if (!currentStationIds.has(stationId)) {
                    deltaStations.push({ id: stationId, _removed: true });
                    hasChanges = true;
                }
            }
        }

        if (deltaStations.length > 0) {
            delta.stations = deltaStations;
        }

        return { cache: newCache, delta, hasChanges };
    }

    /**
     * Process station-level delta
     */
    private processStationDelta(
        station: any,
        stationId: string,
        isFirstEmission: boolean,
        currentStationCache: StationCache | undefined
    ): { cache: StationCache; delta: any; hasChanges: boolean } {
        const newCache: StationCache = {
            hash: '',
            fields: {},
            carCache: null
        };

        const delta: any = { id: stationId };  // ID always included
        let hasChanges = false;

        // Station-level fields (excluding currentCar which is handled separately)
        const stationFields = [
            'index', 'shop', 'line', 'station', 'taktMn', 'taktSg',
            'isFirstStation', 'isLastStation', 'occupied', 'isStopped',
            'stopReason', 'stopId'
        ];

        for (const field of stationFields) {
            const value = station[field];
            newCache.fields[field] = value;

            if (!isFirstEmission && currentStationCache) {
                if (!this.isEqual(currentStationCache.fields[field], value)) {
                    delta[field] = value;
                    hasChanges = true;
                }
            }
        }
        newCache.hash = this.hashObject(newCache.fields);

        // === Level 4: CurrentCar ===
        const currentCar = station.currentCar;

        if (currentCar) {
            const carResult = this.processCarDelta(
                currentCar,
                isFirstEmission,
                currentStationCache?.carCache
            );

            newCache.carCache = carResult.cache;

            if (carResult.hasChanges || isFirstEmission) {
                delta.currentCar = carResult.delta;
                hasChanges = true;
            }
        } else if (currentStationCache?.carCache) {
            // Car was removed from station
            delta.currentCar = null;
            hasChanges = true;
        }

        return { cache: newCache, delta, hasChanges };
    }

    /**
     * Process car-level delta (currentCar within station)
     */
    private processCarDelta(
        car: any,
        isFirstEmission: boolean,
        currentCarCache: CarCache | null | undefined
    ): { cache: CarCache; delta: any; hasChanges: boolean } {
        const newCache: CarCache = {
            hash: '',
            fields: {}
        };

        const delta: any = { id: car.id };  // ID always included
        let hasChanges = false;

        // Car-level fields
        const carFields = [
            'sequenceNumber', 'model', 'color', 'createdAt', 'completedAt',
            'hasDefect', 'inRework', 'isPart', 'partName', 'traceCount'
        ];

        for (const field of carFields) {
            const value = car[field];
            newCache.fields[field] = value;

            if (!isFirstEmission && currentCarCache) {
                if (!this.isEqual(currentCarCache.fields[field], value)) {
                    delta[field] = value;
                    hasChanges = true;
                }
            }
        }

        // Handle currentLocation as nested object
        const currentLocation = car.currentLocation;
        newCache.fields.currentLocation = currentLocation;

        if (!isFirstEmission && currentCarCache) {
            const prevLocation = currentCarCache.fields.currentLocation;
            if (!this.isEqual(prevLocation, currentLocation)) {
                delta.currentLocation = currentLocation;
                hasChanges = true;
            }
        }

        // Check if this is a different car entirely
        if (!isFirstEmission && currentCarCache && currentCarCache.fields.id !== car.id) {
            // Different car - send all fields
            hasChanges = true;
            Object.assign(delta, car);
        }

        newCache.hash = this.hashObject(newCache.fields);

        return { cache: newCache, delta, hasChanges };
    }

    /**
     * Compute delta for stops channel (flat array)
     */
    public computeStopsDelta(
        channelKey: string,
        stopsData: any
    ): DeltaResult {
        const isFirstEmission = !this.simpleCache.has(channelKey);
        const currentHashes = this.simpleCache.get(channelKey) || new Map<string, string>();
        const newHashes = new Map<string, string>();

        // Handle different stops formats
        const stops = Array.isArray(stopsData) ? stopsData :
            (stopsData?.activeStops || stopsData?.data || []);

        const deltaItems: any[] = [];
        const currentIds = new Set<string>();

        for (const stop of stops) {
            const stopId = String(stop.id);
            currentIds.add(stopId);

            const hash = this.hashObject(stop);
            const prevHash = currentHashes.get(stopId);
            newHashes.set(stopId, hash);

            if (!prevHash) {
                // New stop
                deltaItems.push({ ...stop, _op: 'ADD' });
            } else if (hash !== prevHash) {
                // Changed stop - compute field-level delta
                const fieldDelta = this.computeFieldDelta(stop, stopId, channelKey + ':fields');
                deltaItems.push(fieldDelta);
            }
        }

        // Detect removed stops
        for (const [id] of currentHashes) {
            if (!currentIds.has(id)) {
                deltaItems.push({ id, _removed: true });
            }
        }

        this.simpleCache.set(channelKey, newHashes);
        const version = (this.versionCounter.get(channelKey) || 0) + 1;
        this.versionCounter.set(channelKey, version);

        const hasChanges = deltaItems.length > 0;

        return {
            hasChanges: hasChanges || isFirstEmission,
            operations: [],
            delta: isFirstEmission ? stopsData : (hasChanges ? { items: deltaItems } : {}),
            version,
            isFullUpdate: isFirstEmission
        };
    }

    /**
     * Compute delta for buffers channel (flat array)
     */
    public computeBuffersDelta(
        channelKey: string,
        buffersData: any[]
    ): DeltaResult {
        const isFirstEmission = !this.simpleCache.has(channelKey);
        const currentHashes = this.simpleCache.get(channelKey) || new Map<string, string>();
        const newHashes = new Map<string, string>();

        const deltaItems: any[] = [];
        const currentIds = new Set<string>();

        for (const buffer of buffersData) {
            const bufferId = buffer.id;
            currentIds.add(bufferId);

            const hash = this.hashObject(buffer);
            const prevHash = currentHashes.get(bufferId);
            newHashes.set(bufferId, hash);

            if (!prevHash) {
                deltaItems.push({ ...buffer, _op: 'ADD' });
            } else if (hash !== prevHash) {
                const fieldDelta = this.computeFieldDelta(buffer, bufferId, channelKey + ':fields');
                deltaItems.push(fieldDelta);
            }
        }

        for (const [id] of currentHashes) {
            if (!currentIds.has(id)) {
                deltaItems.push({ id, _removed: true });
            }
        }

        this.simpleCache.set(channelKey, newHashes);
        const version = (this.versionCounter.get(channelKey) || 0) + 1;
        this.versionCounter.set(channelKey, version);

        const hasChanges = deltaItems.length > 0;

        return {
            hasChanges: hasChanges || isFirstEmission,
            operations: [],
            delta: isFirstEmission ? buffersData : (hasChanges ? { items: deltaItems } : {}),
            version,
            isFullUpdate: isFirstEmission
        };
    }

    /**
     * Compute delta for cars channel (flat array)
     */
    public computeCarsDelta(
        channelKey: string,
        carsData: any[]
    ): DeltaResult {
        const isFirstEmission = !this.simpleCache.has(channelKey);
        const currentHashes = this.simpleCache.get(channelKey) || new Map<string, string>();
        const newHashes = new Map<string, string>();

        const deltaItems: any[] = [];
        const currentIds = new Set<string>();

        for (const car of carsData) {
            const carId = car.id;
            currentIds.add(carId);

            const hash = this.hashObject(car);
            const prevHash = currentHashes.get(carId);
            newHashes.set(carId, hash);

            if (!prevHash) {
                deltaItems.push({ ...car, _op: 'ADD' });
            } else if (hash !== prevHash) {
                const fieldDelta = this.computeFieldDelta(car, carId, channelKey + ':fields');
                deltaItems.push(fieldDelta);
            }
        }

        for (const [id] of currentHashes) {
            if (!currentIds.has(id)) {
                deltaItems.push({ id, _removed: true });
            }
        }

        this.simpleCache.set(channelKey, newHashes);
        const version = (this.versionCounter.get(channelKey) || 0) + 1;
        this.versionCounter.set(channelKey, version);

        const hasChanges = deltaItems.length > 0;

        return {
            hasChanges: hasChanges || isFirstEmission,
            operations: [],
            delta: isFirstEmission ? carsData : (hasChanges ? { items: deltaItems } : {}),
            version,
            isFullUpdate: isFirstEmission
        };
    }

    /**
     * Compute field-level delta for flat objects
     */
    private computeFieldDelta(obj: any, id: string, cacheKey: string): any {
        const fieldCacheKey = `${cacheKey}:${id}`;
        const prevFields = this.getFieldCache(fieldCacheKey);
        const delta: any = { id };

        for (const [key, value] of Object.entries(obj)) {
            if (key === 'id') continue;

            if (!this.isEqual(prevFields[key], value)) {
                delta[key] = value;
            }
        }

        // Update field cache
        this.setFieldCache(fieldCacheKey, obj);

        return delta;
    }

    // Field cache for flat objects
    private fieldCache: Map<string, Record<string, any>> = new Map();

    private getFieldCache(key: string): Record<string, any> {
        return this.fieldCache.get(key) || {};
    }

    private setFieldCache(key: string, fields: Record<string, any>): void {
        this.fieldCache.set(key, { ...fields });
    }

    /**
     * Clear all cached state for a socket (call on disconnect)
     */
    public clearSocket(socketId: string): void {
        const keysToDelete: string[] = [];

        for (const key of this.stateCache.keys()) {
            if (key.includes(`:${socketId}`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of this.simpleCache.keys()) {
            if (key.includes(`:${socketId}`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of this.fieldCache.keys()) {
            if (key.includes(`:${socketId}`)) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.stateCache.delete(key);
            this.simpleCache.delete(key);
            this.versionCounter.delete(key);
            this.fieldCache.delete(key);
        }
    }

    /**
     * Get current version for a channel/socket combination
     */
    public getVersion(channelKey: string): number {
        return this.versionCounter.get(channelKey) || 0;
    }

    /**
     * Force full update on next emission (e.g., after client reconnect)
     */
    public resetSocketChannel(channelKey: string): void {
        this.stateCache.delete(channelKey);
        this.simpleCache.delete(channelKey);
        this.versionCounter.delete(channelKey);

        // Clear related field caches
        for (const key of this.fieldCache.keys()) {
            if (key.startsWith(channelKey)) {
                this.fieldCache.delete(key);
            }
        }
    }

    // =====================
    // Utility Methods
    // =====================

    /**
     * Simple hash for object comparison
     */
    private hashObject(obj: any): string {
        return JSON.stringify(obj);
    }

    /**
     * Deep equality check
     */
    private isEqual(a: any, b: any): boolean {
        if (a === b) return true;
        if (a === null || b === null) return a === b;
        if (a === undefined || b === undefined) return a === b;

        if (typeof a !== typeof b) return false;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.isEqual(a[i], b[i])) return false;
            }
            return true;
        }

        if (typeof a === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            for (const key of keysA) {
                if (!this.isEqual(a[key], b[key])) return false;
            }
            return true;
        }

        return false;
    }
}

// Export singleton instance
export const deltaService = new DeltaService();
