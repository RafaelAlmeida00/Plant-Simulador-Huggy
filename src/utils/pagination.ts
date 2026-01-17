// src/utils/pagination.ts

import { PaginationParams, PaginatedResult } from './shared';

/**
 * Default pagination values
 */
export const PAGINATION_DEFAULTS = {
    page: 1,
    limit: 50,
    maxLimit: 100
} as const;

/**
 * Parse and validate pagination parameters from request query
 * @param query - Request query object
 * @returns Validated PaginationParams
 */
export function parsePaginationParams(query: Record<string, any>): PaginationParams {
    const page = Math.max(1, parseInt(query.page as string, 10) || PAGINATION_DEFAULTS.page);
    const rawLimit = parseInt(query.limit as string, 10) || PAGINATION_DEFAULTS.limit;
    const limit = Math.min(Math.max(1, rawLimit), PAGINATION_DEFAULTS.maxLimit);

    return { page, limit };
}

/**
 * Pagination info structure for HTTP responses
 * Matches client expectation with hasNext/hasPrevious naming
 */
export interface PaginationInfo {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
}

/**
 * Paginated HTTP response structure
 */
export interface PaginatedResponse<T> {
    success: boolean;
    data: T[];
    pagination: PaginationInfo;
    count: number;
}

/**
 * Format a PaginatedResult from repository into HTTP response format
 * @param result - PaginatedResult from repository
 * @returns PaginatedResponse for HTTP
 */
export function formatPaginatedResponse<T>(result: PaginatedResult<T>): PaginatedResponse<T> {
    return {
        success: true,
        data: result.data,
        pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
            totalPages: result.totalPages,
            hasNext: result.hasNext,
            hasPrevious: result.hasPrev
        },
        count: result.data.length
    };
}

/**
 * Create a paginated response from an array (for non-paginated repository methods)
 * Useful for backward compatibility when repository method doesn't support pagination
 * @param data - Array of data
 * @param pagination - Pagination params used
 * @param total - Optional total count (defaults to data.length for in-memory pagination)
 */
export function createPaginatedResponse<T>(
    data: T[],
    pagination: PaginationParams,
    total?: number
): PaginatedResponse<T> {
    const actualTotal = total ?? data.length;
    const totalPages = Math.ceil(actualTotal / pagination.limit);

    return {
        success: true,
        data,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: actualTotal,
            totalPages,
            hasNext: pagination.page < totalPages,
            hasPrevious: pagination.page > 1
        },
        count: data.length
    };
}

/**
 * Apply in-memory pagination to an array
 * Use when repository method doesn't support server-side pagination
 * @param data - Full data array
 * @param pagination - Pagination params
 * @returns Sliced data for the requested page
 */
export function paginateArray<T>(data: T[], pagination: PaginationParams): T[] {
    const offset = (pagination.page - 1) * pagination.limit;
    return data.slice(offset, offset + pagination.limit);
}
