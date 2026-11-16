import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { parseCsv, toCsv, unguardCell } from "./csv.js";
import { isIsoDate, maskCardNumbers } from "./util.js";

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

export const CATEGORIES = {
  bills: "Bills & energy",
  groceries: "Groceries",
  shopping: "Shopping",
  "going-out": "Eating & going out",
  transport: "Transport",
  tax: "Tax",
  subscriptions: "Subscriptions",
  savings: "Savings",
  income: "Income",
  transfers: "Transfers",
  other: "Other",
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

/** Categories that count as spending (savings, income and transfers between your own accounts do not). */
export const SPENDING: Category[] = [
  "bills",
  "groceries",
  "shopping",
  "going-out",
  "transport",
  "tax",
  "subscriptions",
  "other",
];

/** The must-pay part of spending, used for the "three months of essentials" goal. */
export const ESSENTIALS: Category[] = ["bills", "groceries", "transport", "tax"];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && value in CATEGORIES;
}

/**
 * Starting rules for common UK shops and payees. The person's own rules always win, and the longest
 * matching text wins within each set (so "UBER EATS" is going out, while "UBER" is transport).
 */
export const DEFAULT_RULES: Array<[string, Category]> = [
  // groceries
  ["TESCO", "groceries"],
  ["SAINSBURY", "groceries"],
  ["ASDA", "groceries"],
  ["MORRISONS", "groceries"],
  ["ALDI", "groceries"],
  ["LIDL", "groceries"],
  ["WAITROSE", "groceries"],
  ["CO-OP", "groceries"],
  ["ICELAND", "groceries"],
  ["M&S FOOD", "groceries"],
  ["OCADO", "groceries"],
  // shopping
  ["AMAZON", "shopping"],
  ["ARGOS", "shopping"],
  ["JOHN LEWIS", "shopping"],
  ["BOOTS", "shopping"],
  ["PRIMARK", "shopping"],
  ["NEXT", "shopping"],
  ["IKEA", "shopping"],
  ["EBAY", "shopping"],
  // eating and going out
  ["DELIVEROO", "going-out"],
  ["JUST EAT", "going-out"],
  ["UBER EATS", "going-out"],
  ["COSTA", "going-out"],
  ["STARBUCKS", "going-out"],
  ["CAFFE NERO", "going-out"],
  ["PRET", "going-out"],
  ["GREGGS", "going-out"],
  ["MCDONALDS", "going-out"],
  ["NANDOS", "going-out"],
  ["WETHERSPOON", "going-out"],
  ["RESTAURANT", "going-out"],
  ["CINEMA", "going-out"],
  ["ODEON", "going-out"],
  ["VUE", "going-out"],
  // transport
  ["TFL", "transport"],
  ["TRAINLINE", "transport"],
  ["NATIONAL RAIL", "transport"],
  ["UBER", "transport"],
  ["SHELL", "transport"],
  ["ESSO", "transport"],
  ["BP", "transport"],
  ["TEXACO", "transport"],
  ["DVLA", "transport"],
  ["PARKING", "transport"],
  // bills and energy
  ["OCTOPUS ENERGY", "bills"],
  ["BRITISH GAS", "bills"],
  ["EDF", "bills"],
  ["E.ON", "bills"],
  ["OVO", "bills"],
  ["SCOTTISH POWER", "bills"],
  ["WATER", "bills"],
  ["BT GROUP", "bills"],
  ["VIRGIN MEDIA", "bills"],
  ["SKY DIGITAL", "bills"],
  ["VODAFONE", "bills"],
  ["EE LIMITED", "bills"],
  ["O2", "bills"],
  ["TV LICENCE", "bills"],
  ["RENT", "bills"],
  ["MORTGAGE", "bills"],
  ["INSURANCE", "bills"],
  // tax
  ["HMRC", "tax"],
  ["COUNCIL TAX", "tax"],
  // subscriptions
  ["NETFLIX", "subscriptions"],
  ["SPOTIFY", "subscriptions"],
  ["DISNEY", "subscriptions"],
  ["APPLE.COM/BILL", "subscriptions"],
  ["AMAZON PRIME", "subscriptions"],
  ["YOUTUBE", "subscriptions"],
  ["GYM", "subscriptions"],
  ["PUREGYM", "subscriptions"],
  ["THE GYM GROUP", "subscriptions"],
  // income
  ["SALARY", "income"],
  ["WAGES", "income"],
  ["PENSION", "income"],
  ["DWP", "income"],
  ["HMRC TAX CREDIT", "income"],
];

/**
 * Does `text` contain `phrase` as whole words? "RENT" matches "RENT PAYMENT" but not "CURRENT"
 * or "PARENT"; "BP" matches "BP CONNECT" but not "BPAY".
 */
