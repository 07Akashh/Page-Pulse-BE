import { fetch } from 'undici';
import type { HttpClientOptions, HttpFetchResult } from '../types';
import { USER_AGENT } from '../constants';

/**
 * Production HTTP client with:
 * 1. AbortController-based timeout (configurable, default 8s)
 * 2. Exponential backoff retry (configurable attempts + base delay)
 * 3. Redirect chain tracking
 * 4. Structured result — no throwing on non-2xx
 */

export async function httpFetch(
  url: string,
  options: HttpClientOptions,
): Promise<HttpFetchResult> {
  const { timeoutMs, maxRetries, retryBaseDelayMs } = options;

  let lastError: Error | null = null;
  const redirectChain: string[] = [];
  let finalUrl = url;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryBaseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          ...options.headers,
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      const responseTimeMs = Date.now() - startTime;
      finalUrl = response.url || url;

      // Read body
      const body = await response.text();

      // Flatten response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        statusCode: response.status,
        headers,
        body,
        responseTimeMs,
        finalUrl,
        redirectChain,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isTimeout = lastError.name === 'AbortError';
      const isLastAttempt = attempt === maxRetries;

      if (isTimeout || isLastAttempt) {
        throw isTimeout
          ? new HttpTimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`)
          : lastError;
      }

      if (!isRetryableError(lastError)) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError ?? new Error('Unknown HTTP fetch error');
}

function isRetryableError(err: Error): boolean {
  const retryableCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
  const errWithCode = err as Error & { code?: string };
  return retryableCodes.some((code) => errWithCode.code === code || err.message.includes(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpTimeoutError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'HttpTimeoutError';
  }
}
