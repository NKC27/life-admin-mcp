import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
const serverEntry = path.join(projectRoot, "dist", "index.js");

const TODAY = "2026-11-11";

let client: Client;
let folder: string;

async function call(name: string, args: Record<string, unknown> = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError === true, text: content.map((c) => c.text).join("\n") };
  } catch (err) {
    return { isError: true, text: err instanceof Error ? err.message : String(err) };
  }
}

before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "la-e2e-"));
  await fs.cp(path.join(projectRoot, "demo"), folder, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  env.LIFE_ADMIN_PATH = folder;
  env.LIFE_ADMIN_TODAY = TODAY;
  client = new Client({ name: "e2e-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverEntry], env }));
});

after(async () => {
  await client.close();
  await fs.rm(folder, { recursive: true, force: true });
});

test("advertises every tool with a safety annotation and a useful description", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_item",
    "delete_item",
    "due_soon",
    "get_item",
    "get_stats",
    "list_items",
    "mark_handled",
    "restore_item",
    "search_items",
    "update_item",
  ]);
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const tool of tools) {
    assert.ok(tool.annotations, `${tool.name} is missing annotations`);
    assert.ok(tool.description && tool.description.length > 30, `${tool.name} needs a useful description`);
  }
  for (const name of ["get_stats", "list_items", "get_item", "search_items", "due_soon"])
    assert.equal(byName.get(name)!.annotations!.readOnlyHint, true, name);
  assert.equal(byName.get("delete_item")!.annotations!.destructiveHint, true);
  assert.equal(byName.get("add_item")!.annotations!.readOnlyHint, false);
});

test("get_stats reports the folder, counts and what's due", async () => {
  const result = await call("get_stats");
  assert.equal(result.isError, false);
  assert.match(result.text, /set by LIFE_ADMIN_PATH/);
  assert.match(result.text, /Items: 4/);
  assert.match(result.text, /policy: 1/);
  assert.match(result.text, /Overdue: 0/);
  assert.match(result.text, /Due in the next 30 days: 1/);
  assert.match(result.text, /Today is 2026-11-11\./);
});

test("list_items sorts by due date, filters by type and formats costs in pounds", async () => {
  const all = await call("list_items");
  const titles = [...all.text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Streaming service", "Car insurance", "Washing machine warranty", "Passport"]);
  assert.match(all.text, /£10\.99\/month/);
  assert.match(all.text, /£412\.00\/year/);
  assert.equal((await call("list_items", { type: "vehicle" })).text, "No vehicle items yet.");
});

test("due_soon looks ahead the requested number of days", async () => {
  const month = await call("due_soon");
  assert.match(month.text, /^Today is 2026-11-11\./);
  assert.match(month.text, /Due in the next 30 days:\n- \*\*Streaming service\*\*.*due 2026-11-28, in 17 days/);
  assert.doesNotMatch(month.text, /Car insurance/);

  const season = await call("due_soon", { days: 120 });
  assert.match(season.text, /Car insurance.*in 112 days.*renews automatically/);
  assert.doesNotMatch(season.text, /Passport/);
});

test("add_item stores what the user said and refuses duplicates, card numbers and bad dates", async () => {
  const added = await call("add_item", {
    title: "Council tax",
    type: "bill",
    provider: "Example Borough Council",
    cost: 180,
    period: "monthly",
    due: "2026-11-05",
    remind_days: 7,
    ref: "CT-00123456",
    notes: "Band C. Paid by direct debit.",
  });
  assert.equal(added.isError, false, added.text);
  assert.match(added.text, /Due: 2026-11-05 \(6 days ago\)/);
  assert.match(added.text, /Ref: …3456/);

  const dupe = await call("add_item", { title: "council tax", type: "bill" });
  assert.equal(dupe.isError, true);
  assert.match(dupe.text, /already exists/);

  const card = await call("add_item", { title: "Gym", type: "subscription", notes: "card 4111 1111 1111 1111" });
  assert.equal(card.isError, true);
  assert.match(card.text, /full card number/);

  const badDate = await call("add_item", { title: "Gym", type: "subscription", due: "next Friday" });
  assert.equal(badDate.isError, true);
  assert.match(badDate.text, /YYYY-MM-DD/);
});

test("due_soon lists overdue items first", async () => {
  const result = await call("due_soon");
  assert.match(result.text, /Overdue:\n- \*\*Council tax\*\*.*6 days ago/);
  assert.ok(result.text.indexOf("Overdue") < result.text.indexOf("Due in the next"));
});

test("a long reminder window shows up early in due_soon", async () => {
  // Car insurance is due 2027-03-03 (112 days away). A 120-day reminder opened on 2026-11-03.
  await call("update_item", { item: "Car insurance", remind_days: 120 });
  const open = await call("due_soon");
  assert.match(
    open.text,
    /reminder window is open:\n- \*\*Car insurance\*\*.*in 112 days, reminders started 2026-11-03/
  );

  // 365 days before 2028-06-14 is 2027-06-15 (2028 is a leap year), so the warranty is not shown yet.
  await call("update_item", { item: "Washing machine warranty", remind_days: 365 });
  assert.doesNotMatch((await call("due_soon")).text, /Washing machine/);

  await call("update_item", { item: "Car insurance", remind_days: 21 });
  assert.doesNotMatch((await call("due_soon")).text, /Car insurance/);
});

test("get_item explains the dates, and a typo gets a suggestion instead of a guess", async () => {
  const car = await call("get_item", { item: "car insurance" });
  assert.match(car.text, /Due: 2027-03-03 \(in 112 days\), reminders from 2027-02-10/);
  assert.match(car.text, /Renews automatically/);

  const typo = await call("get_item", { item: "car insurence" });
  assert.equal(typo.isError, true);
  assert.match(typo.text, /Did you mean "Car insurance"\?/);
});

test("search_items matches titles, providers, tags and notes", async () => {
  assert.match((await call("search_items", { query: "warranty" })).text, /Washing machine warranty/);
  assert.match((await call("search_items", { query: "kitchen drawer" })).text, /Washing machine warranty/);
  assert.match((await call("search_items", { query: "borough" })).text, /Council tax/);
  assert.match((await call("search_items", { query: "zebra" })).text, /Nothing matches/);
});

test("update_item changes only what it is given, clears fields and logs notes", async () => {
  const result = await call("update_item", {
    item: "Car insurance",
    cost: 430,
    clear: ["ref"],
    add_note: "Got a quote from a comparison site",
  });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /Cost: £430\.00 per year/);
  assert.doesNotMatch(result.text, /Ref:/);
  assert.match(result.text, /Example Motor Insurance/, "provider untouched");
  assert.match(result.text, /- 2026-03-03 Renewed at £412 \(was £356\)\n- 2026-11-11 Got a quote/);
});

