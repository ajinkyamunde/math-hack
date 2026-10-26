import { formatClock } from '../../utils/format';

interface CountdownRingProps {
  remainingMs: number | null;
  totalMs: number;
  label: string;
  paused?: boolean;
}

/** Visual countdown. Colour shifts are reinforced with text so meaning never depends on colour or motion alone. */
export function CountdownRing({ remainingMs, totalMs, label, paused }: CountdownRingProps) {
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const fraction = remainingMs === null || totalMs <= 0 ? 0 : Math.min(1, Math.max(0, remainingMs / totalMs));
  const level = remainingMs !== null && remainingMs <= 5000 ? 'critical' : fraction <= 0.25 ? 'warning' : 'normal';
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  return (
    <div className={`timer timer--${level}`}>
      <svg className="timer__ring" viewBox="0 0 64 64" aria-hidden="true">
        <circle className="timer__track" cx="32" cy="32" r={radius} />
        <circle className="timer__progress" cx="32" cy="32" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - fraction)} />
      </svg>
      <div>
        <div className="timer__label">{label}{paused ? ' · paused' : ''}</div>
        <div className="timer__value" aria-hidden="true">{formatClock(remainingMs)}</div>
        <span className="visually-hidden" aria-live={level === 'critical' ? 'assertive' : 'off'}>
          {seconds === null ? '' : `${label}: ${seconds} seconds remaining${paused ? ', paused' : ''}`}
        </span>
      </div>
    </div>
  );
}
