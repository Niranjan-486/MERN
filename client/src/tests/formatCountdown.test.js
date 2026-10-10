import { describe, it, expect } from 'vitest';
import { formatCountdown } from '../lib/formatCountdown';

describe('formatCountdown', () => {
  it('formats null, undefined, NaN, and negative values as 0:00', () => {
    expect(formatCountdown(null)).toBe('0:00');
    expect(formatCountdown(undefined)).toBe('0:00');
    expect(formatCountdown(NaN)).toBe('0:00');
    expect(formatCountdown(-10)).toBe('0:00');
    expect(formatCountdown(0)).toBe('0:00');
  });

  it('formats under 1 minute with padded seconds', () => {
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(15)).toBe('0:15');
    expect(formatCountdown(59)).toBe('0:59');
  });

  it('formats exact minutes', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(120)).toBe('2:00');
    expect(formatCountdown(180)).toBe('3:00');
  });

  it('formats multi-minute countdowns with single and double digit seconds', () => {
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(125)).toBe('2:05');
    expect(formatCountdown(179)).toBe('2:59');
  });
});
