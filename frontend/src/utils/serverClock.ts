/**
 * Tracks the offset between this device's clock and the server's, from serverNow stamps the server
 * includes with every state payload. Countdown displays use server time; the server alone enforces deadlines.
 */
let offsetMs = 0;
let samples = 0;

export function syncServerClock(serverNowIso: string | undefined): void {
  if (!serverNowIso) return;
  const sample = new Date(serverNowIso).getTime() - Date.now();
  if (!Number.isFinite(sample)) return;
  // Smooth over network jitter, but adopt the first sample immediately.
  offsetMs = samples === 0 ? sample : offsetMs * 0.7 + sample * 0.3;
  samples += 1;
}

export const serverNow = (): number => Date.now() + offsetMs;

/** Remaining time until a server deadline, or the frozen value while paused. */
export function remainingUntil(deadlineIso: string | null | undefined, frozenMs?: number | null, now = serverNow()): number | null {
  if (frozenMs !== undefined && frozenMs !== null) return Math.max(0, frozenMs);
  if (!deadlineIso) return null;
  return Math.max(0, new Date(deadlineIso).getTime() - now);
}

export function resetServerClock(): void {
  offsetMs = 0;
  samples = 0;
}
