import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Store } from "./store.js";
import { describeSource, type FolderLocation } from "./config.js";
import { describeDays, dueStatus, rollForward, today } from "./dates.js";
import { ITEM_TYPES, PERIODS, type Item, type ItemInput } from "./types.js";
import { appendHistory, formatMoney, percentChange } from "./util.js";
import { dueReport, itemLine } from "./report.js";
import { buildCalendar } from "./calendar.js";
import { VERSION } from "./version.js";
import { MoneyStore } from "./money.js";
import { registerMoneyTools } from "./money-tools.js";
import { openInBrowser, startDashboard, type RunningDashboard } from "./dashboard.js";
import { holidayWord, upcomingHolidays } from "./holidays.js";
import { settings } from "./locale.js";

const INSTRUCTIONS =
  "Local-first life admin: renewals, bills, subscriptions, warranties, policies, vehicles and documents, each " +
  "stored as a markdown file on the user's own machine. Use due_soon to see what needs attention, add_item to " +
  "track something new (search_items first to avoid duplicates), and mark_handled once the user has dealt with " +
  "a renewal or payment. Store only the last four digits of any account or card number. Never invent dates or " +
  "prices; ask the user. Nothing here sends reminders by itself: export_calendar puts due dates and reminders " +
  "into the user's own calendar app, so never promise a reminder without it.";

// Tool annotations let clients tell safe reads from writes and decide when to ask for approval.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const CLEARABLE = ["provider", "cost", "due", "ref"] as const;

function textResult(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }] };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Item fields shared by add_item and update_item. */
const FIELD_SCHEMA = {
  provider: z.string().max(200).optional().describe("Who it is with, e.g. 'Octopus Energy'"),
  cost: z
    .number()
    .min(0)
    .optional()
    .describe("Cost per period as the user stated it (for income: the amount received). Never estimate."),
  currency: z.string().length(3).optional().describe("Three-letter code, default the person's own currency"),
  period: z.enum(PERIODS).optional().describe("How often it repeats (default one-off)"),
  due: z
    .string()
    .optional()
    .describe("Next renewal, payment or expiry date as YYYY-MM-DD. Only a date the user gave you."),
  remind_days: z.number().int().min(0).max(365).optional().describe("Days before due to start reminding (default 14)"),
  auto_renews: z.boolean().optional().describe("True if it renews or charges automatically unless stopped"),
  ref: z.string().max(60).optional().describe("Policy, account or order reference; only the last four are kept"),
  tags: z.array(z.string().max(40)).max(10).optional().describe("A few lowercase tags, e.g. ['car']"),
};

