import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../../../src/common/utils/circuit-breaker.util';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ name: 'test', threshold: 3, timeoutMs: 100 });
  });

  it('starts in CLOSED state', () => {
    expect(cb.getState()).toBe('CLOSED');
  });

  it('executes function in CLOSED state', async () => {
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('opens after threshold failures', async () => {
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow('fail');
    }

    expect(cb.getState()).toBe('OPEN');
  });

  it('throws CircuitBreakerError when OPEN', async () => {
    // Force open
    const failing = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow();
    }

    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitBreakerError);
  });

  it('transitions to HALF_OPEN after timeout', async () => {
    const failing = () => Promise.reject(new Error('fail'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow();
    }

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 150));

    // Should allow one request (HALF_OPEN)
    expect(cb.getState()).toBe('OPEN'); // still shows OPEN until isOpen() is called

    // Execute should transition to HALF_OPEN internally
    const result = await cb.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('CLOSED'); // success → CLOSED
  });

  it('goes back to OPEN on failure in HALF_OPEN', async () => {
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow();
    }

    await new Promise((r) => setTimeout(r, 150));

    // HALF_OPEN probe fails
    await expect(cb.execute(failing)).rejects.toThrow('fail');
    expect(cb.getState()).toBe('OPEN');
  });

  it('resets failure count on success', async () => {
    const failing = () => Promise.reject(new Error('fail'));
    const succeeding = () => Promise.resolve('ok');

    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.getFailureCount()).toBe(1);

    await cb.execute(succeeding);
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe('CLOSED');
  });
});
