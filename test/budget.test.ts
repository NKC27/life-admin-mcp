import { test } from "node:test";
import assert from "node:assert/strict";

import {
  endOfMonth,
  fullMonths,
  moneyAhead,
  monthlyEquivalent,
  occurrences,
  periodRange,
  rainyDayPlan,
  shopName,
  spendingSummary,
  startOfWeek,
} from "../src/budget.js";
import {
  workingDayOnOrBefore,
  isWorkingDay,
  upcomingHolidays,
  govCoverageEnd,
  holidaysBetween,
} from "../src/holidays.js";

const EW = { country: "GB", region: "ENG" };
const SCT = { country: "GB", region: "SCT" };
import { workingDayFor } from "../src/money-tools.js";
import { formatMoneyAhead, formatRainyDay, formatSpending, listMonths, notAdvice } from "../src/money-report.js";
import type { Category, Transaction } from "../src/money.js";
import type { Item } from "../src/types.js";

let n = 0;
function tx(date: string, amount: number, description: string, category: Category): Transaction {
  return { id: String(n++), date, amount, description, category, source: "bank" };
}

function item(o: Partial<Item> & Pick<Item, "title" | "type">): Item {
  return {
    slug: o.title.toLowerCase().replace(/\W+/g, "-"),
    currency: "GBP",
    period: "monthly",
    remind_days: 14,
    auto_renews: false,
    tags: [],
    created: "",
    updated: "",
    body: "",
    path: "",
    ...o,
  };
}

/** Three steady months (Aug-Oct 2026) of £2,000 in and £1,500 out, plus a few extras. */
function steadyMonths(): Transaction[] {
  const list: Transaction[] = [];
  for (const m of ["08", "09", "10"]) {
    list.push(tx(`2026-${m}-01`, -800, "MORTGAGE PAYMENT", "bills"));
    list.push(tx(`2026-${m}-05`, -400, "TESCO STORES", "groceries"));
    list.push(tx(`2026-${m}-10`, -100, "TFL TRAVEL", "transport"));
    list.push(tx(`2026-${m}-12`, -200, "THE RED LION", "going-out"));
    list.push(tx(`2026-${m}-25`, 2000, "SALARY", "income"));
    list.push(tx(`2026-${m}-26`, -100, "TO SAVINGS", "savings"));
  }
  return list;
}