test("mark_handled rolls a stale monthly bill past today", async () => {
  const result = await call("mark_handled", { item: "Council tax", note: "Paid" });
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /Next due 2026-12-05\. Reminders from 2026-11-28\./);
  const item = await call("get_item", { item: "Council tax" });
  assert.match(item.text, /- 2026-11-11 Handled \(was due 2026-11-05\): Paid/);
});

test("mark_handled logs a price rise with the old price and percentage", async () => {
  const result = await call("mark_handled", { item: "Streaming service", new_cost: 12.99 });
  assert.match(result.text, /Next due 2026-12-28\./);
  assert.match(result.text, /Cost now £12\.99, was £10\.99, \+18%/);
  const item = await call("get_item", { item: "Streaming service" });
  assert.match(item.text, /Cost: £12\.99 per month/);
  assert.match(item.text, /Handled \(was due 2026-11-28\)\. Cost £12\.99, was £10\.99, \+18%/);
});

test("mark_handled on one-off items clears the date or takes an explicit next one", async () => {
  const renewed = await call("mark_handled", { item: "Passport", note: "Renewed", next_due: "2036-11-01" });
  assert.match(renewed.text, /Next due 2036-11-01/);

  const done = await call("mark_handled", { item: "Washing machine warranty", note: "Machine replaced" });
  assert.match(done.text, /no longer has a due date/);
  assert.doesNotMatch((await call("get_item", { item: "Washing machine warranty" })).text, /^Due:/m);

  const bad = await call("mark_handled", { item: "Passport", next_due: "2036-02-30" });
  assert.equal(bad.isError, true);
});

test("a month-end monthly bill keeps returning to the 31st", async () => {
  await call("add_item", { title: "Rent", type: "bill", period: "monthly", cost: 950, due: "2027-01-31" });
  assert.match((await call("mark_handled", { item: "Rent" })).text, /Next due 2027-02-28/);
  assert.match((await call("mark_handled", { item: "Rent" })).text, /Next due 2027-03-31/);
  assert.match((await call("mark_handled", { item: "Rent" })).text, /Next due 2027-04-30/);
});

test("delete_item needs an exact title, and restore_item brings it back", async () => {
  const fuzzy = await call("delete_item", { item: "Rnt" });
  assert.equal(fuzzy.isError, true);
  assert.match(fuzzy.text, /Did you mean "Rent"/);
  assert.match((await call("get_item", { item: "Rent" })).text, /Rent/, "nothing was deleted");

  assert.match((await call("delete_item", { item: "Rent" })).text, /Moved "Rent" to the trash/);
  assert.equal((await call("get_item", { item: "Rent" })).isError, true);
  const restored = await call("restore_item", { item: "Rent" });
  assert.match(restored.text, /Due: 2027-04-30/);
});
