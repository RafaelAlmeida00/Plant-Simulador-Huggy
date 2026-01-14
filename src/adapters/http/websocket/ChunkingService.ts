// src/adapters/http/websocket/ChunkingService.ts

/**
 * ChunkingService - Handles splitting large payloads into smaller chunks
 *
 * Supports both byte-level chunking and logical object boundary chunking
 * for efficient streaming of large WebSocket messages.
 */

import { encode } from '@msgpack/msgpack';

export interface ChunkInfo {
    chunkId: string;
    chunkIndex: number;
    totalChunks: number;
    isLast: boolean;
}

export interface ChunkedPayload {
    data: any;
    chunkInfo: ChunkInfo;
}

export class ChunkingService {
    private readonly MAX_CHUNK_SIZE: number;
    private readonly MIN_CHUNK_SIZE: number;

    constructor(maxChunkSize: number = 64 * 1024, minChunkSize: number = 8 * 1024) {
        this.MAX_CHUNK_SIZE = maxChunkSize;  // 64KB default
        this.MIN_CHUNK_SIZE = minChunkSize;  // 8KB minimum
    }

    /**
     * Check if a payload should be chunked based on estimated size
     */
    public shouldChunk(data: any): boolean {
        try {
            const serialized = encode(data);
            return serialized.byteLength > this.MAX_CHUNK_SIZE;
        } catch {
            // If encoding fails, estimate with JSON
            const jsonSize = JSON.stringify(data).length;
            return jsonSize > this.MAX_CHUNK_SIZE;
        }
    }

    /**
     * Get estimated size of payload in bytes
     */
    public estimateSize(data: any): number {
        try {
            return encode(data).byteLength;
        } catch {
            return JSON.stringify(data).length;
        }
    }

    /**
     * Chunk a PlantSnapshot by shops (logical boundary chunking)
     */
    public chunkPlantSnapshot(snapshot: any): ChunkedPayload[] {
        const chunks: ChunkedPayload[] = [];
        const chunkId = this.generateChunkId();

        // Ensure shops array exists
        const shops = snapshot.shops || [];
        const totalChunks = shops.length + 1; // +1 for metadata chunk

        // Chunk 0: Metadata (everything except shops array)
        chunks.push({
            data: {
                _chunkType: 'metadata',
                timestamp: snapshot.timestamp,
                totalStations: snapshot.totalStations,
                totalOccupied: snapshot.totalOccupied,
                totalFree: snapshot.totalFree,
                totalStopped: snapshot.totalStopped,
                shopCount: shops.length
            },
            chunkInfo: {
                chunkId,
                chunkIndex: 0,
                totalChunks,
                isLast: shops.length === 0
            }
        });

        // One chunk per shop
        shops.forEach((shop: any, index: number) => {
            chunks.push({
                data: {
                    _chunkType: 'shop',
                    shop
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: index + 1,
                    totalChunks,
                    isLast: index === shops.length - 1
                }
            });
        });

        return chunks;
    }

    /**
     * Chunk a cars array into batches
     */
    public chunkCarsArray(cars: any[], batchSize: number = 50): ChunkedPayload[] {
        const chunks: ChunkedPayload[] = [];
        const chunkId = this.generateChunkId();
        const totalChunks = Math.ceil(cars.length / batchSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, cars.length);
            const batch = cars.slice(start, end);

            chunks.push({
                data: {
                    _chunkType: 'cars_batch',
                    cars: batch,
                    batchIndex: i,
                    totalCars: cars.length
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: i,
                    totalChunks,
                    isLast: i === totalChunks - 1
                }
            });
        }

        return chunks;
    }

    /**
     * Chunk an array generically by batch size
     */
    public chunkArray(items: any[], path: string, batchSize: number = 100): ChunkedPayload[] {
        const chunks: ChunkedPayload[] = [];
        const chunkId = this.generateChunkId();
        const totalChunks = Math.ceil(items.length / batchSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, items.length);
            const batch = items.slice(start, end);

            chunks.push({
                data: {
                    _chunkType: 'array_batch',
                    path,
                    items: batch,
                    batchIndex: i,
                    totalItems: items.length
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: i,
                    totalChunks,
                    isLast: i === totalChunks - 1
                }
            });
        }

        return chunks;
    }

    /**
     * Chunk delta operations into batches
     */
    public chunkDeltaOperations(operations: any[], batchSize: number = 50): ChunkedPayload[] {
        if (operations.length <= batchSize) {
            // No chunking needed
            const chunkId = this.generateChunkId();
            return [{
                data: {
                    _chunkType: 'delta_operations',
                    operations
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: 0,
                    totalChunks: 1,
                    isLast: true
                }
            }];
        }

        const chunks: ChunkedPayload[] = [];
        const chunkId = this.generateChunkId();
        const totalChunks = Math.ceil(operations.length / batchSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, operations.length);
            const batch = operations.slice(start, end);

            chunks.push({
                data: {
                    _chunkType: 'delta_operations',
                    operations: batch,
                    batchIndex: i,
                    totalOperations: operations.length
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: i,
                    totalChunks,
                    isLast: i === totalChunks - 1
                }
            });
        }

        return chunks;
    }

    /**
     * Generic byte-level chunking (fallback)
     * Serializes to JSON and splits by byte boundaries
     */
    public chunkByBytes(data: any): ChunkedPayload[] {
        const serialized = JSON.stringify(data);
        const totalSize = serialized.length;

        if (totalSize <= this.MAX_CHUNK_SIZE) {
            const chunkId = this.generateChunkId();
            return [{
                data: {
                    _chunkType: 'raw',
                    content: serialized
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: 0,
                    totalChunks: 1,
                    isLast: true
                }
            }];
        }

        const chunks: ChunkedPayload[] = [];
        const chunkId = this.generateChunkId();
        const totalChunks = Math.ceil(totalSize / this.MAX_CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.MAX_CHUNK_SIZE;
            const end = Math.min(start + this.MAX_CHUNK_SIZE, totalSize);
            const content = serialized.slice(start, end);

            chunks.push({
                data: {
                    _chunkType: 'raw_bytes',
                    content,
                    byteOffset: start,
                    totalBytes: totalSize
                },
                chunkInfo: {
                    chunkId,
                    chunkIndex: i,
                    totalChunks,
                    isLast: i === totalChunks - 1
                }
            });
        }

        return chunks;
    }

    /**
     * Generate unique chunk ID for grouping related chunks
     */
    private generateChunkId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get configuration values
     */
    public getConfig(): { maxChunkSize: number; minChunkSize: number } {
        return {
            maxChunkSize: this.MAX_CHUNK_SIZE,
            minChunkSize: this.MIN_CHUNK_SIZE
        };
    }
}

// Export singleton instance
export const chunkingService = new ChunkingService();
