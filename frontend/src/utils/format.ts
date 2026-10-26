/** 125000 -> "2:05", 3725000 -> "1:02:05". Negative values clamp to zero. */
export function formatClock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/** Response times: "4.25 s"; missing values render as "N/A", never "0". */
export function formatSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'N/A';
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return 'N/A';
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatDuration(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();
