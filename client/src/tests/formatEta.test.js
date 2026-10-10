import { describe, it, expect } from 'vitest';
import { formatEta } from '../lib/formatEta';

describe('formatEta pure formatting utility', () => {
  // Required unit test suite: null, 0, 45, 60, 89, 90, 3600, 5400
  it('returns null for null, undefined, NaN, and negative inputs', () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(NaN)).toBeNull();
    expect(formatEta(-10)).toBeNull();
  });

  it('formats under 60 s as "less than a minute"', () => {
    expect(formatEta(0)).toBe('less than a minute');
    expect(formatEta(45)).toBe('less than a minute');
    expect(formatEta(59)).toBe('less than a minute');
  });

  it('formats nearest minute with halves rounding up', () => {
    expect(formatEta(60)).toBe('1 min');
    expect(formatEta(89)).toBe('1 min');
    expect(formatEta(90)).toBe('2 min');
    expect(formatEta(119)).toBe('2 min');
    expect(formatEta(120)).toBe('2 min');
    expect(formatEta(150)).toBe('3 min');
    expect(formatEta(300)).toBe('5 min');
  });

  it('formats 60+ minutes in "1 h 30 min" style', () => {
    expect(formatEta(3600)).toBe('1 h');
    expect(formatEta(5400)).toBe('1 h 30 min');
    expect(formatEta(7200)).toBe('2 h');
    expect(formatEta(7260)).toBe('2 h 1 min');
    expect(formatEta(7300)).toBe('2 h 2 min');
  });
});
