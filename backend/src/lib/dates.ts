import { env } from "../config/env.js";

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zonedParts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Today's calendar date (YYYY-MM-DD) in APP_TIMEZONE. */
export function todayDateOnly(now: Date = new Date(), timeZone: string = env.appTimezone): string {
  const p = zonedParts(now, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDateOnly(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** YYYY-MM-DD → Date at UTC midnight (how Prisma represents `@db.Date`). */
export function dateOnlyToDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Date from a `@db.Date` column (UTC midnight) → YYYY-MM-DD. */
export function dateToDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateOnly: string, days: number): string {
  return dateToDateOnly(new Date(dateOnlyToDate(dateOnly).getTime() + days * DAY_MS));
}

/** Whole days from `a` to `b` (b - a), both YYYY-MM-DD. */
export function diffDays(a: string, b: string): number {
  return Math.round((dateOnlyToDate(b).getTime() - dateOnlyToDate(a).getTime()) / DAY_MS);
}

/** The UTC instant at which the given calendar date starts (00:00) in `timeZone`. */
export function zonedStartOfDay(dateOnly: string, timeZone: string = env.appTimezone): Date {
  const guess = dateOnlyToDate(dateOnly).getTime();
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass handles DST transitions
  return new Date(t);
}

/** [start, end) of the current calendar month in APP_TIMEZONE, as UTC instants. */
export function currentMonthRange(now: Date = new Date(), timeZone: string = env.appTimezone): { start: Date; end: Date } {
  const p = zonedParts(now, timeZone);
  const first = `${pad(p.year, 4)}-${pad(p.month)}-01`;
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const nextFirst = `${pad(nextYear, 4)}-${pad(nextMonth)}-01`;
  return { start: zonedStartOfDay(first, timeZone), end: zonedStartOfDay(nextFirst, timeZone) };
}

/** Overdue info for a loan's due date relative to `today` (both YYYY-MM-DD). */
export function overdueInfo(
  dueDate: string | null,
  isOpen: boolean,
  today: string,
): { isOverdue: boolean; daysOverdue: number } {
  if (!isOpen || !dueDate || dueDate >= today) return { isOverdue: false, daysOverdue: 0 };
  return { isOverdue: true, daysOverdue: diffDays(dueDate, today) };
}
