import { describe, expect, it } from 'vitest';
import { isSessionOpen, parseSession } from './session';

const utc = (iso: string) => Date.parse(iso);

describe('parseSession', () => {
  it('parses the around-the-clock session', () => {
    expect(parseSession('always')).toEqual({ always: true, windows: [] });
  });

  it('expands day ranges and multiple time ranges', () => {
    const session = parseSession('Mon-Fri 04:00-09:30,09:30-20:00; Sat 10:00-14:00');
    expect(session.always).toBe(false);
    expect(session.windows).toHaveLength(11);
    expect(session.windows[0]).toEqual({ day: 1, start: 240, end: 570 });
    expect(session.windows.at(-1)).toEqual({ day: 6, start: 600, end: 840 });
  });

  it('wraps day ranges and overnight windows', () => {
    const session = parseSession('Sun-Thu 18:00-17:00');
    expect(session.windows.map((w) => w.day)).toEqual([0, 1, 2, 3, 4]);
    expect(session.windows[0]).toEqual({ day: 0, start: 1080, end: 2460 });
    expect(parseSession('Fri-Mon 00:00-24:00').windows.map((w) => w.day)).toEqual([0, 1, 5, 6]);
    expect(parseSession('daily 00:00-24:00').windows).toHaveLength(7);
  });

  it('rejects malformed specs', () => {
    expect(() => parseSession('Mon-Fri')).toThrow(SyntaxError);
    expect(() => parseSession('Mon-Fri 9:30-16:00')).toThrow(SyntaxError);
    expect(() => parseSession('Funday 09:30-16:00')).toThrow(SyntaxError);
    expect(() => parseSession('Mon 09:30-25:00')).toThrow(SyntaxError);
  });
});

describe('isSessionOpen', () => {
  const equities = 'Mon-Fri 09:30-16:00';

  it('evaluates windows in the instrument timezone', () => {
    // 2026-10-14 is a Wednesday; New York is on UTC-4 in October.
    expect(isSessionOpen(equities, utc('2026-10-14T14:00:00Z'), 'America/New_York')).toBe(true);
    expect(isSessionOpen(equities, utc('2026-10-14T13:29:00Z'), 'America/New_York')).toBe(false);
    expect(isSessionOpen(equities, utc('2026-10-14T20:00:00Z'), 'America/New_York')).toBe(false);
    expect(isSessionOpen(equities, utc('2026-10-17T15:00:00Z'), 'America/New_York')).toBe(false);
  });

  it('handles windows that cross midnight', () => {
    const futures = parseSession('Sun-Thu 18:00-17:00');
    expect(isSessionOpen(futures, utc('2026-10-12T07:00:00Z'), 'America/New_York')).toBe(true); // Mon 03:00
    expect(isSessionOpen(futures, utc('2026-10-16T21:30:00Z'), 'America/New_York')).toBe(false); // Fri 17:30
    expect(isSessionOpen(futures, utc('2026-10-11T22:30:00Z'), 'America/New_York')).toBe(true); // Sun 18:30
    expect(isSessionOpen(futures, utc('2026-10-17T12:00:00Z'), 'America/New_York')).toBe(false); // Sat
  });

  it('is always open for the always session', () => {
    expect(isSessionOpen('always', utc('2026-10-17T03:00:00Z'), 'Etc/UTC')).toBe(true);
  });
});
