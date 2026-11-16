import { Buffer } from "node:buffer";

import { addDays, addMonths, rollForward } from "./dates.js";
import { formatCost } from "./report.js";
import type { Item, ItemType } from "./types.js";

// iCalendar (RFC 5545) export. Each dated item becomes one all-day event with a stable UID, so
// importing a fresh export into the same calendar updates events instead of duplicating them
// (in calendar apps that match on UID). Repeating items carry an RRULE, so a monthly bill keeps
// showing up even if the user never exports again.

const PRODID = "-//NKC27//life-admin-mcp//EN";

/** Time of day (local) that reminders go off. */
const ALERT_HOUR = 9;

const PHRASE: Record<ItemType, string> = {
  renewal: "renewal due",
  bill: "payment due",
  subscription: "renews",
  warranty: "ends",
  policy: "renews",
  vehicle: "due",
  document: "expires",
  income: "payday",
  birthday: "birthday",
  reminder: "reminder",
};

export interface CalendarOptions {
  /** Leave out provider and cost, for calendars that sync to a shared or cloud account. */
  minimal?: boolean;
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line to at most 75 octets per line (continuation lines begin with a space),
 * never splitting a multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > limit) {
      out.push(current);
      current = ch;
      bytes = size;
      limit = 74; // the leading space of a continuation line counts towards its 75
    } else {
      current += ch;
      bytes += size;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** How far ahead to list the extra one-off events for 29th/30th schedules (see `schedule`). */
export const EXTRA_HORIZON_YEARS = 5;

export interface Schedule {
  /** First date of the main event. */
  start: string;
  /** RRULE for the main event, if it repeats. */
  rule?: string;
  /** Dates the rule cannot express, written as separate one-off events. */
  extras: string[];
}

function dayOf(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * How to put an item's dates into a calendar so they match `mark_handled` exactly, using only rules
 * every calendar app supports. (BYSETPOS with BYMONTHDAY would be neater, but some implementations
 * expand it to every listed day, giving four reminders a month.)
 *
 *  - day 1-28: a plain repeat.
 *  - the 31st: "last day of the month" (BYMONTHDAY=-1), which is exactly clamping to month end.
 *  - the 29th or 30th: repeat on that day; the months too short for it (February) are listed as
 *    separate events for the next few years.
 *  - 29 February yearly: last day of February each year.
 */
export function schedule(item: Item & { due: string }): Schedule {
  const month = Number(item.due.slice(5, 7));
  const anchor = item.anchor_day ?? dayOf(item.due);
  switch (item.period) {
    case "one-off":
      return { start: item.due, extras: [] };
    case "weekly":
      return { start: item.due, rule: "FREQ=WEEKLY", extras: [] };
    case "yearly":
      return month === 2 && anchor > 28
        ? { start: item.due, rule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1", extras: [] }
        : { start: item.due, rule: "FREQ=YEARLY", extras: [] };
    case "monthly":
    case "quarterly": {
      const base = item.period === "monthly" ? "FREQ=MONTHLY" : "FREQ=MONTHLY;INTERVAL=3";
      if (anchor <= 28) return { start: item.due, rule: base, extras: [] };
      if (anchor === 31) return { start: item.due, rule: `${base};BYMONTHDAY=-1`, extras: [] };
      const end = addMonths(item.due, EXTRA_HORIZON_YEARS * 12);
      const dates = [item.due];
      let state = { due: item.due, anchorDay: anchor as number | undefined };
      while (true) {
        const next = rollForward(state.due, item.period, "0000-01-01", anchor);
        if (next.due > end) break;
        dates.push(next.due);
        state = { due: next.due, anchorDay: next.anchorDay };
      }
      const regular = dates.filter((d) => dayOf(d) === anchor);
      return {
        start: regular[0] ?? item.due,
        rule: `${base};BYMONTHDAY=${anchor}`,
        extras: dates.filter((d) => dayOf(d) !== anchor),
      };
    }
  }
}

/** A relative trigger for `ALERT_HOUR` o'clock, `daysBefore` days before an all-day event. */
export function alarmTrigger(daysBefore: number): string {
  if (daysBefore === 0) return `PT${ALERT_HOUR}H`;
  const hours = 24 - ALERT_HOUR;
  const days = daysBefore - 1;
  return days === 0 ? `-PT${hours}H` : `-P${days}DT${hours}H`;
}

export function eventSummary(item: Item): string {
  // Birthdays and reminders read best as their own title ("Mum's birthday", "Dentist").
  if (item.type === "birthday" && !/birthday/i.test(item.title)) return `${item.title}'s birthday`;
  if (item.type === "birthday" || item.type === "reminder") return item.title;
  return `${item.title}: ${PHRASE[item.type]}`;
}

function eventLines(item: Item & { due: string }, stamp: string, options: CalendarOptions): string[] {
  const plan = schedule(item);
  return [
    ...singleEvent(item, `${item.slug}@life-admin-mcp`, plan.start, plan.rule, stamp, options),
    ...plan.extras.flatMap((date) =>
      singleEvent(item, `${item.slug}-${compactDate(date)}@life-admin-mcp`, date, undefined, stamp, options)
    ),
  ];
}

function singleEvent(
  item: Item & { due: string },
  uid: string,
  start: string,
  rule: string | undefined,
  stamp: string,
  options: CalendarOptions
): string[] {
  const summary = eventSummary(item);
  const description: string[] = [];
  if (!options.minimal) {
    if (item.provider) description.push(`Provider: ${item.provider}`);
    const cost = formatCost(item);
    if (cost) description.push(`Cost: ${cost}`);
  }
  if (item.auto_renews)
    description.push(`Renews automatically. Decide before each due date if you want to change or cancel it.`);
  description.push("From your Life Admin folder. References and notes stay on your computer.");

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `DTEND;VALUE=DATE:${compactDate(addDays(start, 1))}`,
  ];
  if (rule) lines.push(`RRULE:${rule}`);
  lines.push(
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description.join("\n"))}`,
    `CATEGORIES:${escapeText(item.type)}`,
    "TRANSP:TRANSPARENT"
  );

  const triggers = new Set([alarmTrigger(0)]);
  if (item.remind_days > 0) triggers.add(alarmTrigger(item.remind_days));
  for (const trigger of [...triggers].reverse()) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:${trigger}`,
      `DESCRIPTION:${escapeText(summary)}`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Build an .ics file for every item with a due date. Returns the text and how many events it holds. */
export function buildCalendar(
  items: Item[],
  now: Date = new Date(),
  options: CalendarOptions = {}
): { ics: string; events: number; skipped: number } {
  const dated = items
    .filter((i): i is Item & { due: string } => i.due !== undefined && i.type !== "income")
    .sort((a, b) => a.due.localeCompare(b.due) || a.slug.localeCompare(b.slug));
  const stamp = utcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Life Admin",
    ...dated.flatMap((item) => eventLines(item, stamp, options)),
    "END:VCALENDAR",
  ];
  return {
    ics: `${lines.map(foldLine).join("\r\n")}\r\n`,
    events: dated.length,
    skipped: items.filter((i) => i.due === undefined).length,
  };
}
