// Generates demo/money/transactions.csv: three and a half months of fictional spending for one
// household, from a fixed seed so the file (and the screenshots) are repeatable.
//   npx tsx scripts/make-demo-money.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addDays } from "../src/dates.js";
import { workingDayOnOrBefore } from "../src/holidays.js";
import { MoneyStore, categorise, roundPence, transactionId, type Transaction } from "../src/money.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "demo");
const money = new MoneyStore(root);

let seed = 20261116;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number) => roundPence(lo + rand() * (hi - lo));
const chance = (p: number) => rand() < p;

const rows: Array<[string, number, string]> = [];
const add = (date: string, amount: number, description: string) => rows.push([date, roundPence(amount), description]);

const START = "2026-08-01";
const END = "2026-11-15";
for (let date = START; date <= END; date = addDays(date, 1)) {
  const day = Number(date.slice(8, 10));
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const month = date.slice(0, 7);

  // Monthly fixed payments and income
  if (day === 1) add(date, -820, "MORTGAGE PAYMENT EXAMPLE BUILDING SOC");
  if (day === 1) add(date, -168, "COUNCIL TAX DD EXAMPLE BOROUGH");
  if (day === 12) add(date, -18, "EXAMPLE MOBILE DD");
  if (day === 18) add(date, -96, "EXAMPLE ENERGY DD");
  if (day === 28) add(date, -10.99, "EXAMPLE STREAMING");
  if (day === 3) add(date, -42.5, "PUREGYM MEMBERSHIP");
  if (date === workingDayOnOrBefore(`${month}-25`, "england-and-wales")) add(date, 2400, "SALARY EXAMPLE EMPLOYER LTD");
  if (day === 26) add(date, -100, "TRANSFER TO SAVINGS");

  // Groceries twice a week, a top-up shop sometimes
  if (weekday === 1) add(date, -between(38, 72), "TESCO STORES 2041");
  if (weekday === 5) add(date, -between(25, 55), "SAINSBURY'S S/MKT");
  if (weekday === 3 && chance(0.4)) add(date, -between(6, 14), "CO-OP GROUP FOOD");

  // Getting about
  if (weekday < 5 && chance(0.55)) add(date, -between(2.8, 8.4), "TFL TRAVEL CHARGE");
  if (day === 9) add(date, -between(48, 62), "SHELL FUEL 4421");

  // Eating and going out (busier in October: a family birthday meal)
  if (weekday < 5 && chance(0.35)) add(date, -between(3.1, 4.6), "COSTA COFFEE 18832");
  if (weekday === 4 && chance(0.6)) add(date, -between(18, 34), "THE RED LION");
  if (weekday === 5 && chance(0.3)) add(date, -between(19, 31), "DELIVEROO");
  if (date === "2026-10-17") add(date, -112.4, "LA TRATTORIA RESTAURANT");

  // Shopping
  if (chance(0.09)) add(date, -between(9, 48), "AMAZON.CO.UK*MK2LP4");
  if (chance(0.04)) add(date, -between(7, 19), "BOOTS 1182");
  if (date === "2026-09-20") add(date, 27.99, "AMAZON.CO.UK REFUND");
}

const rules = await money.loadRules();
const counts = new Map<string, number>();
const transactions: Transaction[] = rows.map(([date, amount, description]) => {
  const key = `${date}|${amount}|${description}`;
  const n = counts.get(key) ?? 0;
  counts.set(key, n + 1);
  return {
    id: transactionId(date, amount, description, n),
    date,
    amount,
    description,
    category: categorise(description, rules),
    source: "bank",
  };
});
await money.saveTransactions(transactions);
console.log(`Wrote ${transactions.length} demo transactions to ${path.join(root, "money", "transactions.csv")}`);
