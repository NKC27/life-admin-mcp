import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { moneyAhead, rainyDayPlan, spendingSummary } from "./budget.js";
import { today } from "./dates.js";
import {
  defaultRegion,
  nonWorkingReason,
  REGION_NAMES,
  REGIONS,
  coverageEnd,
  upcomingHolidays,
  workingDayOnOrBefore,
  type Region,
} from "./holidays.js";
import {
  CATEGORIES,
  CATEGORY_IDS,
  MoneyStore,
  categorise,
  matchesPhrase,
  parseBankCsv,
  roundPence,
  transactionId,
  type Category,
  type Transaction,
} from "./money.js";
import { formatMoneyAhead, formatRainyDay, formatSpending, longDate, shortDate } from "./money-report.js";
import type { Store } from "./store.js";
import { formatMoney, isIsoDate, maskCardNumbers } from "./util.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** £100 for whole pounds, £10.99 otherwise. */
const gbp = (n: number) => formatMoney(n, "GBP").replace(/\.00$/, "");

function textResult(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }] };
}

/** Working-day lookup for paydays in the given region. */
export function workingDayFor(region: Region) {
  return (date: string) => ({ date: workingDayOnOrBefore(date, region), reason: nonWorkingReason(date, region) });
}

function categoryList(): string {
  return CATEGORY_IDS.map((c) => `${c} (${CATEGORIES[c]})`).join(", ");
}

