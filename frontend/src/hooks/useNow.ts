import { useEffect, useState } from 'react';
import { serverNow } from '../utils/serverClock';

/** Re-renders on an interval with the current server-adjusted time. Display only, never authoritative. */
export function useNow(intervalMs = 250, active = true): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(serverNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