test("periods: UK weeks start on Monday, months end correctly", () => {
  assert.equal(startOfWeek("2026-11-16"), "2026-11-16", "a Monday");
  assert.equal(startOfWeek("2026-11-22"), "2026-11-16", "the Sunday after");
  assert.deepEqual(periodRange("week", "2026-11-18", 1), { start: "2026-11-09", end: "2026-11-15" });
  assert.deepEqual(periodRange("month", "2026-11-18", 0), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(periodRange("month", "2027-01-05", 1), { start: "2026-12-01", end: "2026-12-31" });
  assert.equal(endOfMonth("2028-02-10"), "2028-02-29");
});

test("shopName gives short, readable names", () => {
  assert.equal(shopName("TESCO STORES 2041"), "Tesco Stores");
  assert.equal(shopName("THE RED LION"), "The Red Lion");
  assert.equal(shopName("AMAZON.CO.UK*MK2LP4"), "Amazon.co.uk");
  assert.equal(shopName("TFL TRAVEL CHARGE"), "TFL Travel Charge");
  assert.equal(shopName("COUNCIL TAX DD EXAMPLE BOROUGH"), "Council Tax Example");
  assert.equal(shopName("CARD PAYMENT TO COSTA COFFEE 18832"), "Costa Coffee");
});

test("spendingSummary totals a month, compares with usual, and handles refunds and savings", () => {
  const list = [
    ...steadyMonths(),
    tx("2026-10-20", 30, "AMAZON REFUND", "shopping"),
    tx("2026-10-19", -80, "AMAZON", "shopping"),
  ];
  const s = spendingSummary(list, "2026-11-16", "month", 1);
  assert.deepEqual(s.range, { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(s.partial, false);
  const line = (c: Category) => s.lines.find((l) => l.category === c);
  assert.equal(line("bills")!.amount, 800);
  assert.equal(line("shopping")!.amount, 50, "£80 spent minus a £30 refund");
  assert.equal(line("going-out")!.usual, 200);
  assert.equal(s.moneyIn, 2000);
  assert.equal(s.saved, 100, "savings are not spending");
  assert.equal(s.total, 1550);
  assert.equal(s.history, 2, "August and September are fully covered; July is not");
  assert.equal(s.topShops[0]!.name, "Mortgage");
  const text = formatSpending(s);
  assert.match(text, /^October 2026 \(Thu 1 Oct to Sat 31 Oct\): £1,550 spent\. A usual month is about £1,500\./);
  assert.match(text, /Shopping: £50 \(usually nothing\)/);
});

test("spendingSummary says 'so far' for the current week and copes with no data", () => {
  const empty = spendingSummary([], "2026-11-18", "week");
  assert.equal(empty.partial, true);
  assert.equal(empty.history, 0);
  assert.match(formatSpending(empty), /This week so far.*No spending recorded/s);
});

test("occurrences lists every date of a repeating payment in a window", () => {
  const weekly = item({ title: "Cleaner", type: "bill", period: "weekly", due: "2026-11-02", cost: 30 });
  assert.deepEqual(occurrences({ ...weekly, due: weekly.due! }, "2026-11-10", "2026-11-30"), [
    "2026-11-16",
    "2026-11-23",
    "2026-11-30",
  ]);
  const yearly = item({ title: "TV licence", type: "renewal", period: "yearly", due: "2027-05-01", cost: 174.5 });
  assert.deepEqual(occurrences({ ...yearly, due: yearly.due! }, "2026-11-10", "2026-12-31"), []);
  assert.equal(monthlyEquivalent(174.5, "yearly").toFixed(2), "14.54");
  assert.equal(monthlyEquivalent(30, "weekly"), 130);
});

test("moneyAhead: bills before payday, with Christmas Day pay arriving the day before", () => {
  const items = [
    item({ title: "Salary", type: "income", due: "2026-11-25", cost: 2000 }),
    item({ title: "Energy", type: "bill", due: "2026-11-18", cost: 96, auto_renews: true }),
    item({ title: "Phone", type: "bill", due: "2026-12-24", cost: 18 }),
    item({ title: "Water", type: "bill", due: "2026-12-20" }),
    item({ title: "Old gym", type: "subscription", due: "2026-10-03", cost: 40 }),
    item({ title: "Passport", type: "document", due: "2026-12-01", period: "one-off" }),
  ];
  // On 1 December the next payday is 25 December 2026, a Friday and Christmas Day.
  const m = moneyAhead(items, "2026-12-01", { balance: 500, workingDay: workingDayFor(EW) });
  assert.equal(m.payday!.date, "2026-12-24");
  assert.equal(m.payday!.scheduled, "2026-12-25");
  assert.equal(m.payday!.movedBecause, "Christmas Day");
  assert.equal(m.until, "2026-12-23");
  assert.deepEqual(
    m.bills.map((b) => [b.date, b.title]),
    [
      ["2026-12-03", "Old gym"],
      ["2026-12-18", "Energy"],
      ["2026-12-20", "Water"],
    ],
    "the phone bill on the 24th falls on payday itself, and passports are not payments"
  );
  assert.equal(m.total, 136);
  assert.equal(m.left, 364);
  assert.deepEqual(m.missingCosts, ["Water"]);
  assert.deepEqual(
    m.overdue.map((o) => o.title),
    ["Old gym", "Energy"],
    "dates already past are flagged for checking, as well as projected forward"
  );
  const text = formatMoneyAhead(m);
  assert.match(text, /Next payday: Salary, Thursday 24 December \(£2,000\)\./);
  assert.match(text, /due on Friday 25 December, but that's Christmas Day/);
  assert.match(text, /about £364 is left after these until payday/);
  assert.match(text, /Not counted, no amount recorded: Water/);
});

test("moneyAhead warns plainly when the bills come to more than the balance", () => {
  const items = [item({ title: "Rent", type: "bill", due: "2026-11-20", cost: 700 })];
  const m = moneyAhead(items, "2026-11-16", { balance: 200, days: 14 });
  assert.equal(m.payday, undefined);
  assert.equal(m.left, -500);
  assert.match(formatMoneyAhead(m), /£500 more than you have/);
});

test("bank holidays: official dates, weekends and paydays", () => {
  assert.ok(!isWorkingDay("2026-12-25", EW));
  assert.ok(!isWorkingDay("2026-12-28", EW), "Boxing Day substitute (26th is a Saturday)");
  assert.ok(isWorkingDay("2026-11-30", EW));
  assert.ok(!isWorkingDay("2026-11-30", SCT), "St Andrew's Day");
  assert.equal(workingDayOnOrBefore("2026-10-25", EW), "2026-10-23", "Sunday -> Friday");
  assert.equal(workingDayOnOrBefore("2026-12-28", EW), "2026-12-24");
  assert.deepEqual(
    upcomingHolidays("2026-12-01", 40, EW).map((h) => h.date),
    ["2026-12-25", "2026-12-28", "2027-01-01"]
  );
  assert.ok(govCoverageEnd() >= "2028-12-31");
});

test("fullMonths only counts months the records fully cover", () => {
  assert.deepEqual(
    fullMonths(steadyMonths(), "2026-11-16").map((r) => r.start),
    ["2026-10-01", "2026-09-01", "2026-08-01"]
  );
  assert.deepEqual(fullMonths([tx("2026-10-02", -5, "X", "other")], "2026-11-16"), [], "October starts on the 2nd");
  assert.equal(listMonths(["2026-10", "2026-09", "2026-08"]), "August, September and October 2026");
});

test("rainyDayPlan: options, risk checks, set-asides and goals from steady figures", () => {
  const items = [
    item({ title: "Salary", type: "income", due: "2026-11-25", cost: 2000 }),
    item({ title: "Car insurance", type: "policy", period: "yearly", due: "2027-03-03", cost: 360 }),
  ];
  const p = rainyDayPlan(steadyMonths(), items, { saved: 200, updated: "" }, "2026-11-16");
  assert.deepEqual(p.months, ["2026-10", "2026-09", "2026-08"]);
  assert.deepEqual(p.income, { monthly: 2000, source: "income items" });
  assert.deepEqual(p.spending, { monthly: 1500, source: "bank records" });
  assert.equal(p.setAsideTotal, 30, "£360 a year is £30 a month");
  assert.equal(p.leftOver, 470);
  assert.deepEqual(
    p.options.map((o) => [o.name, o.monthly, o.weekly, o.tightestMonthLeft, o.monthsToStarter]),
    [
      ["Gentle", 115, 26, 355, 7],
      ["Steady", 235, 54, 235, 4],
      ["Stretch", 350, 80, 120, 3],
    ]
  );
  assert.equal(p.essentialsMonthly, 1300);
  assert.equal(p.goals.threeMonths, 3900);
  assert.deepEqual(p.flags, []);
  const text = formatRainyDay(p);
  assert.match(text, /Car insurance: £360 yearly → £30 a month/);
  assert.match(text, /Steady: £235 a month \(about £54 a week\) · £1,000 pot in 4 month\(s\)/);
  assert.match(text, /average of August, September and October 2026/);
  assert.ok(text.endsWith(notAdvice()));
});

test("rainyDayPlan never suggests saving when more goes out than comes in", () => {
  const items = [item({ title: "Pension", type: "income", due: "2026-11-25", cost: 1400 })];
  const p = rainyDayPlan(steadyMonths(), items, null, "2026-11-16");
  assert.equal(p.leftOver, -100);
  assert.deepEqual(p.options, []);
  assert.match(p.flags.join(" "), /more goes out than comes in \(about £100 a month short/);
});

test("rainyDayPlan flags borrowing (but not a mortgage), varying income, big bills and missing income", () => {
  const list = steadyMonths().filter((t) => t.category !== "income");
  list.push(
    tx("2026-08-25", 1200, "SALARY", "income"),
    tx("2026-09-25", 2600, "SALARY", "income"),
    tx("2026-10-25", 2200, "SALARY", "income")
  );
  list.push(tx("2026-10-14", -45, "KLARNA*SHOP", "shopping"));
  const items = [item({ title: "Boiler service", type: "bill", period: "yearly", due: "2026-12-10", cost: 650 })];
  const p = rainyDayPlan(list, items, null, "2026-11-16");
  assert.equal(p.income!.source, "bank records");
  const flags = p.flags.join("\n");
  assert.match(flags, /look like borrowing \(Klarna Shop\)/);
  assert.doesNotMatch(flags, /Mortgage/);
  assert.match(flags, /income has varied a lot \(from £1,200 to £2,600/);
  assert.match(flags, /Boiler service \(£650\) is due on 2026-12-10/);

  const none = rainyDayPlan([], [], null, "2026-11-16");
  assert.equal(none.income, undefined);
  assert.match(none.flags.join(" "), /don't know your income/);
  assert.match(none.flags.join(" "), /no bank records yet/);
});

test("country and region settings accept the way people type them", async () => {
  const { parseCountry, parseRegion, settings } = await import("../src/locale.js");
  assert.equal(parseCountry("United Kingdom"), "GB");
  assert.equal(parseCountry("uk"), "GB");
  assert.equal(parseCountry("Scotland"), "GB");
  assert.equal(parseCountry("USA"), "US");
  assert.equal(parseCountry("ireland"), "IE");
  assert.equal(parseCountry("Deutschland"), undefined);
  assert.equal(parseCountry("Germany"), "DE");
  assert.equal(parseCountry("au"), "AU");
  assert.equal(parseRegion("GB", "Scotland"), "SCT");
  assert.equal(parseRegion("GB", "  northern ireland "), "NIR");
  assert.equal(parseRegion("GB", "NI"), "NIR");
  assert.equal(parseRegion("GB", "england and wales"), "ENG");
  assert.equal(parseRegion("US", "California"), "CA");
  assert.equal(parseRegion("US", "US-NY"), "NY");
  assert.equal(parseRegion("AU", "New South Wales"), "NSW");
  assert.equal(parseRegion("GB", "France"), undefined);

  // Before 1.1 only a UK region could be set; that still works.
  const old = settings({ LIFE_ADMIN_REGION: "Scotland" });
  assert.deepEqual([old.place.country, old.place.region, old.currency, old.label], ["GB", "SCT", "GBP", "Scotland"]);
  const none = settings({});
  assert.deepEqual(
    [none.place.country, none.currency, none.dateOrder, none.label],
    ["GB", "GBP", "DMY", "England and Wales"]
  );
  const us = settings({ LIFE_ADMIN_COUNTRY: "United States", LIFE_ADMIN_REGION: "California" });
  assert.deepEqual([us.currency, us.dateOrder, us.label], ["USD", "MDY", "California, United States"]);
  const ie = settings({ LIFE_ADMIN_COUNTRY: "Ireland" });
  assert.deepEqual([ie.currency, ie.dateOrder, ie.label], ["EUR", "DMY", "Ireland"]);
  const override = settings({ LIFE_ADMIN_COUNTRY: "Spain", LIFE_ADMIN_CURRENCY: "gbp" });
  assert.equal(override.currency, "GBP");
  const bad = settings({ LIFE_ADMIN_COUNTRY: "Narnia" });
  assert.equal(bad.place.country, "GB");
  assert.match(bad.unrecognised.join(), /Narnia/);
});

test("public holidays outside the UK come from the worldwide data", () => {
  const us = holidaysBetween({ country: "US" }, "2026-01-01", "2026-12-31").map((h) => h.date);
  assert.ok(us.includes("2026-07-03"), "Independence Day (4 July is a Saturday) observed on Friday 3rd");
  assert.ok(us.includes("2026-11-26"), "Thanksgiving");
  assert.ok(!us.includes("2026-12-26"), "no Boxing Day in the US");
  const ie = holidaysBetween({ country: "IE" }, "2026-03-01", "2026-03-31").map((h) => h.date);
  assert.ok(ie.includes("2026-03-17"), "St Patrick's Day");
  assert.ok(!isWorkingDay("2026-07-03", { country: "US" }));
  assert.ok(isWorkingDay("2026-11-30", { country: "US" }));
  assert.equal(workingDayOnOrBefore("2026-03-17", { country: "IE" }), "2026-03-16");
  // UK dates past the bundled gov.uk list still come out
  assert.ok(!isWorkingDay("2030-12-25", EW));
});

test("money is shown in the person's currency and style", async () => {
  const { formatMoney, money } = await import("../src/util.js");
  assert.equal(money(100, "GBP", "GB"), "£100");
  assert.equal(money(10.5, "GBP", "GB"), "£10.50");
  assert.equal(money(1234, "USD", "US"), "$1,234");
  assert.match(money(12.5, "EUR", "IE"), /^€12\.50$/);
  assert.equal(formatMoney(5, "GBP", "GB"), "£5.00");
});

test("dates read the same on every Node version (no Intl date formatting)", async () => {
  const { shortDate, longDate, monthYear } = await import("../src/money-report.js");
  assert.equal(shortDate("2026-11-10"), "Tue 10 Nov");
  assert.equal(shortDate("2027-01-01"), "Fri 1 Jan");
  assert.equal(longDate("2026-12-25"), "Friday 25 December");
  assert.equal(longDate("2028-02-29"), "Tuesday 29 February");
  assert.equal(monthYear("2026-10-01"), "October 2026");
});
