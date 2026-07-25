import type { CircuitBreakerOptions, CircuitState } from '../types';

/**
 * Lightweight Circuit Breaker — implemented from scratch.
 *
 * Why not use 'opossum'?
 * opossum is excellent but adds ~500KB to the bundle and its API surface
 * is much larger than what we need. Our circuit breaker is 3 states,
 * one counter, one timer — KISS principle.
 *
 * States:
 * - CLOSED: Normal operation. Failures increment counter.
 * - OPEN:   Threshold exceeded. All calls fail fast (no external request).
 * - HALF_OPEN: After timeout, one probe request is allowed through.
 *              Success → CLOSED. Failure → OPEN again.
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;

  public constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  /**
   * Executes `fn` through the circuit breaker.
   * Throws immediately if circuit is OPEN.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new CircuitBreakerError(
        `Circuit breaker '${this.options.name}' is OPEN. Requests are blocked.`,
        this.getResetTimeMs(),
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  private isOpen(): boolean {
    if (this.state === 'CLOSED') return false;

    if (this.state === 'OPEN') {
      // Check if timeout has elapsed → transition to HALF_OPEN
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.options.timeoutMs) {
        this.state = 'HALF_OPEN';
        return false; // let one probe through
      }
      return true;
    }

    // HALF_OPEN: let through
    return false;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.state === 'HALF_OPEN' ||
      this.failureCount >= this.options.threshold
    ) {
      this.state = 'OPEN';
    }
  }

  private getResetTimeMs(): number {
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.options.timeoutMs - elapsed);
  }
}

export class CircuitBreakerError extends Error {
  public readonly resetInMs: number;

  public constructor(message: string, resetInMs: number) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.resetInMs = resetInMs;
  }
}
