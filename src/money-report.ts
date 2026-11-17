import type { MoneyAhead, RainyDayPlan, SpendingSummary } from "./budget.js";
import { formatMoney } from "./util.js";

// Plain-English text for the money tools and the `money` command.

export const NOT_ADVICE =
  "This is arithmetic on your own figures, not financial advice. For free, impartial money guidance: " +
  "MoneyHelper (moneyhelper.org.uk).";

/** £100 for whole pounds, £10.99 otherwise. */
const gbp = (n: number) => formatMoney(n, "GBP").replace(/\.00$/, "");

// Dates are spelled out here rather than with Intl, because Node versions format en-GB dates
// differently ("Tue, 10 Nov" on older ones, "Tue 10 Nov" on newer), and Claude Desktop ships its own Node.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(date: string): { weekday: number; day: number; month: number; year: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth(), year: date.slice(0, 4) };
}

/** "Mon 16 Nov" */
export function shortDate(date: string): string {
  const p = parts(date);
  return `${DAYS[p.weekday]!.slice(0, 3)} ${p.day} ${MONTHS[p.month]!.slice(0, 3)}`;
}

/** "Wednesday 25 November" */
export function longDate(date: string): string {
  const p = parts(date);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}

/** "October 2026" */
export function monthYear(date: string): string {
  const p = parts(date);
  return `${MONTHS[p.month]} ${p.year}`;
}

function compare(amount: number, usual: number | undefined, partial: boolean): string {
  if (usual === undefined) return "";
  if (partial) return ` (usual for a whole ${"period"}: ${gbp(usual)})`;
  if (usual === 0) return amount > 0 ? " (usually nothing)" : "";
  const diff = amount - usual;
  if (Math.abs(diff) < Math.max(5, usual * 0.1)) return ` (about usual)`;
  return diff > 0 ? ` (${gbp(diff)} more than usual)` : ` (${gbp(-diff)} less than usual)`;
}

export function formatSpending(s: SpendingSummary): string {
  const unit = s.kind === "week" ? "week" : "month";
  const monthName = monthYear(s.range.start);
  const which = s.partial
    ? `This ${unit} so far`
    : s.kind === "month"
      ? monthName
      : `The week of ${shortDate(s.range.start)}`;
  const lines = [
    `${which} (${shortDate(s.range.start)} to ${shortDate(s.range.end)}): ${gbp(s.total)} spent` +
      (s.usualTotal !== undefined ? `. A usual ${unit} is about ${gbp(s.usualTotal)}.` : "."),
  ];
  if (!s.transactions) {
    lines.push("", "No spending recorded for this period yet. Import a bank statement or tell me what you spent.");
    return lines.join("\n");
  }
  lines.push("");
  for (const l of s.lines) {
    const note = compare(l.amount, l.usual, s.partial).replace("period", unit);
    lines.push(`- ${l.label}: ${gbp(l.amount)}${note}`);
  }
  const extras: string[] = [];
  if (s.moneyIn) extras.push(`Money in: ${gbp(s.moneyIn)}`);
  if (s.saved) extras.push(`Put into savings: ${gbp(s.saved)}`);
  if (extras.length) lines.push("", extras.join(" · "));
  if (s.topShops.length) lines.push("", `Biggest: ${s.topShops.map((t) => `${t.name} ${gbp(t.amount)}`).join(", ")}`);
  if (s.history === 0) lines.push("", "Not enough earlier records yet to say what's usual.");
  return lines.join("\n");
}

