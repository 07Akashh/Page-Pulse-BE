import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';
import { ERROR_CODES } from '../constants';

/**
 * ZodValidationPipe — NestJS pipe that validates request bodies against a Zod schema.
 *
 * Why a custom pipe over @UsePipes(ValidationPipe)?
 * ValidationPipe uses class-validator/class-transformer which requires
 * decorated classes. Zod schemas are plain functions — more composable
 * and reusable outside of NestJS (e.g., in the BullMQ worker).
 *
 * Usage:
 * @UsePipes(new ZodValidationPipe(mySchema))
 * async handler(@Body() body: MyDto) { ... }
 */
export class ZodValidationPipe implements PipeTransform {
  public constructor(private readonly schema: ZodSchema) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = this.formatErrors(result.error);
      throw new BadRequestException({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: errors,
        },
      });
    }

    return result.data;
  }

  private formatErrors(error: ZodError): Array<{ field: string; message: string }> {
    return error.errors.map((e) => ({
      field: e.path.join('.') || 'body',
      message: e.message,
    }));
  }
}
