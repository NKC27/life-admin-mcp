import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  describeDays,
  dueStatus,
  nextOccurrence,
  rollForward,
  today,
} from "../src/dates.js";

test("daysInMonth knows leap years", () => {
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28, "century years are not leap years");
  assert.equal(daysInMonth(2000, 2), 29, "unless divisible by 400");
  assert.equal(daysInMonth(2027, 4), 30);
  assert.equal(daysInMonth(2027, 12), 31);
});

test("today uses local calendar date, and LIFE_ADMIN_TODAY overrides it", () => {
  // 00:30 on 1 July in local time is still 1 July, whatever UTC says.
  assert.equal(today({}, new Date(2027, 6, 1, 0, 30)), "2027-07-01");
  assert.equal(today({}, new Date(2027, 6, 1, 23, 59)), "2027-07-01");
  assert.equal(today({ LIFE_ADMIN_TODAY: "2026-11-11" }), "2026-11-11");
  assert.throws(() => today({ LIFE_ADMIN_TODAY: "11/11/2026" }), /YYYY-MM-DD/);
});

test("daysBetween and addDays cross month, year and clock-change boundaries", () => {
  assert.equal(daysBetween("2026-11-11", "2026-11-28"), 17);
  assert.equal(daysBetween("2026-11-28", "2026-11-11"), -17);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2027-03-27", "2027-03-29"), 2, "across the UK clocks going forward");
  assert.equal(daysBetween("2027-10-30", "2027-11-01"), 2, "across the UK clocks going back");
  assert.equal(daysBetween("2028-01-01", "2029-01-01"), 366);
  assert.equal(addDays("2027-03-03", -21), "2027-02-10");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("addMonths clamps to short months and honours the anchor day", () => {
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2027-02-28", 1, 31), "2027-03-31", "anchor brings it back to the 31st");
  assert.equal(addMonths("2027-11-30", 3), "2028-02-29");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28");
  assert.equal(addMonths("2029-02-28", 36, 29), "2032-02-29");
});

test("nextOccurrence for each period, and one-off refuses", () => {
  assert.equal(nextOccurrence("2027-03-03", "weekly"), "2027-03-10");
  assert.equal(nextOccurrence("2027-03-03", "monthly"), "2027-04-03");
  assert.equal(nextOccurrence("2027-03-03", "quarterly"), "2027-06-03");
  assert.equal(nextOccurrence("2027-03-03", "yearly"), "2028-03-03");
  assert.throws(() => nextOccurrence("2027-03-03", "one-off"), /does not repeat/);
});

test("rollForward moves on at least one period", () => {
  // Renewed early: the next one is a year after the old due date, not a year after today.
  assert.deepEqual(rollForward("2027-03-03", "yearly", "2027-02-20"), {
    due: "2028-03-03",
    periods: 1,
    anchorDay: undefined,
  });
});

test("rollForward skips past today when the date is stale", () => {
  const rolled = rollForward("2026-08-28", "monthly", "2026-11-11");
  assert.equal(rolled.due, "2026-11-28");
  assert.equal(rolled.periods, 3);
});

test("rollForward on the due date itself moves to the next period", () => {
  assert.equal(rollForward("2026-11-11", "monthly", "2026-11-11").due, "2026-12-11");
});

test("month-end schedules never drift: 31st stays the 31st where it exists", () => {
  let due = "2027-01-31";
  let anchor: number | undefined;
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = rollForward(due, "monthly", "2027-01-01", anchor);
    due = r.due;
    anchor = r.anchorDay;
    seen.push(due);
  }
  assert.deepEqual(seen, ["2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  assert.equal(anchor, 31);
});

test("a 29 February yearly renewal returns to the 29th in leap years", () => {
  let due = "2028-02-29";
  let anchor: number | undefined;
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = rollForward(due, "yearly", "2028-01-01", anchor);
    due = r.due;
    anchor = r.anchorDay;
    seen.push(due);
  }
  assert.deepEqual(seen, ["2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
});

test("weekly schedules ignore anchor days", () => {
  assert.deepEqual(rollForward("2027-01-31", "weekly", "2027-01-01"), {
    due: "2027-02-07",
    periods: 1,
    anchorDay: undefined,
  });
});

test("dueStatus works out days left, overdue and the reminder window", () => {
  const s = dueStatus("2027-03-03", "2027-02-10", 21);
  assert.deepEqual(s, { daysLeft: 21, overdue: false, remindFrom: "2027-02-10", remindersOn: true });
  assert.equal(dueStatus("2027-03-03", "2027-02-09", 21).remindersOn, false);
  const late = dueStatus("2026-11-01", "2026-11-11", 14);
  assert.equal(late.overdue, true);
  assert.equal(late.daysLeft, -10);
  assert.equal(late.remindersOn, true);
  assert.equal(dueStatus("2026-11-11", "2026-11-11", 0).overdue, false, "due today is not overdue");
});

test("describeDays reads naturally", () => {
  assert.equal(describeDays(0), "today");
  assert.equal(describeDays(1), "tomorrow");
  assert.equal(describeDays(17), "in 17 days");
  assert.equal(describeDays(-1), "1 day ago");
  assert.equal(describeDays(-10), "10 days ago");
});
