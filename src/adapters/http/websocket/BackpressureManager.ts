// src/adapters/http/websocket/BackpressureManager.ts

/**
 * BackpressureManager - Manages client state and flow control for WebSocket emissions
 *
 * Tracks pending acknowledgments per client/channel to prevent overwhelming slow clients.
 * Implements timeout-based recovery for unresponsive clients.
 */

export interface ClientState {
    socketId: string;
    lastAckVersion: Map<string, number>;    // channel -> last acknowledged version
    pendingPayload: Map<string, boolean>;   // channel -> has pending unacknowledged payload
    subscribedChannels: Set<string>;
    connectedAt: number;
}

export interface AckPayload {
    channel: string;
    version: number;
}

export class BackpressureManager {
    private clientStates: Map<string, ClientState> = new Map();
    private readonly ACK_TIMEOUT_MS: number;
    private readonly MAX_CLIENTS: number;

    constructor(ackTimeoutMs: number = 15000, maxClients: number = 1000) {
        this.ACK_TIMEOUT_MS = ackTimeoutMs;
        this.MAX_CLIENTS = maxClients;
    }

    /**
     * Register a new client connection
     */
    public registerClient(socketId: string): void {
        // Evict oldest client if at capacity
        if (this.clientStates.size >= this.MAX_CLIENTS) {
            this.evictOldestClient();
        }

        this.clientStates.set(socketId, {
            socketId,
            lastAckVersion: new Map(),
            pendingPayload: new Map(),
            subscribedChannels: new Set(),
            connectedAt: Date.now()
        });
    }

    /**
     * Unregister a client (call on disconnect)
     */
    public unregisterClient(socketId: string): void {
        this.clientStates.delete(socketId);
    }

    /**
     * Track channel subscription for a client
     */
    public subscribe(socketId: string, channel: string): void {
        const state = this.clientStates.get(socketId);
        if (state) {
            state.subscribedChannels.add(channel);
        }
    }

    /**
     * Remove channel subscription for a client
     */
    public unsubscribe(socketId: string, channel: string): void {
        const state = this.clientStates.get(socketId);
        if (state) {
            state.subscribedChannels.delete(channel);
            state.pendingPayload.delete(channel);
            state.lastAckVersion.delete(channel);
        }
    }

    /**
     * Check if we can emit to a client on a specific channel
     * Returns false if there's already a pending unacknowledged payload
     */
    public canEmit(socketId: string, channel: string): boolean {
        const state = this.clientStates.get(socketId);
        if (!state) return false;

        // Allow emission if no pending payload
        return !state.pendingPayload.get(channel);
    }

    /**
     * Mark that we've sent a payload and are waiting for ack
     */
    public markPending(socketId: string, channel: string): void {
        const state = this.clientStates.get(socketId);
        if (!state) return;

        state.pendingPayload.set(channel, true);

        // Set timeout to auto-reset pending flag if client doesn't ack
        setTimeout(() => {
            const s = this.clientStates.get(socketId);
            if (s && s.pendingPayload.get(channel)) {
                console.warn(`[BACKPRESSURE] Ack timeout for ${socketId} on ${channel}`);
                s.pendingPayload.set(channel, false);
            }
        }, this.ACK_TIMEOUT_MS);
    }

    /**
     * Handle acknowledgment from client
     */
    public handleAck(socketId: string, ack: AckPayload): void {
        const state = this.clientStates.get(socketId);
        if (!state) return;

        state.pendingPayload.set(ack.channel, false);
        state.lastAckVersion.set(ack.channel, ack.version);
    }

    /**
     * Get the last acknowledged version for a client/channel
     */
    public getLastAckVersion(socketId: string, channel: string): number {
        const state = this.clientStates.get(socketId);
        return state?.lastAckVersion.get(channel) || 0;
    }

    /**
     * Check if client has a specific channel subscription
     */
    public hasSubscription(socketId: string, channel: string): boolean {
        const state = this.clientStates.get(socketId);
        return state?.subscribedChannels.has(channel) || false;
    }

    /**
     * Get all subscribed channels for a client
     */
    public getSubscriptions(socketId: string): Set<string> {
        const state = this.clientStates.get(socketId);
        return state?.subscribedChannels || new Set();
    }

    /**
     * Get statistics about current state
     */
    public getStats(): {
        totalClients: number;
        clientsWithPending: number;
        totalSubscriptions: number;
    } {
        let clientsWithPending = 0;
        let totalSubscriptions = 0;

        for (const state of this.clientStates.values()) {
            if (Array.from(state.pendingPayload.values()).some(p => p)) {
                clientsWithPending++;
            }
            totalSubscriptions += state.subscribedChannels.size;
        }

        return {
            totalClients: this.clientStates.size,
            clientsWithPending,
            totalSubscriptions
        };
    }

    /**
     * Evict the oldest connected client (LRU eviction)
     */
    private evictOldestClient(): void {
        let oldestSocket: string | null = null;
        let oldestTime = Infinity;

        for (const [socketId, state] of this.clientStates) {
            if (state.connectedAt < oldestTime) {
                oldestTime = state.connectedAt;
                oldestSocket = socketId;
            }
        }

        if (oldestSocket) {
            console.warn(`[BACKPRESSURE] Evicting oldest client ${oldestSocket} due to capacity`);
            this.clientStates.delete(oldestSocket);
        }
    }

    /**
     * Reset pending state for a client/channel (e.g., on error)
     */
    public resetPending(socketId: string, channel: string): void {
        const state = this.clientStates.get(socketId);
        if (state) {
            state.pendingPayload.set(channel, false);
        }
    }

    /**
     * Check if a client is registered
     */
    public isRegistered(socketId: string): boolean {
        return this.clientStates.has(socketId);
    }
}

// Export singleton instance
export const backpressureManager = new BackpressureManager();
