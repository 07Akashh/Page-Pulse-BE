import { describe, it, expect } from 'vitest';
import { ZodValidationPipe } from '../../../src/common/guards/zod-validation.pipe';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().min(18),
  });

  const pipe = new ZodValidationPipe(schema);

  it('passes valid object', () => {
    const valid = { name: 'Alice', age: 25 };
    const res = pipe.transform(valid, {} as never);
    expect(res).toEqual(valid);
  });

  it('throws BadRequestException for invalid object', () => {
    const invalid = { name: '', age: 16 };
    expect(() => pipe.transform(invalid, {} as never)).toThrow(BadRequestException);
  });
});
