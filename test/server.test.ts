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
  client = new Client({ name: "e2e-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverEntry], env }));
});

after(async () => {
  await client.close();
  await fs.rm(folder, { recursive: true, force: true });
});

test("advertises every tool with a safety annotation and a useful description", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_stats", "list_items"]);
  for (const tool of tools) {
    assert.ok(tool.annotations, `${tool.name} is missing annotations`);
    assert.ok(tool.description && tool.description.length > 30, `${tool.name} needs a useful description`);
    assert.equal(tool.annotations!.readOnlyHint, true);
  }
});

test("get_stats reports the folder and counts by type", async () => {
  const result = await call("get_stats");
  assert.equal(result.isError, false);
  assert.match(result.text, new RegExp(`Folder: ${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.text, /set by LIFE_ADMIN_PATH/);
  assert.match(result.text, /Items: 4/);
  assert.match(result.text, /policy: 1/);
  assert.match(result.text, /With a due date: 4/);
});

test("list_items sorts by due date, filters by type and formats costs in pounds", async () => {
  const all = await call("list_items");
  const titles = [...all.text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Streaming service", "Car insurance", "Washing machine warranty", "Passport"]);
  assert.match(all.text, /£10\.99\/month/);
  assert.match(all.text, /£412\.00\/year/);

  const policies = await call("list_items", { type: "policy" });
  assert.match(policies.text, /Car insurance/);
  assert.doesNotMatch(policies.text, /Passport/);

  const vehicles = await call("list_items", { type: "vehicle" });
  assert.equal(vehicles.text, "No vehicle items yet.");
});
