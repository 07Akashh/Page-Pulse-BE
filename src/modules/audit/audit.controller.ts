import { Controller, Post, Body, HttpCode, HttpStatus, Req, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { auditRequestSchema } from './validators/url.validator';
import { ZodValidationPipe } from '../../common/guards/zod-validation.pipe';
import { CORRELATION_ID_HEADER } from '../../common/constants';
import type { AuditResponseDto } from './dto/audit.dto';

/**
 * AuditController — HTTP adapter layer with production-grade error handling.
 *
 * Rules:
 * - No business logic — thin adapter between HTTP and AuditService
 * - All domain errors THROW proper HTTP exceptions (never return errors with 200 status)
 * - All input validated by ZodValidationPipe before handler runs
 * - GlobalExceptionFilter catches all exceptions and formats responses
 * - Request ID injected into all responses for tracing
 */
@ApiTags('audit')
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  public constructor(private readonly auditService: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(auditRequestSchema))
  @ApiOperation({
    summary: 'Audit a URL',
    description:
      'Submits a URL for auditing. Returns cached results immediately if available, otherwise performs a live audit.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          example: 'https://www.example.com',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Audit completed successfully',
    schema: {
      example: {
        success: true,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        cached: false,
        audit: {
          title: 'Example Domain',
          description: '',
          statusCode: 200,
          responseTime: 320,
          contentLength: 1256,
          headers: { 'content-type': 'text/html' },
          https: true,
          reachable: true,
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid URL' })
  @ApiResponse({ status: 429, description: 'Queue full or rate limit exceeded' })
  @ApiResponse({ status: 504, description: 'Request timeout' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  public async audit(
    @Body() body: { url: string },
    @Req() req: Request,
  ): Promise<AuditResponseDto> {
    const requestId = (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? '';
    // All exceptions are handled by GlobalExceptionFilter, which converts them to proper HTTP responses
    // Errors are thrown by AuditService and caught globally — no error handling needed here
    return this.auditService.auditUrl(body.url, requestId);
  }
}