export function matchesPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim().toUpperCase();
  if (!p) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`).test(text.toUpperCase());
}

/** The category for a description: the person's rules first, then the defaults; longest match wins. */
export function categorise(description: string, rules: Array<[string, Category]>): Category {
  for (const set of [rules, DEFAULT_RULES]) {
    let best: [string, Category] | undefined;
    for (const rule of set) {
      if (matchesPhrase(description, rule[0]) && (!best || rule[0].trim().length > best[0].trim().length)) best = rule;
    }
    if (best) return best[1];
  }
  return "other";
}

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

export type Source = "typed" | "bank" | "email";

export interface Transaction {
  id: string;
  date: string;
  /** Pounds; negative is money out, positive is money in. */
  amount: number;
  description: string;
  category: Category;
  source: Source;
}

/**
 * A stable ID from what the bank shows. `n` counts identical lines within one file, so two £3.20
 * coffees on the same day are both kept, while re-importing an overlapping statement skips repeats.
 */
export function transactionId(date: string, amount: number, description: string, n: number): string {
  return crypto
    .createHash("sha256")
    .update(`${date}|${amount.toFixed(2)}|${description.trim().toUpperCase()}|${n}`)
    .digest("hex")
    .slice(0, 12);
}

export function roundPence(n: number): number {
  return Math.round(n * 100) / 100;
}

const HEADER = ["id", "date", "amount", "description", "category", "source"];

export interface Pot {
  saved: number;
  target?: number;
  updated: string;
}

/** Spending records and rules, stored as CSV files in `money/` that open in Excel. */
export class MoneyStore {
  readonly dir: string;
  private readonly transactionsFile: string;
  private readonly rulesFile: string;
  private readonly potFile: string;

  constructor(root: string) {
    this.dir = path.join(root, "money");
    this.transactionsFile = path.join(this.dir, "transactions.csv");
    this.rulesFile = path.join(this.dir, "rules.csv");
    this.potFile = path.join(this.dir, "rainy-day-pot.json");
  }

  private async write(file: string, content: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    // Write then rename, so a crash never leaves a half-written file.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, content, "utf-8");
    await fs.rename(tmp, file);
  }

  async loadTransactions(): Promise<Transaction[]> {
    const text = await fs.readFile(this.transactionsFile, "utf-8").catch(() => "");
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const out: Transaction[] = [];
    for (const row of rows.slice(1)) {
      const date = row[col("date")]?.trim() ?? "";
      const amount = Number(row[col("amount")]);
      const category = row[col("category")]?.trim();
      if (!isIsoDate(date) || !Number.isFinite(amount)) continue;
      const source = row[col("source")]?.trim();
      out.push({
        id: row[col("id")]?.trim() || transactionId(date, amount, row[col("description")] ?? "", out.length),
        date,
        amount: roundPence(amount),
        description: unguardCell(row[col("description")] ?? "").trim(),
        category: isCategory(category) ? category : "other",
        source: source === "bank" || source === "email" ? source : "typed",
      });
    }
    return out;
  }

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const rows = sorted.map((t) => [t.id, t.date, t.amount.toFixed(2), t.description, t.category, t.source]);
    await this.write(this.transactionsFile, toCsv([HEADER, ...rows]));
  }

  /** Add transactions, skipping any whose ID is already stored. */
  async addTransactions(incoming: Transaction[]): Promise<{ added: Transaction[]; skipped: number }> {
    const existing = await this.loadTransactions();
    const seen = new Set(existing.map((t) => t.id));
    const added = incoming.filter((t) => !seen.has(t.id) && seen.add(t.id));
    if (added.length) await this.saveTransactions([...existing, ...added]);
    return { added, skipped: incoming.length - added.length };
  }

  async loadRules(): Promise<Array<[string, Category]>> {
    const text = await fs.readFile(this.rulesFile, "utf-8").catch(() => "");
    return parseCsv(text)
      .slice(1)
      .map((r) => [unguardCell(r[0] ?? "").trim(), r[1]?.trim()] as const)
      .filter((r): r is readonly [string, Category] => r[0] !== "" && isCategory(r[1]))
      .map(([m, c]) => [m, c]);
  }

  /** Save "text -> category", replacing an existing rule for the same text. */
  async saveRule(match: string, category: Category): Promise<void> {
    const rules = (await this.loadRules()).filter(([m]) => m.toUpperCase() !== match.trim().toUpperCase());
    rules.push([match.trim(), category]);
    await this.write(this.rulesFile, toCsv([["match", "category"], ...rules]));
  }

  async loadPot(): Promise<Pot | null> {
    try {
      const data = JSON.parse(await fs.readFile(this.potFile, "utf-8")) as Partial<Pot>;
      if (typeof data.saved !== "number" || !Number.isFinite(data.saved)) return null;
      return {
        saved: data.saved,
        target: typeof data.target === "number" && data.target > 0 ? data.target : undefined,
        updated: typeof data.updated === "string" ? data.updated : "",
      };
    } catch {
      return null;
    }
  }

  async savePot(pot: Pot): Promise<void> {
    await this.write(this.potFile, `${JSON.stringify(pot, null, 2)}\n`);
  }
}

// ---------------------------------------------------------------------------
// bank statement import
// ---------------------------------------------------------------------------

export function parseUkDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isIsoDate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  const pad = (n: string) => n.padStart(2, "0");
  const year = (y: string) => (y.length === 2 ? `20${y}` : y);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) {
    const iso = `${year(m[3]!)}-${pad(m[2]!)}-${pad(m[1]!)}`; // UK order: day first
    return isIsoDate(iso) ? iso : null;
  }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2}|\d{4})\b/);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    if (!month) return null;
    const iso = `${year(m[3]!)}-${pad(String(month))}-${pad(m[1]!)}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