export function formatMoneyAhead(m: MoneyAhead): string {
  const lines: string[] = [];
  if (m.payday) {
    const amount = m.payday.amount !== undefined ? ` (${gbp(m.payday.amount)})` : "";
    lines.push(`Next payday: ${m.payday.title}, ${longDate(m.payday.date)}${amount}.`);
    if (m.payday.scheduled)
      lines.push(
        `It is due on ${longDate(m.payday.scheduled)}, but that's ${m.payday.movedBecause ?? "not a working day"}, so it usually arrives the working day before. Check with your employer or pension provider if unsure.`
      );
  } else {
    lines.push(
      "No payday recorded, so this looks ahead to " +
        longDate(m.until) +
        ". Add your pay or pension as an income item to plan to payday."
    );
  }
  const window = `${shortDate(m.today)} to ${shortDate(m.until)}`;
  if (m.bills.length) {
    lines.push("", `Payments before then (${window}):`);
    for (const b of m.bills)
      lines.push(
        `- ${shortDate(b.date)} · ${b.title} · ${b.amount !== undefined ? gbp(b.amount) : "amount not recorded"}${b.autoRenews ? " · taken automatically" : ""}`
      );
    lines.push(`Total: ${gbp(m.total)}`);
  } else {
    lines.push("", `No tracked payments between ${window}.`);
  }
  if (m.left !== undefined) {
    lines.push(
      "",
      m.left >= 0
        ? `With ${gbp(m.balance!)} in the bank now, about ${gbp(m.left)} is left after these until payday.`
        : `With ${gbp(m.balance!)} in the bank now, these payments come to ${gbp(-m.left)} more than you have. Worth acting on now: contact the companies before the dates, or see MoneyHelper for help.`
    );
  }
  if (m.missingCosts.length) lines.push("", `Not counted, no amount recorded: ${m.missingCosts.join(", ")}.`);
  if (m.overdue.length)
    lines.push(
      "",
      `Past their date and not marked as handled (check whether these were paid): ${m.overdue.map((o) => `${o.title} (${o.date})`).join(", ")}.`
    );
  return lines.join("\n");
}

/** ["2026-10", "2026-09", "2026-08"] -> "August, September and October 2026" */
export function listMonths(months: string[]): string {
  const names = [...months].sort().map((m) => MONTHS[Number(m.slice(5, 7)) - 1]!);
  const year = [...months].sort().at(-1)?.slice(0, 4) ?? "";
  const joined = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return `${joined} ${year}`.trim();
}

export function formatRainyDay(p: RainyDayPlan): string {
  const lines: string[] = ["Rainy-day plan", ""];
  if (p.income) lines.push(`Money in: about ${gbp(p.income.monthly)} a month (from your ${p.income.source}).`);
  lines.push(
    `Usual spending: about ${gbp(p.spending.monthly)} a month` +
      (p.spending.source === "bank records"
        ? ` (average of ${listMonths(p.months)}).`
        : " (tracked bills only, so the real figure is probably higher).")
  );
  if (p.setAsides.length) {
    lines.push(
      `Big bills to put aside for: ${gbp(p.setAsideTotal)} a month, so they're ready when due:`,
      ...p.setAsides.map((a) => `  - ${a.title}: ${gbp(a.cost)} ${a.period} → ${gbp(a.monthly)} a month`),
      "  (If one was paid in the months above, it's already in your usual spending, so this is on the cautious side.)"
    );
  }
  if (p.leftOver !== undefined) lines.push(`Left over: about ${gbp(p.leftOver)} a month.`);

  if (p.options.length) {
    lines.push("", "Options:");
    for (const o of p.options) {
      const parts = [`${gbp(o.monthly)} a month (about ${gbp(o.weekly)} a week)`];
      if (o.monthsToStarter !== undefined)
        parts.push(
          o.monthsToStarter === 0 ? `£1,000 starter pot reached` : `£1,000 pot in ${o.monthsToStarter} month(s)`
        );
      if (o.monthsToThreeMonths !== undefined && p.goals.threeMonths > 0)
        parts.push(`3 months of essentials (${gbp(p.goals.threeMonths)}) in ${o.monthsToThreeMonths} month(s)`);
      lines.push(`- ${o.name}: ${parts.join(" · ")}`);
      if (o.tightestMonthLeft !== undefined)
        lines.push(
          o.tightestMonthLeft >= 0
            ? `    Risk check: in your tightest recent month you'd still have had about ${gbp(o.tightestMonthLeft)} spare.`
            : `    Risk check: in your tightest recent month you'd have been about ${gbp(-o.tightestMonthLeft)} short.`
        );
    }
  }
  if (p.pot.saved || p.pot.target)
    lines.push(
      "",
      `Rainy-day pot so far: ${gbp(p.pot.saved)}${p.pot.target ? ` of a ${gbp(p.pot.target)} goal` : ""}.`
    );
  if (p.flags.length) lines.push("", "Worth knowing:", ...p.flags.map((f) => `- ${f}`));
  if (p.ideas.length) lines.push("", "Where some money could come from:", ...p.ideas.map((i) => `- ${i}`));
  lines.push("", NOT_ADVICE);
  return lines.join("\n");
}
