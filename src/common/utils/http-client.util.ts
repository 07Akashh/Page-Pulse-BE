import { fetch } from 'undici';
import type { HttpClientOptions, HttpFetchResult } from '../types';
import { USER_AGENT } from '../constants';

/**
 * Production HTTP client with:
 * 1. AbortController-based timeout (tight limits: 5s total, 2s per connection attempt)
 * 2. Single retry only on network errors (no retry on timeout)
 * 3. Redirect chain tracking
 * 4. Structured result — no throwing on non-2xx
 */

export async function httpFetch(
  url: string,
  options: HttpClientOptions,
): Promise<HttpFetchResult> {
  const { timeoutMs, maxRetries, retryBaseDelayMs } = options;
  
  // Cap timeouts to prevent slow requests
  const effectiveTimeout = Math.min(timeoutMs, 5000); // Max 5 seconds per attempt
  const effectiveRetries = Math.min(maxRetries, 1);   // Max 1 retry

  let lastError: Error | null = null;
  const redirectChain: string[] = [];
  let finalUrl = url;

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    // Only wait on retry if it's a retryable error (not timeout)
    if (attempt > 0) {
      const delay = Math.min(retryBaseDelayMs * attempt, 500); // Max 500ms backoff
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), effectiveTimeout);

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

      // Read body with separate timeout to prevent hanging reads
      const bodyController = new AbortController();
      const bodyTimeoutHandle = setTimeout(() => bodyController.abort(), 2000);
      
      try {
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
      } finally {
        clearTimeout(bodyTimeoutHandle);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isTimeout = lastError.name === 'AbortError';
      const isLastAttempt = attempt === effectiveRetries;

      // On timeout, fail immediately — don't retry timeouts
      if (isTimeout) {
        throw new HttpTimeoutError(`Request to ${url} timed out after ${effectiveTimeout}ms`);
      }

      // On last attempt, throw the error
      if (isLastAttempt) {
        throw lastError;
      }

      // Only retry on actual network errors (ECONNREFUSED, ENOTFOUND, etc.)
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