/** "£1,234.56", "-12.30", "(12.30)", "12.30 DR", "" -> number (NaN when unreadable). */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[£$€,\s]/g, "");
  if (!s) return NaN;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/DR$/i.test(s)) {
    sign = -1;
    s = s.slice(0, -2);
  } else if (/CR$/i.test(s)) {
    s = s.slice(0, -2);
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
  return sign * Number(s);
}

export interface ColumnMap {
  date: number;
  description: number;
  /** One signed amount column... */
  amount?: number;
  /** ...or separate money-out and money-in columns. */
  out?: number;
  in?: number;
}

function findColumns(header: string[]): ColumnMap | null {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (test: (x: string) => boolean) => h.findIndex(test);

  const date =
    find((x) => x === "date") >= 0 ? find((x) => x === "date") : find((x) => x.includes("date") && !x.includes("time"));
  const out = find((x) => /paid out|money out|debit|withdrawal|spent/.test(x));
  const inn = find((x) => /paid in|money in|credit|deposit|received/.test(x));
  let amount = find((x) => x === "amount" || x === "amount (gbp)" || x === "value");
  if (amount < 0) amount = find((x) => x.startsWith("amount") || x === "transaction amount");

  const notMeta = (x: string) => !/account|category|type|balance|currency/.test(x);
  let description = -1;
  for (const name of ["name", "merchant", "payee", "description", "details", "narrative", "memo", "reference"]) {
    description = find((x) => (x === name || x.includes(name)) && notMeta(x));
    if (description >= 0) break;
  }

  if (date < 0 || description < 0) return null;
  if (out >= 0 && inn >= 0) return { date, description, out, in: inn };
  if (amount >= 0) return { date, description, amount };
  return null;
}

export interface BankImport {
  transactions: Transaction[];
  /** Rows that looked like transactions but could not be read. */
  skippedRows: number;
  columns: { date: string; description: string; amount: string };
}

/**
 * Read a bank statement CSV. Finds the header row (some banks put account details above it),
 * recognises the usual UK column names and date formats (day first), and categorises each line.
 */
export function parseBankCsv(text: string, rules: Array<[string, Category]>): BankImport {
  const rows = parseCsv(text);
  if (rows.length > 50_000) throw new Error("That file has more than 50,000 rows. Please export a shorter period.");
  let headerIndex = -1;
  let columns: ColumnMap | null = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    columns = findColumns(rows[i]!);
    if (columns) {
      headerIndex = i;
      break;
    }
  }
  if (!columns) {
    const first = rows[0]?.join(", ") ?? "(empty file)";
    throw new Error(
      `Could not find the date, description and amount columns. The first row was: ${first}. ` +
        "Is this a bank statement exported as CSV?"
    );
  }
  const header = rows[headerIndex]!;
  const counts = new Map<string, number>();
  const transactions: Transaction[] = [];
  let skippedRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseUkDate(row[columns.date] ?? "");
    let amount: number;
    if (columns.amount !== undefined) {
      amount = parseAmount(row[columns.amount] ?? "");
    } else {
      const out = parseAmount(row[columns.out!] ?? "");
      const inn = parseAmount(row[columns.in!] ?? "");
      amount = (Number.isNaN(inn) ? 0 : Math.abs(inn)) - (Number.isNaN(out) ? 0 : Math.abs(out));
      if (Number.isNaN(out) && Number.isNaN(inn)) amount = NaN;
    }
    const description = maskCardNumbers((row[columns.description] ?? "").replace(/\s+/g, " ").trim());
    if (!date || !Number.isFinite(amount) || amount === 0) {
      skippedRows += 1;
      continue;
    }
    const value = roundPence(amount);
    const key = `${date}|${value}|${description.toUpperCase()}`;
    const n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    transactions.push({
      id: transactionId(date, value, description, n),
      date,
      amount: value,
      description,
      category: categorise(description, rules),
      source: "bank",
    });
  }

  return {
    transactions,
    skippedRows,
    columns: {
      date: header[columns.date]!,
      description: header[columns.description]!,
      amount:
        columns.amount !== undefined ? header[columns.amount]! : `${header[columns.out!]} / ${header[columns.in!]}`,
    },
  };
}
