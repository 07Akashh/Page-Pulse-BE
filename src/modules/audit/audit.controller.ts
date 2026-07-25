import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UsePipes,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditService, QueueFullError, AuditTimeoutError } from './audit.service';
import { auditRequestSchema } from './validators/url.validator';
import { ZodValidationPipe } from '../../common/guards/zod-validation.pipe';
import { CORRELATION_ID_HEADER, ERROR_CODES } from '../../common/constants';
import type { AuditResponseDto, AuditErrorResponseDto } from './dto/audit.dto';

/**
 * AuditController — thin HTTP adapter layer.
 *
 * Rules enforced here:
 * - No business logic — only coordinate between HTTP and AuditService
 * - No direct Redis/BullMQ access
 * - Structured error responses for domain errors (QueueFull, Timeout)
 * - All input validated by ZodValidationPipe before handler runs
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
          example: 'https://example.com',
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
  public async audit(
    @Body() body: { url: string },
    @Req() req: Request,
  ): Promise<AuditResponseDto | AuditErrorResponseDto> {
    const requestId = (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? '';

    try {
      return await this.auditService.auditUrl(body.url, requestId);
    } catch (err) {
      if (err instanceof QueueFullError) {
        return {
          success: false,
          requestId,
          error: {
            code: ERROR_CODES.QUEUE_FULL,
            message: err.message,
          },
        } satisfies AuditErrorResponseDto;
      }

      if (err instanceof AuditTimeoutError) {
        return {
          success: false,
          requestId,
          error: {
            code: ERROR_CODES.REQUEST_TIMEOUT,
            message: err.message,
          },
        } satisfies AuditErrorResponseDto;
      }

      // Re-throw — GlobalExceptionFilter handles the rest
      throw err;
    }
  }
}
