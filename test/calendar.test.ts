import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import ICAL from "ical.js";

import { alarmTrigger, buildCalendar, escapeText, foldLine, schedule } from "../src/calendar.js";
import { rollForward } from "../src/dates.js";
import type { Item, Period } from "../src/types.js";

const NOW = new Date("2026-11-16T10:00:00Z");

function item(overrides: Partial<Item> & Pick<Item, "slug" | "title">): Item {
  return {
    type: "bill",
    currency: "GBP",
    period: "one-off",
    remind_days: 14,
    auto_renews: false,
    tags: [],
    created: "",
    updated: "",
    body: "",
    path: `/x/${overrides.slug}.md`,
    ...overrides,
  };
}

function events(ics: string): ICAL.Event[] {
  const comp = new ICAL.Component(ICAL.parse(ics));
  return comp.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
}

/**
 * The first `count` dates an independent iCalendar implementation produces from the whole file:
 * every event, with repeats expanded, merged in date order.
 */
function expand(ics: string, count: number): string[] {
  const dates: string[] = [];
  for (const event of events(ics)) {
    const it = event.iterator();
    let next: ICAL.Time | null;
    let n = 0;
    while (n++ < count && (next = it.next())) dates.push(next.toString());
  }
  return [...new Set(dates)].sort().slice(0, count);
}

/** The same `count` dates from repeatedly marking the item handled. */
function rolled(due: string, period: Period, count: number, anchorDay?: number): string[] {
  const dates = [due];
  let anchor = anchorDay;
  while (dates.length < count) {
    const r = rollForward(dates[dates.length - 1]!, period, "1900-01-01", anchor);
    anchor = r.anchorDay;
    dates.push(r.due);
  }
  return dates;
}

