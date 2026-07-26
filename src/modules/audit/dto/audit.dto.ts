import type { AuditResult } from '../../../common/types';

/** Input DTO — validated by Zod before reaching the controller handler */
export interface AuditRequestDto {
  url: string;
}

/** The full audit response envelope — success case only */
export interface AuditResponseDto {
  success: true;
  requestId: string;
  cached: boolean;
  audit: AuditResult;
}

/**
 * NOTE: Error responses are handled by GlobalExceptionFilter.
 * Controllers should THROW HttpException, not return error objects with 200 status.
 * This ensures proper HTTP status codes (429, 504, 400, 500, etc.)
 */
