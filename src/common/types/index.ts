import type { ErrorCode } from '../constants';

// ---------------------------------------------------------------------------
// Audit domain types
// ---------------------------------------------------------------------------

export interface AuditResult {
  title: string;
  description: string;
  statusCode: number;
  responseTime: number;
  contentLength: number;
  headers: Record<string, string>;
  https: boolean;
  reachable: boolean;
  redirectChain?: string[];
  finalUrl?: string;
}

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export interface SuccessResponse<T> {
  success: true;
  requestId: string;
  cached: boolean;
  data?: T;
  audit?: AuditResult;
}

export interface ErrorResponse {
  success: false;
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// ---------------------------------------------------------------------------
// Queue job payload
// ---------------------------------------------------------------------------

export interface AuditJobPayload {
  url: string;
  requestId: string;
  timestamp: string;
}

export interface AuditJobResult {
  success: boolean;
  audit?: AuditResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// HTTP Client types
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  headers?: Record<string, string>;
}

export interface HttpFetchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  responseTimeMs: number;
  finalUrl: string;
  redirectChain: string[];
}

// ---------------------------------------------------------------------------
// Circuit Breaker types
// ---------------------------------------------------------------------------

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  threshold: number;     // failures before opening
  timeoutMs: number;     // time before trying HALF_OPEN
  name: string;
}

// ---------------------------------------------------------------------------
// Request context (threaded through the request lifecycle)
// ---------------------------------------------------------------------------

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
  startTime: number;
}
