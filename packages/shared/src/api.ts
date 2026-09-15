import type { ErrorCode } from './error-codes';

/** Successful envelope. Every 2xx body from the API has this shape. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Failure envelope. Every non-2xx body from the API has this shape. */
export interface ApiFailure {
  success: false;
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
    requestId?: string;
    timestamp?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(r: ApiResponse<T>): r is ApiFailure {
  return r.success === false;
}

/** Cursor/offset pagination envelope used by list endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
