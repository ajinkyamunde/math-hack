import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatPercent, formatSeconds } from '../../src/utils/format';

describe('format helpers', () => {
  it('formats countdown clocks', () => {
    expect(formatClock(125_000)).toBe('2:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(400)).toBe('0:01'); // rounds partial seconds up so 0:00 means time is truly up
    expect(formatClock(null)).toBe('--:--');
  });

  it('never renders a missing average as zero', () => {
    expect(formatSeconds(null)).toBe('N/A');
    expect(formatSeconds(4250)).toBe('4.25 s');
    expect(formatPercent(null)).toBe('N/A');
    expect(formatPercent(2 / 3)).toBe('66.7%');
  });

  it('formats durations', () => {
    expect(formatDuration(1800)).toBe('30 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });
});
