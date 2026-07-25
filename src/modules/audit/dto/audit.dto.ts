import type { AuditResult } from '../../../common/types';

/** Input DTO — validated by Zod before reaching the controller handler */
export interface AuditRequestDto {
  url: string;
}

/** The full audit response envelope */
export interface AuditResponseDto {
  success: true;
  requestId: string;
  cached: boolean;
  audit: AuditResult;
}

/** The API error envelope — returned by GlobalExceptionFilter */
export interface AuditErrorResponseDto {
  success: false;
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
