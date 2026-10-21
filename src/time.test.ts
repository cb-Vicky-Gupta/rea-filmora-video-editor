import { describe, expect, it } from 'vitest';
import { clampTrim, formatTime } from './time';

describe('formatTime', () => {
  it('formats short durations as mm:ss.cc', () => {
    expect(formatTime(0)).toBe('00:00.00');
    expect(formatTime(5.25)).toBe('00:05.25');
    expect(formatTime(75.5)).toBe('01:15.50');
  });

  it('adds hours for long media', () => {
    expect(formatTime(3725)).toBe('1:02:05.00');
  });

  it('treats invalid input as zero', () => {
    expect(formatTime(-3)).toBe('00:00.00');
    expect(formatTime(Number.NaN)).toBe('00:00.00');
  });
});

describe('clampTrim', () => {
  it('keeps a valid range unchanged', () => {
    expect(clampTrim({ start: 1, end: 4 }, 10)).toEqual({ start: 1, end: 4 });
  });

  it('clamps to the media bounds', () => {
    expect(clampTrim({ start: -2, end: 20 }, 10)).toEqual({ start: 0, end: 10 });
  });

  it('enforces the minimum clip length', () => {
    expect(clampTrim({ start: 5, end: 5 }, 10, 1)).toEqual({ start: 5, end: 6 });
    expect(clampTrim({ start: 10, end: 10 }, 10, 1)).toEqual({ start: 9, end: 10 });
  });

  it('returns an empty range for unknown duration', () => {
    expect(clampTrim({ start: 1, end: 2 }, Number.NaN)).toEqual({ start: 0, end: 0 });
  });
});
