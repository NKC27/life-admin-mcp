import type { Period } from "./types.js";
import { isIsoDate } from "./util.js";

// All dates are calendar days written as YYYY-MM-DD. Arithmetic is done on whole UTC days so that
// clock changes (BST/GMT) and time zones can never shift a date by one.

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

function parts(date: string): [number, number, number] {
  if (!isIsoDate(date)) throw new Error(`Not a valid YYYY-MM-DD date: "${date}"`);
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

/** Number of days in a month (`month` is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Today's date in the user's local time zone. `LIFE_ADMIN_TODAY` overrides it, which makes
 * tests and demos repeatable.
 */
export function today(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  const override = env.LIFE_ADMIN_TODAY;
  if (override) {
    if (!isIsoDate(override)) throw new Error(`LIFE_ADMIN_TODAY must be YYYY-MM-DD, got "${override}"`);
    return override;
  }
  return format(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function dayNumber(date: string): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: string, days: number): string {
  const t = new Date((dayNumber(date) + days) * DAY_MS);
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Add whole months, clamping to the end of shorter months. `anchorDay` is the day of the month the
 * schedule really falls on, so 31 Jan -> 28 Feb -> 31 Mar instead of drifting to the 28th for ever.
 */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parts(date);
  const wanted = anchorDay ?? d;
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return format(year, month, Math.min(wanted, daysInMonth(year, month)));
}

/** The next occurrence after `date` for a repeating period. One-off items have no next occurrence. */
export function nextOccurrence(date: string, period: Period, anchorDay?: number): string {
  switch (period) {
    case "weekly":
      return addDays(date, 7);
    case "monthly":
      return addMonths(date, 1, anchorDay);
    case "quarterly":
      return addMonths(date, 3, anchorDay);
    case "yearly":
      return addMonths(date, 12, anchorDay);
    case "one-off":
      throw new Error("A one-off item does not repeat");
  }
}

export interface Rolled {
  due: string;
  /** How many periods the date moved forward (at least 1). */
  periods: number;
  /** Day of month to remember for month-based schedules that can clamp (29-31), otherwise undefined. */
  anchorDay?: number;
}

/**
 * Move a repeating due date on after it has been dealt with: at least one period, then further
 * periods until it is after `todayDate`, so a stale date does not stay in the past.
 */
export function rollForward(due: string, period: Period, todayDate: string, anchorDay?: number): Rolled {
  const anchor = period === "weekly" ? undefined : (anchorDay ?? parts(due)[2]);
  let next = nextOccurrence(due, period, anchor);
  let periods = 1;
  while (next <= todayDate) {
    if (periods >= 1000) throw new Error("Due date is too far in the past to roll forward");
    next = nextOccurrence(next, period, anchor);
    periods += 1;
  }
  return { due: next, periods, anchorDay: anchor !== undefined && anchor > 28 ? anchor : undefined };
}

export interface DueStatus {
  /** Days until due; negative when overdue. */
  daysLeft: number;
  overdue: boolean;
  /** The first day reminders apply. */
  remindFrom: string;
  /** True from `remindFrom` onwards (including when overdue). */
  remindersOn: boolean;
}

export function dueStatus(due: string, todayDate: string, remindDays: number): DueStatus {
  const daysLeft = daysBetween(todayDate, due);
  const remindFrom = addDays(due, -remindDays);
  return { daysLeft, overdue: daysLeft < 0, remindFrom, remindersOn: todayDate >= remindFrom };
}

/** "today", "tomorrow", "in 5 days", "1 day ago", "12 days ago". */
export function describeDays(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft > 1) return `in ${daysLeft} days`;
  return daysLeft === -1 ? "1 day ago" : `${-daysLeft} days ago`;
}
