/** Day of the week, 0 = Sunday through 6 = Saturday (same as `Date#getUTCDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One trading window. `start` and `end` are minutes after local midnight of
 * `day`; `end` is exclusive and exceeds 1440 for windows that run past midnight.
 */
export interface SessionWindow {
  day: Weekday;
  start: number;
  end: number;
}

export interface TradingSession {
  /** Trades around the clock, every day. */
  always: boolean;
  windows: readonly SessionWindow[];
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MINUTES_PER_DAY = 1440;

function parseDay(text: string, spec: string): Weekday {
  const index = DAY_NAMES.indexOf(text.toLowerCase() as (typeof DAY_NAMES)[number]);
  if (index < 0) throw new SyntaxError(`Unknown day "${text}" in session "${spec}"`);
  return index as Weekday;
}

function parseDays(text: string, spec: string): Weekday[] {
  if (text.toLowerCase() === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<Weekday>();
  for (const item of text.split(',')) {
    const [first, last, extra] = item.split('-');
    if (!first || extra !== undefined) throw new SyntaxError(`Bad day list "${text}" in session "${spec}"`);
    const from = parseDay(first, spec);
    const to = last === undefined ? from : parseDay(last, spec);
    for (let day = from; ; day = ((day + 1) % 7) as Weekday) {
      days.add(day);
      if (day === to) break;
    }
  }
  return [...days].sort((a, b) => a - b);
}

function parseClock(text: string, spec: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || minutes > 59 || hours > 24 || (hours === 24 && minutes > 0)) {
    throw new SyntaxError(`Bad time "${text}" in session "${spec}"`);
  }
  return hours * 60 + minutes;
}

/**
 * Parses tickdeck session syntax. Times are local to the instrument's timezone.
 *
 * - `always`: open around the clock.
 * - `<days> <HH:MM-HH:MM>[,<HH:MM-HH:MM>...]`, several rules joined with `;`.
 * - Days: `daily`, a day (`Mon`), a range (`Mon-Fri`, may wrap like `Sun-Thu`) or a comma list (`Mon,Wed`).
 * - Ranges are end-exclusive. An end at or before the start runs past midnight
 *   into the next day, e.g. `Sun-Thu 18:00-17:00`.
 *
 * @example parseSession('Mon-Fri 09:30-16:00')
 * @example parseSession('Mon-Fri 04:00-09:30,09:30-20:00; Sat 10:00-14:00')
 */
export function parseSession(spec: string): TradingSession {
  const text = spec.trim();
  if (text.toLowerCase() === 'always') return { always: true, windows: [] };

  const windows: SessionWindow[] = [];
  for (const rule of text.split(';')) {
    const [daysText, rangesText, extra] = rule.trim().split(/\s+/);
    if (!daysText || !rangesText || extra !== undefined) {
      throw new SyntaxError(`Bad session rule "${rule.trim()}" in "${spec}"`);
    }
    const days = parseDays(daysText, spec);
    for (const range of rangesText.split(',')) {
      const [startText, endText, more] = range.split('-');
      if (!startText || !endText || more !== undefined) {
        throw new SyntaxError(`Bad time range "${range}" in session "${spec}"`);
      }
      const start = parseClock(startText, spec);
      let end = parseClock(endText, spec);
      if (start === MINUTES_PER_DAY) throw new SyntaxError(`Range cannot start at 24:00 in session "${spec}"`);
      if (end <= start) end += MINUTES_PER_DAY;
      for (const day of days) windows.push({ day, start, end });
    }
  }
  windows.sort((a, b) => a.day - b.day || a.start - b.start);
  return { always: false, windows };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localClock(time: number, timezone: string): { day: Weekday; minutes: number } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timezone, formatter);
  }
  let day: Weekday = 0;
  let hours = 0;
  let minutes = 0;
  for (const part of formatter.formatToParts(time)) {
    if (part.type === 'weekday') day = parseDay(part.value.slice(0, 3), part.value);
    else if (part.type === 'hour') hours = Number(part.value) % 24;
    else if (part.type === 'minute') minutes = Number(part.value);
  }
  return { day, minutes: hours * 60 + minutes };
}

/** Whether the session is open at `time` (UTC epoch milliseconds) in the given IANA timezone. */
export function isSessionOpen(session: TradingSession | string, time: number, timezone: string): boolean {
  const parsed = typeof session === 'string' ? parseSession(session) : session;
  if (parsed.always) return true;
  const local = localClock(time, timezone);
  for (const window of parsed.windows) {
    if (local.day === window.day && local.minutes >= window.start && local.minutes < Math.min(window.end, MINUTES_PER_DAY)) {
      return true;
    }
    if (window.end > MINUTES_PER_DAY && local.day === (window.day + 1) % 7 && local.minutes < window.end - MINUTES_PER_DAY) {
      return true;
    }
  }
  return false;
}