export function registerMoneyTools(server: McpServer, store: Store, money: MoneyStore): void {
  const categorySchema = z.enum(CATEGORY_IDS as [Category, ...Category[]]);

  server.registerTool(
    "import_bank_file",
    {
      title: "Import bank statement",
      description:
        "Read a bank statement exported as CSV (every UK bank app can export one) and add its transactions to the " +
        "person's spending records, sorted into categories. Always run first with confirm false to show a " +
        "preview, then again with confirm true once the person agrees. Already-imported lines are skipped, so " +
        "overlapping statements are safe. The file stays on this computer.",
      inputSchema: {
        path: z.string().min(1).describe("Full path to the .csv file, e.g. ~/Downloads/statement.csv"),
        confirm: z.boolean().optional().describe("false (default) previews; true saves"),
      },
      annotations: WRITE,
    },
    async ({ path: given, confirm }) => {
      const file = path.resolve(given.replace(/^~(?=$|\/)/, os.homedir()));
      if (!file.toLowerCase().endsWith(".csv"))
        return textResult("That isn't a .csv file. In your bank's app or website, export the statement as CSV.", true);
      let text: string;
      try {
        const stat = await fs.stat(file);
        if (stat.size > MAX_FILE_BYTES) return textResult("That file is over 10 MB. Export a shorter period.", true);
        text = await fs.readFile(file, "utf-8");
      } catch {
        return textResult(`Could not open ${file}. Check the file name and folder.`, true);
      }

      let parsed;
      try {
        parsed = parseBankCsv(text, await money.loadRules());
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
      const list = parsed.transactions;
      if (!list.length) return textResult("No transactions found in that file.", true);
      const existing = new Set((await money.loadTransactions()).map((t) => t.id));
      const fresh = list.filter((t) => !existing.has(t.id));
      const dates = list.map((t) => t.date).sort();
      const out = list.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
      const inn = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

      const byCategory = new Map<Category, number>();
      for (const t of fresh) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + Math.abs(t.amount));
      const unsorted = new Map<string, number>();
      for (const t of fresh.filter((t) => t.category === "other"))
        unsorted.set(t.description, (unsorted.get(t.description) ?? 0) + 1);

      const lines = [
        `${confirm ? "Imported" : "Preview of"} ${path.basename(file)}${confirm ? "" : " (nothing saved yet)"}:`,
        `- ${list.length} transaction(s), ${longDate(dates[0]!)} to ${longDate(dates.at(-1)!)}`,
        `- Money out ${gbp(out)}, money in ${gbp(inn)}`,
        `- ${fresh.length} new, ${list.length - fresh.length} already imported${confirm ? " (skipped)" : " (will be skipped)"}`,
        `- Columns used: ${parsed.columns.date} / ${parsed.columns.description} / ${parsed.columns.amount}`,
      ];
      if (parsed.skippedRows)
        lines.push(`- ${parsed.skippedRows} row(s) without a readable date or amount were ignored`);
      if (byCategory.size)
        lines.push(
          "",
          "New transactions by category:",
          ...[...byCategory].sort((a, b) => b[1] - a[1]).map(([c, v]) => `- ${CATEGORIES[c]}: ${gbp(v)}`)
        );
      if (unsorted.size)
        lines.push(
          "",
          `Not sorted yet (in Other): ${[...unsorted]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([d, n]) => `${d}${n > 1 ? ` ×${n}` : ""}`)
            .join("; ")}`,
          "Use categorise to sort these; it remembers for next time."
        );

      if (confirm) {
        await money.addTransactions(fresh);
      } else {
        lines.push("", "Run again with confirm: true to save these.");
      }
      return textResult(lines.join("\n"));
    }
  );

  server.registerTool(
    "add_spending",
    {
      title: "Add spending",
      description:
        'Record one payment or refund the person tells you about ("I spent £42 on a meal out"). The category is ' +
        "worked out from the description unless given. Amounts are always positive; set money_in for refunds or " +
        `money received. Categories: ${categoryList()}.`,
      inputSchema: {
        amount: z.number().positive().max(1_000_000).describe("Amount in pounds, e.g. 42.50"),
        description: z.string().min(1).max(200).describe("What or where, e.g. 'Meal out at The Red Lion'"),
        category: categorySchema.optional(),
        date: z.string().optional().describe("YYYY-MM-DD (default today)"),
        money_in: z.boolean().optional().describe("True for a refund or money received"),
      },
      annotations: WRITE,
    },
    async ({ amount, description, category, date, money_in }) => {
      const when = date ?? today();
      if (!isIsoDate(when)) return textResult(`date must be YYYY-MM-DD, got "${when}"`, true);
      const text = maskCardNumbers(description.trim());
      const value = roundPence(money_in ? amount : -amount);
      const existing = await money.loadTransactions();
      const ids = new Set(existing.map((t) => t.id));
      let n = 0;
      while (ids.has(transactionId(when, value, text, n))) n++;
      const t: Transaction = {
        id: transactionId(when, value, text, n),
        date: when,
        amount: value,
        description: text,
        category: category ?? categorise(text, await money.loadRules()),
        source: "typed",
      };
      await money.addTransactions([t]);
      return textResult(
        `Recorded ${money_in ? "money in" : "spending"} of ${gbp(amount)} on ${shortDate(when)}: ${text} (${CATEGORIES[t.category]}).`
      );
    }
  );

  server.registerTool(
    "categorise",
    {
      title: "Sort spending into a category",
      description:
        "Put every transaction whose description contains these words (whole words, any case) into a category, " +
        "and by default remember it so future imports are sorted the same way. Use after an import lists " +
        `unsorted shops. Categories: ${categoryList()}.`,
      inputSchema: {
        match: z.string().min(2).max(80).describe("Words from the description, e.g. 'RED LION'"),
        category: categorySchema,
        remember: z.boolean().optional().describe("Save as a rule for next time (default true)"),
      },
      annotations: WRITE,
    },
    async ({ match, category, remember }) => {
      const all = await money.loadTransactions();
      let moved = 0;
      for (const t of all) {
        if (matchesPhrase(t.description, match) && t.category !== category) {
          t.category = category;
          moved++;
        }
      }
      if (moved) await money.saveTransactions(all);
      if (remember !== false) await money.saveRule(match, category);
      return textResult(
        `${moved ? `Moved ${moved} transaction(s)` : "No existing transactions matched"} "${match}" to ${CATEGORIES[category]}.` +
          (remember !== false ? " New ones will be sorted the same way." : "")
      );
    }
  );

  server.registerTool(
    "spending_summary",
    {
      title: "Spending summary",
      description:
        "What was spent this week or month by category, compared with what's usual for the person (the average " +
        "of up to four earlier periods), plus money in, money saved and the biggest shops. Weeks run Monday to " +
        "Sunday. offset 1 means last week/month.",
      inputSchema: {
        period: z.enum(["week", "month"]).optional().describe("Default week"),
        offset: z.number().int().min(0).max(24).optional().describe("0 = this one (default), 1 = the previous one"),
      },
      annotations: READ_ONLY,
    },
    async ({ period, offset }) =>
      textResult(
        formatSpending(spendingSummary(await money.loadTransactions(), today(), period ?? "week", offset ?? 0))
      )
  );

  server.registerTool(
    "money_ahead",
    {
      title: "Money ahead",
      description:
        "Payments due between today and the next payday (from income items, moved to the working day before if " +
        "payday falls on a weekend or bank holiday), with their total. Given the person's current balance, says " +
        "roughly what is left until payday. Never guess the balance: ask for it.",
      inputSchema: {
        balance: z.number().optional().describe("Current bank balance the person gave you"),
        days: z.number().int().min(1).max(366).optional().describe("Look this many days ahead instead of to payday"),
      },
      annotations: READ_ONLY,
    },
    async ({ balance, days }) =>
      textResult(
        formatMoneyAhead(
          moneyAhead(await store.loadAll(), today(), { balance, days, workingDay: workingDayFor(defaultRegion()) })
        )
      )
  );

  server.registerTool(
    "rainy_day_plan",
    {
      title: "Rainy-day plan",
      description:
        "Work out how much the person could put aside, from their own income items and spending records: big " +
        "yearly bills smoothed into monthly set-asides, then Gentle, Steady and Stretch options, each with a risk " +
        "check against their tightest recent month and time to a £1,000 pot and to three months of essentials. " +
        "Flags varying income, rising spending, big bills due soon and signs of borrowing. Arithmetic only: never " +
        "recommend financial products, accounts or investments.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      textResult(
        formatRainyDay(
          rainyDayPlan(await money.loadTransactions(), await store.loadAll(), await money.loadPot(), today())
        )
      )
  );

  server.registerTool(
    "update_pot",
    {
      title: "Update rainy-day pot",
      description:
        "Record what is in the rainy-day pot: set the amount saved, add to it (or take from it with a negative " +
        "amount), or set a goal. Only use figures the person gave you.",
      inputSchema: {
        saved: z.number().min(0).optional().describe("Set the amount saved so far"),
        add: z.number().optional().describe("Add this much (negative to take some out)"),
        target: z.number().min(0).optional().describe("Goal amount (0 clears it)"),
      },
      annotations: WRITE,
    },
    async ({ saved, add, target }) => {
      if (saved === undefined && add === undefined && target === undefined)
        return textResult("Give saved, add or target.", true);
      const pot = (await money.loadPot()) ?? { saved: 0, updated: "" };
      let next = saved ?? pot.saved;
      if (add !== undefined) next += add;
      if (next < 0) return textResult(`That would take the pot below zero (it has ${gbp(pot.saved)}).`, true);
      const goal = target === undefined ? pot.target : target > 0 ? target : undefined;
      await money.savePot({ saved: roundPence(next), target: goal, updated: today() });
      const progress = goal ? ` of ${gbp(goal)} (${Math.min(100, Math.round((next / goal) * 100))}%)` : "";
      return textResult(`Rainy-day pot: ${gbp(next)}${progress}.`);
    }
  );

  server.registerTool(
    "bank_holidays",
    {
      title: "Bank holidays",
      description:
        "Upcoming UK bank holidays (official gov.uk list, bundled) for England and Wales, Scotland or Northern " +
        "Ireland. Useful because pay due on a bank holiday or weekend usually arrives the working day before, and " +
        "payments due then are usually taken the next working day.",
      inputSchema: {
        days: z.number().int().min(1).max(800).optional().describe("How far ahead (default 120 days)"),
        region: z.enum(REGIONS).optional().describe("Default: england-and-wales, or LIFE_ADMIN_REGION"),
      },
      annotations: READ_ONLY,
    },
    async ({ days, region }) => {
      const where = region ?? defaultRegion();
      const from = today();
      const list = upcomingHolidays(from, days ?? 120, where);
      const lines = [`Bank holidays in ${REGION_NAMES[where]} from ${longDate(from)}:`];
      lines.push(
        ...(list.length
          ? list.map((h) => `- ${longDate(h.date)} ${h.date.slice(0, 4)}: ${h.title}`)
          : ["- None in that period."])
      );
      lines.push("", `The bundled list runs to the end of ${coverageEnd(where).slice(0, 4)} (source: gov.uk).`);
      return textResult(lines.join("\n"));
    }
  );
}
