import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlobalExceptionFilter } from '../../../src/common/filters/global-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerMock: any;
  let responseMock: any;
  let requestMock: any;
  let hostMock: ArgumentsHost;

  beforeEach(() => {
    loggerMock = {
      error: vi.fn(),
      warn: vi.fn(),
    };

    responseMock = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    requestMock = {
      headers: { 'x-request-id': 'test-req-id' },
    };

    hostMock = {
      switchToHttp: () => ({
        getRequest: () => requestMock,
        getResponse: () => responseMock,
      }),
    } as unknown as ArgumentsHost;

    filter = new GlobalExceptionFilter(loggerMock);
  });

  it('handles HttpException cleanly', () => {
    const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
    filter.catch(exception, hostMock);

    expect(responseMock.status).toHaveBeenCalledWith(400);
    expect(responseMock.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        requestId: 'test-req-id',
        error: expect.objectContaining({ code: 'VALIDATION_ERROR', message: 'Bad Request' }),
      }),
    );
  });

  it('catches unknown errors as 500 without leaking stack trace', () => {
    const exception = new Error('Database secret leaked!');
    filter.catch(exception, hostMock);

    expect(responseMock.status).toHaveBeenCalledWith(500);
    expect(responseMock.json).toHaveBeenCalledWith({
      success: false,
      requestId: 'test-req-id',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
      },
    });
    expect(loggerMock.error).toHaveBeenCalled();
  });
});
