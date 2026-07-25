import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpFetch, HttpTimeoutError } from '../../../src/common/utils/http-client.util';

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

import { fetch as mockFetch } from 'undici';

describe('httpFetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches URL successfully and parses response', async () => {
    const mockHeaders = new Map([['content-type', 'text/html']]);
    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      url: 'https://www.example.com',
      text: vi.fn().mockResolvedValue('<html><title>Test</title></html>'),
      headers: mockHeaders,
    });

    const result = await httpFetch('https://www.example.com', {
      timeoutMs: 1000,
      maxRetries: 1,
      retryBaseDelayMs: 10,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('<title>Test</title>');
    expect(result.finalUrl).toBe('https://www.example.com');
  });

  it('throws HttpTimeoutError when request times out (AbortError)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(abortErr);

    await expect(
      httpFetch('https://www.example.com', {
        timeoutMs: 50,
        maxRetries: 0,
        retryBaseDelayMs: 10,
      }),
    ).rejects.toThrow(HttpTimeoutError);
  });

  it('retries on network error up to maxRetries', async () => {
    const connErr = new Error('ECONNREFUSED');
    (connErr as any).code = 'ECONNREFUSED';

    (mockFetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(connErr);

    await expect(
      httpFetch('https://www.example.com', {
        timeoutMs: 1000,
        maxRetries: 1,
        retryBaseDelayMs: 10,
      }),
    ).rejects.toThrow('ECONNREFUSED');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