export function createServer(store: Store, location: FolderLocation): McpServer {
  const server = new McpServer(
    { name: "life-admin", version: VERSION, title: "Life Admin" },
    { instructions: INSTRUCTIONS }
  );

  async function resolve(query: string): Promise<{ item: Item | null; message: string }> {
    const item = await store.findBySlugOrTitle(query);
    if (item) return { item, message: "" };
    const suggestion = await store.suggestClosest(query);
    const base = `No item found matching "${query}".`;
    return {
      item: null,
      message: suggestion ? `${base} Did you mean "${suggestion.title}"?` : `${base} Try list_items or search_items.`,
    };
  }

  function toInput(item: Item): ItemInput {
    const { slug: _s, created: _c, updated: _u, path: _p, ...input } = item;
    return input;
  }

  function describeItem(item: Item, todayDate: string): string {
    const lines = [`**${item.title}** (${item.type})`];
    if (item.provider) lines.push(`Provider: ${item.provider}`);
    if (item.cost !== undefined)
      lines.push(
        `Cost: ${formatMoney(item.cost, item.currency)}${item.period === "one-off" ? "" : ` per ${item.period.replace(/ly$/, "")}`}`
      );
    else if (item.period !== "one-off") lines.push(`Repeats: ${item.period}`);
    if (item.due) {
      const s = dueStatus(item.due, todayDate, item.remind_days);
      lines.push(`Due: ${item.due} (${describeDays(s.daysLeft)}), reminders from ${s.remindFrom}`);
    }
    if (item.auto_renews) lines.push("Renews automatically unless stopped");
    if (item.ref) lines.push(`Ref: ${item.ref}`);
    if (item.tags.length) lines.push(`Tags: ${item.tags.join(", ")}`);
    if (item.body) lines.push("", item.body);
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // reading
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_stats",
    {
      title: "Folder stats",
      description:
        "Where the life-admin folder lives and what it holds: item counts by type, how many are overdue and how " +
        "many are due in the next 30 days. Call once at the start of a conversation to orient.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const items = await store.loadAll();
      const todayDate = today();
      const where = settings();
      const lines = [
        `Folder: ${store.root} (${describeSource(location.source)})`,
        `Country: ${where.label} · currency ${where.currency}`,
        `Items: ${items.length}`,
      ];
      for (const type of ITEM_TYPES) {
        const count = items.filter((i) => i.type === type).length;
        if (count) lines.push(`  ${type}: ${count}`);
      }
      const dated = items.filter((i): i is Item & { due: string } => i.due !== undefined && i.type !== "income");
      const statuses = dated.map((i) => dueStatus(i.due, todayDate, i.remind_days));
      lines.push(`With a due date: ${dated.length}`);
      lines.push(`Overdue: ${statuses.filter((s) => s.overdue).length}`);
      lines.push(`Due in the next 30 days: ${statuses.filter((s) => !s.overdue && s.daysLeft <= 30).length}`);
      lines.push(`Today is ${todayDate}.`);
      if (location.source === "demo")
        lines.push("This is the demo folder with fictional items. Run `life-admin-mcp init` to create your own.");
      return textResult(lines.join("\n"));
    }
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description: "List tracked items, optionally filtered by type, sorted by due date (undated items last).",
      inputSchema: {
        type: z.enum(ITEM_TYPES).optional().describe("Only items of this type"),
        limit: z.number().int().min(1).max(500).optional().describe("Maximum number of items (default 100)"),
      },
      annotations: READ_ONLY,
    },
    async ({ type, limit }) => {
      const items = (await store.loadAll())
        .filter((i) => !type || i.type === type)
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title))
        .slice(0, limit ?? 100);
      if (!items.length) return textResult(type ? `No ${type} items yet.` : "No items yet.");
      return textResult(items.map((i) => itemLine(i)).join("\n"));
    }
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description:
        "Full details of one item by title: provider, cost, due date with days left and when reminders start, " +
        "reference, and its notes and history.",
      inputSchema: { item: z.string().min(1).describe("The item's title") },
      annotations: READ_ONLY,
    },
    async ({ item: query }) => {
      const { item, message } = await resolve(query);
      if (!item) return textResult(message, true);
      return textResult(describeItem(item, today()));
    }
  );

  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description:
        "Find items whose title, provider, tags or notes contain any of the words in the query, best matches " +
        "first. Use before add_item to avoid duplicates, and for questions like 'where's the boiler warranty?'.",
      inputSchema: {
        query: z.string().min(1).describe("A few keywords, e.g. 'boiler warranty'"),
        type: z.enum(ITEM_TYPES).optional().describe("Only items of this type"),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results (default 10)"),
      },
      annotations: READ_ONLY,
    },
    async ({ query, type, limit }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const scored = (await store.loadAll())
        .filter((i) => !type || i.type === type)
        .map((item) => {
          const title = item.title.toLowerCase();
          const provider = (item.provider ?? "").toLowerCase();
          const tags = item.tags.map((t) => t.toLowerCase());
          const body = item.body.toLowerCase();
          let score = 0;
          for (const t of terms) {
            if (title.includes(t)) score += 3;
            if (provider.includes(t)) score += 2;
            if (tags.some((tag) => tag.includes(t))) score += 2;
            if (body.includes(t)) score += 1;
          }
          return { item, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
        .slice(0, limit ?? 10);
      if (!scored.length) return textResult(`Nothing matches "${query}".`);
      return textResult(scored.map((r) => itemLine(r.item)).join("\n"));
    }
  );

  server.registerTool(
    "due_soon",
    {
      title: "Due soon",
      description:
        "What needs attention: overdue items, items due within the next `days` days, and items further out whose " +
        "reminder window has already opened (e.g. a passport with a 180-day reminder). Sorted by due date, with " +
        "today's date stated. This is the main 'what's coming up?' tool.",
      inputSchema: {
        days: z.number().int().min(1).max(366).optional().describe("How far ahead to look (default 30)"),
        type: z.enum(ITEM_TYPES).optional().describe("Only items of this type"),
      },
      annotations: READ_ONLY,
    },
    async ({ days, type }) => {
      const window = days ?? 30;
      const region = settings().place;
      const holidays = upcomingHolidays(today(), window, region);
      const note = holidays.length
        ? `\n\n${holidayWord(region).replace(/^./, (c) => c.toUpperCase())} in this period (${settings().label}): ${holidays.map((h) => `${h.title} ${h.date}`).join(", ")}.`
        : "";
      return textResult(dueReport(await store.loadAll(), today(), window, type) + note);
    }
  );

  // ---------------------------------------------------------------------------
  // writing
  // ---------------------------------------------------------------------------

  server.registerTool(
    "add_item",
    {
      title: "Add item",
      description:
        "Start tracking something: a bill, renewal, subscription, warranty, policy, vehicle or document. Use only " +
        "facts the user gave you; leave out a due date or cost rather than guessing. Refuses an exact duplicate " +
        "title (use update_item instead) and anything that looks like a full card number.",
      inputSchema: {
        title: z.string().min(1).max(120).describe("Short, specific name, e.g. 'Car insurance' or 'Boiler warranty'"),
        type: z.enum(ITEM_TYPES).describe("What kind of thing it is"),
        ...FIELD_SCHEMA,
        notes: z.string().max(5000).optional().describe("Anything else worth keeping, in the user's words"),
      },
      annotations: WRITE,
    },
    async ({ title, type, notes, ...fields }) => {
      const existing = await store.findBySlugOrTitle(title);
      if (existing && existing.title.toLowerCase() === title.trim().toLowerCase())
        return textResult(`An item called "${existing.title}" already exists. Use update_item to change it.`, true);
      try {
        // Birthdays come round every year and want a week's notice unless told otherwise.
        const defaults =
          type === "birthday"
            ? { period: fields.period ?? ("yearly" as const), remind_days: fields.remind_days ?? 7 }
            : {};
        const saved = await store.save({ title, type, ...fields, ...defaults, body: notes });
        return textResult(`Added.\n\n${describeItem(saved, today())}`);
      } catch (err) {
        return textResult(errorMessage(err), true);
      }
    }
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Change fields on an existing item; anything you leave out stays as it is. `clear` removes a field. " +
        "`add_note` appends a dated line to the item's history. For a renewal or payment that has been dealt " +
        "with, use mark_handled instead so the due date moves on.",
      inputSchema: {
        item: z.string().min(1).describe("The item's current title"),
        title: z.string().min(1).max(120).optional().describe("New title"),
        type: z.enum(ITEM_TYPES).optional(),
        ...FIELD_SCHEMA,
        clear: z.array(z.enum(CLEARABLE)).optional().describe("Fields to remove"),
        add_note: z.string().max(2000).optional().describe("Append a dated line to the history"),
      },
      annotations: WRITE,
    },
    async ({ item: query, clear, add_note, ...changes }) => {
      const { item, message } = await resolve(query);
      if (!item) return textResult(message, true);

      if (changes.title && changes.title.trim().toLowerCase() !== item.title.toLowerCase()) {
        const clash = await store.findBySlugOrTitle(changes.title);
        if (clash && clash.slug !== item.slug)
          return textResult(`Another item is already called "${clash.title}".`, true);
      }

      const next: ItemInput = { ...toInput(item) };
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
      }
      // A new due date starts a new schedule, so forget any remembered month-end day.
      if (changes.due !== undefined && changes.due !== item.due) next.anchor_day = undefined;
      for (const field of clear ?? []) {
        next[field] = undefined;
        if (field === "due") next.anchor_day = undefined;
      }
      if (add_note) next.body = appendHistory(next.body ?? "", `${today()} ${add_note.trim()}`);

      try {
        const saved = await store.save(next, { slug: item.slug, created: item.created });
        return textResult(`Updated.\n\n${describeItem(saved, today())}`);
      } catch (err) {
        return textResult(errorMessage(err), true);
      }
    }
  );

  server.registerTool(
    "mark_handled",
    {
      title: "Mark handled",
      description:
        "Record that the user has dealt with an item (renewed, paid, switched, replaced). Logs it in the item's " +
        "history and moves the due date on: repeating items roll forward by their period (keeping month-end dates " +
        "right), `next_due` sets a date explicitly, and a one-off item's due date is cleared. Pass `new_cost` when " +
        "the price changed; the old and new prices are logged.",
      inputSchema: {
        item: z.string().min(1).describe("The item's title"),
        note: z.string().max(500).optional().describe("What was done, e.g. 'Renewed with Admiral after haggling'"),
        new_cost: z.number().min(0).optional().describe("The new cost per period, if it changed"),
        next_due: z.string().optional().describe("Set the next due date explicitly (YYYY-MM-DD)"),
      },
      annotations: WRITE,
    },
    async ({ item: query, note, new_cost, next_due }) => {
      const { item, message } = await resolve(query);
      if (!item) return textResult(message, true);
      const todayDate = today();

      const next: ItemInput = { ...toInput(item) };
      let dueText: string;
      if (next_due !== undefined) {
        next.due = next_due;
        next.anchor_day = undefined;
        dueText = `Next due ${next_due}.`;
      } else if (item.due && item.period !== "one-off") {
        const rolled = rollForward(item.due, item.period, todayDate, item.anchor_day);
        next.due = rolled.due;
        next.anchor_day = rolled.anchorDay;
        dueText = `Next due ${rolled.due}${rolled.periods > 1 ? ` (moved on ${rolled.periods} periods to get past today)` : ""}.`;
      } else if (item.due) {
        next.due = undefined;
        next.anchor_day = undefined;
        dueText = "It was a one-off, so it no longer has a due date. Give next_due if there is a new one.";
      } else {
        dueText = "It has no due date.";
      }

      let history = `${todayDate} Handled${item.due ? ` (was due ${item.due})` : ""}`;
      if (note) history += `: ${note.trim()}`;
      let costText = "";
      if (new_cost !== undefined) {
        const now = formatMoney(new_cost, item.currency);
        if (item.cost !== undefined && item.cost !== new_cost) {
          const change = percentChange(item.cost, new_cost);
          costText = `${now}, was ${formatMoney(item.cost, item.currency)}${change ? `, ${change}` : ""}`;
        } else {
          costText = now;
        }
        history += `. Cost ${costText}`;
        next.cost = new_cost;
      }
      next.body = appendHistory(next.body ?? "", history);

      try {
        const saved = await store.save(next, { slug: item.slug, created: item.created });
        const reminder = saved.due
          ? ` Reminders from ${dueStatus(saved.due, todayDate, saved.remind_days).remindFrom}.`
          : "";
        return textResult(
          `Marked **${saved.title}** as handled. ${dueText}${reminder}${costText ? ` Cost now ${costText}.` : ""}`
        );
      } catch (err) {
        return textResult(errorMessage(err), true);
      }
    }
  );

  server.registerTool(
    "export_calendar",
    {
      title: "Export to calendar",
      description:
        "Write every item that has a due date to an .ics file the user can import into Apple Calendar, Google " +
        "Calendar or Outlook. Each item becomes an all-day event with a 9am reminder when its reminder window " +
        "opens and another on the day; repeating items repeat in the calendar. After changes, export again and " +
        "import into the same calendar to update the events. Provider and cost are included unless `minimal` is " +
        "true; references and notes never are. Calendars often sync to a cloud account, so tell the user that.",
      inputSchema: {
        minimal: z.boolean().optional().describe("Leave out provider and cost (titles and dates only)"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ minimal }) => {
      const { ics, events, skipped } = buildCalendar(await store.loadAll(), new Date(), { minimal });
      if (!events) return textResult("No items have a due date yet, so there is nothing to put in a calendar.");
      const file = await store.writeExport("life-admin.ics", ics);
      return textResult(
        [
          `Wrote ${events} item(s) to ${file}`,
          skipped ? `${skipped} item(s) without a due date were left out.` : "",
          minimal ? "Titles and dates only." : "Events include provider and cost. References and notes are left out.",
          "To add them: on a Mac, double-click the file to open it in Calendar. In Google Calendar, use " +
            'Settings > Import & export > Import. Import into a calendar of its own (such as "Life Admin"), and ' +
            "import later exports into the same one so events are updated rather than duplicated.",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete item",
      description:
        "Stop tracking an item. It moves to the trash and can be brought back with restore_item. Confirm with " +
        "the user first.",
      inputSchema: { item: z.string().min(1).describe("The item's exact title") },
      annotations: DESTRUCTIVE,
    },
    async ({ item: query }) => {
      // Exact matches only: a fuzzy guess must never decide what gets deleted.
      const item = await store.findBySlugOrTitle(query);
      if (!item) return textResult((await resolve(query)).message, true);
      const ok = await store.delete(item.slug);
      return ok
        ? textResult(`Moved "${item.title}" to the trash. restore_item brings it back.`)
        : textResult(`Could not delete "${item.title}".`, true);
    }
  );

  server.registerTool(
    "restore_item",
    {
      title: "Restore item",
      description: "Bring back the most recently deleted item with this title.",
      inputSchema: { item: z.string().min(1).describe("The deleted item's title") },
      annotations: WRITE,
    },
    async ({ item: query }) => {
      const restored = await store.restore(query);
      return restored
        ? textResult(`Restored.\n\n${describeItem(restored, today())}`)
        : textResult(`Nothing called "${query}" in the trash.`, true);
    }
  );

  registerMoneyTools(server, store, new MoneyStore(store.root));

  let dashboard: RunningDashboard | undefined;
  server.registerTool(
    "open_home_screen",
    {
      title: "Open home screen",
      description:
        "Open the person's home screen in their web browser: what's coming up, the next payday and the bills " +
        "before it, this week's spending and the rainy-day pot, in large, calm print with a Print button. It runs " +
        "only on this computer, and stays available while this assistant session is open.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      dashboard ??= await startDashboard(store, Number(process.env.LIFE_ADMIN_PORT ?? 4747));
      openInBrowser(dashboard.url);
      return textResult(
        `The home screen is open at ${dashboard.url} (only on this computer). If no browser window appeared, open that address yourself.`
      );
    }
  );

  return server;
}
