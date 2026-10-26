import { afterEach, describe, expect, it, vi } from 'vitest';
import { remainingUntil, resetServerClock, serverNow, syncServerClock } from '../../src/utils/serverClock';

afterEach(() => {
  vi.useRealTimers();
  resetServerClock();
});

describe('server clock', () => {
  it('computes remaining time from the server deadline, not from a local counter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    // The device clock is 5 s behind the server.
    syncServerClock('2026-01-01T10:00:05Z');
    expect(serverNow()).toBe(new Date('2026-01-01T10:00:05Z').getTime());
    expect(remainingUntil('2026-01-01T10:00:25Z')).toBe(20_000);
    vi.setSystemTime(new Date('2026-01-01T10:00:10Z'));
    expect(remainingUntil('2026-01-01T10:00:25Z')).toBe(10_000);
  });

  it('uses the frozen remaining time while paused and clamps at zero', () => {
    expect(remainingUntil('2000-01-01T00:00:00Z')).toBe(0);
    expect(remainingUntil('2999-01-01T00:00:00Z', 42_000)).toBe(42_000);
    expect(remainingUntil(null)).toBeNull();
  });
});
