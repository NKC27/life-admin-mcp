import { addDays, addMonths, rollForward } from "./dates.js";
import { CATEGORIES, ESSENTIALS, SPENDING, roundPence, type Category, type Pot, type Transaction } from "./money.js";
import type { Item, ItemType, Period } from "./types.js";

// Budget arithmetic on the person's own records. Pure functions: no files, no clock (today is passed
// in), so the same numbers feed the chat tools, the terminal and the home screen.

// ---------------------------------------------------------------------------
// periods
// ---------------------------------------------------------------------------

/** 0 = Monday ... 6 = Sunday (UK weeks start on Monday). */
function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekday(date));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

export type PeriodKind = "week" | "month";

export interface Range {
  start: string;
  end: string;
}

/** This week/month (offset 0), last week/month (offset 1), and so on. */
export function periodRange(kind: PeriodKind, todayDate: string, offset = 0): Range {
  if (kind === "week") {
    const start = addDays(startOfWeek(todayDate), -7 * offset);
    return { start, end: addDays(start, 6) };
  }
  const start = addMonths(startOfMonth(todayDate), -offset);
  return { start, end: endOfMonth(start) };
}

function inRange(t: Transaction, r: Range): boolean {
  return t.date >= r.start && t.date <= r.end;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Totals per category for a range, as positive numbers: money spent for spending categories
 * (refunds reduce it), money moved into savings, and money received for income.
 */
export function totalsByCategory(transactions: Transaction[], range: Range): Map<Category, number> {
  const totals = new Map<Category, number>();
  for (const t of transactions) {
    if (!inRange(t, range) || t.category === "transfers") continue;
    const value = t.category === "income" ? t.amount : -t.amount;
    totals.set(t.category, (totals.get(t.category) ?? 0) + value);
  }
  return totals;
}

function earliestDate(transactions: Transaction[]): string | undefined {
  let earliest: string | undefined;
  for (const t of transactions) if (!earliest || t.date < earliest) earliest = t.date;
  return earliest;
}

/** Banking shorthand that says nothing about who was paid. */
const NOISE = new Set([
  "DD",
  "DIRECT",
  "DEBIT",
  "PAYMENT",
  "PAYMENTS",
  "CARD",
  "TO",
  "FROM",
  "POS",
  "CONTACTLESS",
  "VIS",
  "VISA",
  "BGC",
  "FPO",
  "FPI",
  "SO",
  "STO",
  "TFR",
  "TRANSFER",
  "REF",
  "ON",
  "AT",
]);

/** "Tesco", "The Red Lion", "TFL": title case, keeping vowel-less abbreviations in capitals. */
function readable(word: string): string {
  if (!/[AEIOUY]/.test(word)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * A short, readable shop name from a bank description: "TESCO STORES 2041" -> "Tesco Stores",
 * "THE RED LION" -> "The Red Lion", "COUNCIL TAX DD EXAMPLE" -> "Council Tax Example".
 * Stops at the first word with digits in it (branch numbers, references) and keeps three words at most.
 */
export function shopName(description: string): string {
  const words: string[] = [];
  for (const raw of description.toUpperCase().replace(/[*#]/g, " ").split(/\s+/)) {
    if (!raw) continue;
    if (/\d/.test(raw)) break;
    if (NOISE.has(raw)) continue;
    words.push(readable(raw));
    if (words.length === 3) break;
  }
  return words.join(" ") || description.trim();
}

// ---------------------------------------------------------------------------
// spending summary
// ---------------------------------------------------------------------------

export interface CategoryLine {
  category: Category;
  label: string;
  amount: number;
  /** Average over up to four earlier periods that the records fully cover. */
  usual?: number;
}

export interface SpendingSummary {
  kind: PeriodKind;
  range: Range;
  /** True while the period is still running (figures are "so far"). */
  partial: boolean;
  lines: CategoryLine[];
  total: number;
  usualTotal?: number;
  moneyIn: number;
  saved: number;
  topShops: Array<{ name: string; amount: number }>;
  /** How many earlier periods the "usual" figures are based on. */
  history: number;
  transactions: number;
}

export function spendingSummary(
  transactions: Transaction[],
  todayDate: string,
  kind: PeriodKind,
  offset = 0
): SpendingSummary {
  const range = periodRange(kind, todayDate, offset);
  const current = totalsByCategory(transactions, range);
  const earliest = earliestDate(transactions);
  const earlier = [1, 2, 3, 4]
    .map((i) => periodRange(kind, todayDate, offset + i))
    .filter((r) => earliest !== undefined && earliest <= r.start);
  const usualMaps = earlier.map((r) => totalsByCategory(transactions, r));

  const lines: CategoryLine[] = SPENDING.map((category) => ({
    category,
    label: CATEGORIES[category],
    amount: roundPence(current.get(category) ?? 0),
    usual: usualMaps.length ? roundPence(average(usualMaps.map((m) => m.get(category) ?? 0))) : undefined,
  }))
    .filter((l) => l.amount !== 0 || (l.usual ?? 0) !== 0)
    .sort((a, b) => b.amount - a.amount || (b.usual ?? 0) - (a.usual ?? 0));

  const shops = new Map<string, number>();
  for (const t of transactions) {
    if (!inRange(t, range) || !SPENDING.includes(t.category)) continue;
    const name = shopName(t.description);
    shops.set(name, (shops.get(name) ?? 0) - t.amount);
  }

  return {
    kind,
    range,
    partial: range.end >= todayDate,
    lines,
    total: roundPence(lines.reduce((s, l) => s + l.amount, 0)),
    usualTotal: usualMaps.length ? roundPence(lines.reduce((s, l) => s + (l.usual ?? 0), 0)) : undefined,
    moneyIn: roundPence(current.get("income") ?? 0),
    saved: roundPence(current.get("savings") ?? 0),
    topShops: [...shops]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount: roundPence(amount) })),
    history: usualMaps.length,
    transactions: transactions.filter((t) => inRange(t, range)).length,
  };
}

// ---------------------------------------------------------------------------
// money ahead: bills before payday
// ---------------------------------------------------------------------------

/** Item types that are payments going out. */
export const PAYMENT_TYPES: ItemType[] = ["bill", "subscription", "policy", "renewal", "vehicle"];

/** The first occurrence of a repeating date on or after `date` (one-off dates are returned as they are). */
export function nextOnOrAfter(due: string, period: Period, date: string, anchorDay?: number): string {
  if (due >= date || period === "one-off") return due;
  return rollForward(due, period, addDays(date, -1), anchorDay).due;
}

/** Every occurrence of an item's date from `from` to `to` inclusive. */
export function occurrences(item: Item & { due: string }, from: string, to: string): string[] {
  if (item.period === "one-off") return item.due >= from && item.due <= to ? [item.due] : [];
  const dates: string[] = [];
  let date = nextOnOrAfter(item.due, item.period, from, item.anchor_day);
  let anchor = item.anchor_day;
  while (date <= to && dates.length < 400) {
    dates.push(date);
    const next = rollForward(date, item.period, date, anchor);
    anchor = next.anchorDay ?? anchor;
    date = next.due;
  }
  return dates;
}

/** Cost per month for a repeating cost. */
export function monthlyEquivalent(cost: number, period: Period): number {
  switch (period) {
    case "weekly":
      return (cost * 52) / 12;
    case "monthly":
      return cost;
    case "quarterly":
      return cost / 3;
    case "yearly":
      return cost / 12;
    case "one-off":
      return 0;
  }
}

export interface UpcomingBill {
  date: string;
  title: string;
  amount?: number;
  autoRenews: boolean;
}

export interface MoneyAhead {
  today: string;
  /** Last day covered (the day before payday, or today + days). */
  until: string;
  payday?: {
    /** When the money is expected: moved to the working day before if the scheduled date is not one. */
    date: string;
    /** The scheduled date, when it differs from `date`. */
    scheduled?: string;
    /** Why it moved, e.g. "Saturday" or "Christmas Day". */
    movedBecause?: string;
    title: string;
    amount?: number;
  };
  bills: UpcomingBill[];
  /** Payments whose due date has passed without being marked handled: maybe paid, maybe not. */
  overdue: UpcomingBill[];
  total: number;
  missingCosts: string[];
  balance?: number;
  left?: number;
}

export function moneyAhead(
  items: Item[],
  todayDate: string,
  options: {
    balance?: number;
    days?: number;
    /** Maps a date to the working day on or before it, with the reason it moved (weekends, bank holidays). */
    workingDay?: (date: string) => { date: string; reason?: string };
  } = {}
): MoneyAhead {
  const dated = items.filter((i): i is Item & { due: string } => i.due !== undefined);
  const tomorrow = addDays(todayDate, 1);
  const paydays = dated
    .filter((i) => i.type === "income")
    .map((i) => ({ item: i, date: nextOnOrAfter(i.due, i.period, tomorrow, i.anchor_day) }))
    .filter((p) => p.date >= tomorrow)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = options.days === undefined ? paydays[0] : undefined;
  // Pay due on a weekend or bank holiday usually arrives the working day before.
  const shifted = next && options.workingDay ? options.workingDay(next.date) : undefined;
  const payDate = shifted && shifted.date >= tomorrow ? shifted.date : next?.date;
  const until = payDate ? addDays(payDate, -1) : addDays(todayDate, options.days ?? 30);

  const bills: UpcomingBill[] = [];
  const overdue: UpcomingBill[] = [];
  for (const item of dated.filter((i) => PAYMENT_TYPES.includes(i.type))) {
    const entry = { title: item.title, amount: item.cost, autoRenews: item.auto_renews };
    if (item.due < todayDate) overdue.push({ ...entry, date: item.due });
    for (const date of occurrences(item, todayDate, until)) bills.push({ ...entry, date });
  }
  bills.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  overdue.sort((a, b) => a.date.localeCompare(b.date));

  const total = roundPence(bills.reduce((s, b) => s + (b.amount ?? 0), 0));
  return {
    today: todayDate,
    until,
    payday:
      next && payDate
        ? {
            date: payDate,
            scheduled: payDate !== next.date ? next.date : undefined,
            movedBecause: payDate !== next.date ? shifted?.reason : undefined,
            title: next.item.title,
            amount: next.item.cost,
          }
        : undefined,
    bills,
    overdue,
    total,
    missingCosts: [...new Set(bills.filter((b) => b.amount === undefined).map((b) => b.title))],
    balance: options.balance,
    left: options.balance === undefined ? undefined : roundPence(options.balance - total),
  };
}

// ---------------------------------------------------------------------------
// rainy-day plan
// ---------------------------------------------------------------------------

export const STARTER_POT = 1000;

const BORROWING =
  /\b(KLARNA|CLEARPAY|LAYBUY|PAY IN 3|OVERDRAFT|PAYDAY LOAN|CASH ADVANCE|LOAN|LOANS|CREDIT CARD|BARCLAYCARD|CAPITAL ONE|VANQUIS|AQUA CARD)\b/;

export interface PlanOption {
  name: "Gentle" | "Steady" | "Stretch";
  share: number;
  monthly: number;
  weekly: number;
  /** In the leanest recent month, what would have been left after bills, spending, set-asides and this. */
  tightestMonthLeft?: number;
  monthsToStarter?: number;
  monthsToThreeMonths?: number;
}

export interface RainyDayPlan {
  /** Full calendar months of records the averages use (YYYY-MM). */
  months: string[];
  income?: { monthly: number; source: "income items" | "bank records" };
  spending: { monthly: number; source: "bank records" | "tracked bills only" };
  essentialsMonthly: number;
  setAsides: Array<{ title: string; cost: number; period: Period; monthly: number; due?: string }>;
  setAsideTotal: number;
  leftOver?: number;
  options: PlanOption[];
  flags: string[];
  ideas: string[];
  pot: { saved: number; target?: number };
  goals: { starter: number; threeMonths: number };
}

interface MonthStats {
  month: string;
  moneyIn: number;
  spending: number;
  essentials: number;
  byCategory: Map<Category, number>;
}

/** Up to `max` most recent complete calendar months before today's month that the records fully cover. */
export function fullMonths(transactions: Transaction[], todayDate: string, max = 3): Range[] {
  const earliest = earliestDate(transactions);
  if (!earliest) return [];
  const months: Range[] = [];
  for (let offset = 1; offset <= 24 && months.length < max; offset++) {
    const range = periodRange("month", todayDate, offset);
    if (earliest > range.start) break;
    months.push(range);
  }
  return months;
}

function monthStats(transactions: Transaction[], range: Range): MonthStats {
  const byCategory = totalsByCategory(transactions, range);
  const sum = (cats: Category[]) => cats.reduce((s, c) => s + (byCategory.get(c) ?? 0), 0);
  return {
    month: range.start.slice(0, 7),
    moneyIn: byCategory.get("income") ?? 0,
    spending: sum(SPENDING),
    essentials: sum(ESSENTIALS),
    byCategory,
  };
}

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function rainyDayPlan(
  transactions: Transaction[],
  items: Item[],
  pot: Pot | null,
  todayDate: string
): RainyDayPlan {
  const ranges = fullMonths(transactions, todayDate);
  const stats = ranges.map((r) => monthStats(transactions, r));
  const flags: string[] = [];
  const ideas: string[] = [];

  // Income: what the person told us, or else what arrived in the bank.
  const incomeItems = items.filter((i) => i.type === "income" && i.cost !== undefined);
  let income: RainyDayPlan["income"];
  if (incomeItems.length) {
    income = {
      monthly: roundPence(incomeItems.reduce((s, i) => s + monthlyEquivalent(i.cost!, i.period), 0)),
      source: "income items",
    };
  } else if (stats.some((s) => s.moneyIn > 0)) {
    income = { monthly: roundPence(average(stats.map((s) => s.moneyIn))), source: "bank records" };
  }

  // Spending: the bank records, or else at least the bills being tracked.
  const payments = items.filter((i) => PAYMENT_TYPES.includes(i.type) && i.cost !== undefined);
  const trackedBills = payments.reduce((s, i) => s + monthlyEquivalent(i.cost!, i.period), 0);
  const spending: RainyDayPlan["spending"] = stats.length
    ? { monthly: roundPence(average(stats.map((s) => s.spending))), source: "bank records" }
    : { monthly: roundPence(trackedBills), source: "tracked bills only" };
  const essentialsMonthly = roundPence(stats.length ? average(stats.map((s) => s.essentials)) : trackedBills);

  // Big yearly and quarterly bills, smoothed into a monthly amount to put aside.
  const setAsides = payments
    .filter((i) => i.period === "yearly" || i.period === "quarterly")
    .map((i) => ({
      title: i.title,
      cost: i.cost!,
      period: i.period,
      monthly: roundPence(monthlyEquivalent(i.cost!, i.period)),
      due: i.due,
    }))
    .sort((a, b) => b.monthly - a.monthly);
  const setAsideTotal = roundPence(setAsides.reduce((s, a) => s + a.monthly, 0));

  const leftOver = income ? roundPence(income.monthly - spending.monthly - setAsideTotal) : undefined;
  const saved = pot?.saved ?? 0;
  const goals = { starter: STARTER_POT, threeMonths: Math.round(essentialsMonthly * 3) };
  const monthsTo = (goal: number, monthly: number) =>
    monthly > 0 ? Math.max(0, Math.ceil((goal - saved) / monthly)) : undefined;

  const options: PlanOption[] = [];
  if (leftOver !== undefined && leftOver > 0) {
    for (const [name, share] of [
      ["Gentle", 0.25],
      ["Steady", 0.5],
      ["Stretch", 0.75],
    ] as const) {
      const monthly = Math.floor((leftOver * share) / 5) * 5;
      if (monthly < 5) continue;
      const tightest = stats.length
        ? Math.min(
            ...stats.map((s) => (s.moneyIn > 0 ? s.moneyIn : income!.monthly) - s.spending - setAsideTotal - monthly)
          )
        : undefined;
      options.push({
        name,
        share,
        monthly,
        weekly: Math.floor((monthly * 12) / 52),
        tightestMonthLeft: tightest === undefined ? undefined : roundPence(tightest),
        monthsToStarter: monthsTo(goals.starter, monthly),
        monthsToThreeMonths: monthsTo(goals.threeMonths, monthly),
      });
    }
  }

  // ---- risk flags ----
  if (!income) {
    flags.push(
      "I don't know your income yet. Add it as an income item (for example your pay or pension) to get a plan."
    );
  } else if (leftOver !== undefined && leftOver <= 0) {
    flags.push(
      `On these figures, more goes out than comes in (about ${money(-leftOver)} a month short, counting set-asides for big bills), so there is nothing safe to put away yet. MoneyHelper's free budget planner can help find room.`
    );
  }
  if (stats.length < 2) {
    flags.push(
      stats.length
        ? "This is based on one month of bank records. Import two or three months for a fairer picture."
        : "There are no bank records yet, so spending is estimated from your tracked bills only. Import a bank statement for a real picture."
    );
  }
  const inflows = stats.map((s) => s.moneyIn).filter((v) => v > 0);
  if (inflows.length >= 2) {
    const mean = average(inflows);
    const spread = Math.sqrt(average(inflows.map((v) => (v - mean) ** 2)));
    if (mean > 0 && spread / mean > 0.2)
      flags.push(
        `Your income has varied a lot (from ${money(Math.min(...inflows))} to ${money(Math.max(...inflows))} a month). The Gentle option leaves more room for a lean month.`
      );
  }
  if (stats.length >= 2) {
    const [last, ...earlier] = stats;
    const before = average(earlier.map((s) => s.spending));
    if (before > 0 && last!.spending > before * 1.15)
      flags.push(
        `Spending went up last month (${money(last!.spending)}, against about ${money(before)} before). Worth a look before committing to a bigger amount.`
      );
  }
  const recent = transactions.filter((t) => t.amount < 0 && t.date >= (ranges.at(-1)?.start ?? todayDate));
  const borrowing = [
    ...new Set(recent.filter((t) => BORROWING.test(t.description.toUpperCase())).map((t) => shopName(t.description))),
  ];
  if (borrowing.length)
    flags.push(
      `Some payments look like borrowing (${borrowing.slice(0, 3).join(", ")}). If you are borrowing to cover everyday costs, paying off expensive debt usually comes before saving. StepChange (stepchange.org) gives free, confidential debt advice.`
    );
  if (income) {
    const soon = addDays(todayDate, 60);
    for (const i of payments) {
      if (!i.due || i.cost! < income.monthly * 0.25) continue;
      const date = nextOnOrAfter(i.due, i.period, todayDate, i.anchor_day);
      if (date <= soon)
        flags.push(`${i.title} (${money(i.cost!)}) is due on ${date}. Make sure it is covered before saving extra.`);
    }
  }

  // ---- where the money could come from ----
  if (stats.length >= 2) {
    const [last, ...earlier] = stats;
    for (const category of ["going-out", "shopping", "subscriptions", "other"] as Category[]) {
      const now = last!.byCategory.get(category) ?? 0;
      const before = average(earlier.map((s) => s.byCategory.get(category) ?? 0));
      if (now - before >= 20 && now > before * 1.2)
        ideas.push(`${CATEGORIES[category]} was ${money(now)} last month, against about ${money(before)} before.`);
    }
  }
  const subscriptions = items.filter((i) => i.type === "subscription" && i.cost !== undefined);
  if (subscriptions.length) {
    const total = subscriptions.reduce((s, i) => s + monthlyEquivalent(i.cost!, i.period), 0);
    ideas.push(
      `Your ${subscriptions.length} tracked subscription(s) come to about ${money(total)} a month. Any you no longer use?`
    );
  }
  for (const i of subscriptions.filter((s) => /was £/.test(s.body)))
    ideas.push(`${i.title} has gone up in price before. Worth checking for a cheaper plan.`);

  return {
    months: ranges.map((r) => r.start.slice(0, 7)),
    income,
    spending,
    essentialsMonthly,
    setAsides,
    setAsideTotal,
    leftOver,
    options,
    flags,
    ideas,
    pot: { saved, target: pot?.target },
    goals,
  };
}