test("escapeText escapes the characters iCalendar reserves", () => {
  assert.equal(escapeText("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
});

test("foldLine keeps every line within 75 octets without splitting characters", () => {
  const long = `SUMMARY:${"£".repeat(60)}${"é".repeat(30)}🚗 end`;
  const folded = foldLine(long);
  for (const line of folded.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);
  assert.equal(folded.replace(/\r\n /g, ""), long, "unfolding gives back the original");
  assert.doesNotMatch(folded, /�/);
  assert.equal(foldLine("SHORT:line"), "SHORT:line");
});

test("alarm triggers fire at 9am the right number of days before", () => {
  assert.equal(alarmTrigger(0), "PT9H");
  assert.equal(alarmTrigger(1), "-PT15H");
  assert.equal(alarmTrigger(21), "-P20DT15H");
  // Check the arithmetic: start of the all-day event plus the trigger is 09:00, N days earlier.
  for (const days of [0, 1, 7, 21, 180]) {
    const seconds = ICAL.Duration.fromString(alarmTrigger(days)).toSeconds();
    assert.equal(seconds, -days * 86400 + 9 * 3600, `${days} days`);
  }
});

test("schedule uses only widely supported repeat rules", () => {
  const plan = (due: string, period: Period, anchor_day?: number) =>
    schedule({ ...item({ slug: "x", title: "X", period, anchor_day }), due });
  assert.deepEqual(plan("2027-03-03", "one-off"), { start: "2027-03-03", extras: [] });
  assert.deepEqual(plan("2027-03-03", "weekly"), { start: "2027-03-03", rule: "FREQ=WEEKLY", extras: [] });
  assert.deepEqual(plan("2027-03-03", "monthly"), { start: "2027-03-03", rule: "FREQ=MONTHLY", extras: [] });
  assert.equal(plan("2027-01-31", "monthly").rule, "FREQ=MONTHLY;BYMONTHDAY=-1");
  assert.equal(plan("2027-02-28", "quarterly", 31).rule, "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1");
  assert.equal(plan("2028-02-29", "yearly").rule, "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1");
  assert.equal(plan("2027-03-31", "yearly").rule, "FREQ=YEARLY");

  // The 30th: repeat on the 30th, and list each February separately.
  const thirtieth = plan("2027-02-28", "monthly", 30);
  assert.equal(thirtieth.rule, "FREQ=MONTHLY;BYMONTHDAY=30");
  assert.equal(thirtieth.start, "2027-03-30", "the main event starts on a date its rule produces");
  assert.deepEqual(thirtieth.extras.slice(0, 3), ["2027-02-28", "2028-02-29", "2029-02-28"]);
  // The 29th only falls short in non-leap Februaries.
  assert.deepEqual(plan("2027-01-29", "monthly").extras.slice(0, 3), ["2027-02-28", "2029-02-28", "2030-02-28"]);
  for (const s of [thirtieth, plan("2027-01-29", "monthly")]) assert.ok(s.extras.length <= 6, "five-year horizon");
  assert.doesNotMatch(JSON.stringify([thirtieth, plan("2027-01-31", "monthly")]), /BYSETPOS/);
});

const CASES: Array<[string, string, Period, number?]> = [
  ["monthly on the 15th", "2027-01-15", "monthly"],
  ["monthly on the 31st", "2027-01-31", "monthly"],
  ["monthly on the 30th", "2027-01-30", "monthly"],
  ["monthly on the 29th through a non-leap February", "2027-01-29", "monthly"],
  ["quarterly from 30 November", "2026-11-30", "quarterly"],
  ["quarterly from 31 August", "2027-08-31", "quarterly"],
  ["monthly on the 30th, already clamped to February", "2027-02-28", "monthly", 30],
  ["yearly on 29 February", "2028-02-29", "yearly"],
  ["yearly on 31 March", "2027-03-31", "yearly"],
  ["weekly across a year end", "2026-12-24", "weekly"],
];

for (const [label, due, period, anchor_day] of CASES) {
  test(`calendar repeats match mark_handled exactly: ${label}`, () => {
    const { ics } = buildCalendar([item({ slug: "x", title: "X", due, period, anchor_day })], NOW);
    // Monthly and quarterly rules for the 29th/30th list Februaries five years ahead; stay inside that.
    const count = period === "yearly" ? 9 : period === "quarterly" ? 18 : 26;
    assert.deepEqual(expand(ics, count), rolled(due, period, count, anchor_day));
  });
}

test("a schedule already clamped to the 28th keeps returning to the 31st", () => {
  const clamped = item({ slug: "rent", title: "Rent", due: "2027-02-28", period: "monthly", anchor_day: 31 });
  const { ics } = buildCalendar([clamped], NOW);
  assert.deepEqual(expand(ics, 4), ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
});

test("the calendar file is well formed for strict importers", () => {
  const items = [
    item({
      slug: "car-insurance",
      title: "Car insurance",
      type: "policy",
      due: "2027-03-03",
      period: "yearly",
      cost: 412,
      provider: "Example Motor, Ltd; UK",
      auto_renews: true,
      remind_days: 21,
    }),
    item({ slug: "passport", title: "Passport", type: "document", due: "2031-08-20", remind_days: 0 }),
    item({ slug: "notes-only", title: "Notes only", type: "document" }),
  ];
  const { ics, events: count, skipped } = buildCalendar(items, NOW);
  assert.equal(count, 2);
  assert.equal(skipped, 1);
  assert.ok(ics.endsWith("\r\n"));
  assert.doesNotMatch(ics.replace(/\r\n/g, ""), /[\r\n]/, "CRLF line endings only");
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 75, line);

  const parsed = events(ics);
  assert.deepEqual(
    parsed.map((e) => [e.uid, e.summary, e.startDate.toString(), e.endDate.toString()]),
    [
      ["car-insurance@life-admin-mcp", "Car insurance: renews", "2027-03-03", "2027-03-04"],
      ["passport@life-admin-mcp", "Passport: expires", "2031-08-20", "2031-08-21"],
    ]
  );
  assert.ok(parsed[0]!.startDate.isDate, "all-day event");
  assert.match(parsed[0]!.description, /Provider: Example Motor, Ltd; UK/, "commas and semicolons survive");
  assert.match(parsed[0]!.description, /Cost: £412\.00\/year/);
  assert.match(parsed[0]!.description, /Decide before each due date/);

  const alarms = (e: ICAL.Event) =>
    e.component.getAllSubcomponents("valarm").map((a) => String(a.getFirstPropertyValue("trigger")));
  assert.deepEqual(alarms(parsed[0]!).sort(), ["-P20DT15H", "PT9H"]);
  assert.deepEqual(alarms(parsed[1]!), ["PT9H"], "no early alarm when remind_days is 0");
});

test("references and notes never reach the calendar; minimal drops provider and cost too", () => {
  const secret = item({
    slug: "broadband",
    title: "Broadband",
    due: "2027-01-10",
    provider: "Example Broadband",
    cost: 30,
    period: "monthly",
    ref: "…7731",
    body: "Account password hint: blue door. ## History\n- 2026-01-10 Started",
  });
  const full = buildCalendar([secret], NOW).ics;
  assert.doesNotMatch(full, /7731|blue door|History/);
  assert.match(full, /Example Broadband/);

  const minimal = buildCalendar([secret], NOW, { minimal: true }).ics;
  assert.doesNotMatch(minimal, /Example Broadband|£30/);
  assert.match(minimal, /SUMMARY:Broadband: payment due/);
});

test("the same items always give the same UIDs, so re-imports update instead of duplicating", () => {
  const items = [item({ slug: "tv-licence", title: "TV licence", due: "2027-05-01", period: "yearly" })];
  const first = events(buildCalendar(items, NOW).ics)[0]!;
  const later = events(buildCalendar([{ ...items[0]!, due: "2028-05-01" }], new Date()).ics)[0]!;
  assert.equal(first.uid, later.uid);
});
