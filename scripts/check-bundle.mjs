// Unpacks life-admin.mcpb and starts it the way Claude Desktop does, then uses it like a new user:
// a folder that doesn't exist yet, the country and region typed in plain words, and the home screen opened.
//   node scripts/check-bundle.mjs   (run automatically by `npm run bundle`)
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = await fs.mkdtemp(path.join(os.tmpdir(), "la-bundle-check-"));
const unpacked = path.join(work, "extension");
execFileSync(
  path.join(root, "node_modules", ".bin", "mcpb"),
  ["unpack", path.join(root, "life-admin.mcpb"), unpacked],
  {
    stdio: "ignore",
  }
);

// What Claude Desktop does with the manifest: substitute ${__dirname} and the user's settings.
const manifest = JSON.parse(await fs.readFile(path.join(unpacked, "manifest.json"), "utf-8"));
const folder = path.join(work, "home", "LifeAdmin"); // does not exist yet, like a first install
const settings = { folder, country: "United Kingdom", region: "Scotland", currency: "" };
const fill = (s) =>
  s.replaceAll("${__dirname}", unpacked).replace(/\$\{user_config\.(\w+)\}/g, (_, k) => String(settings[k] ?? ""));
const cfg = manifest.server.mcp_config;
const env = Object.fromEntries(Object.entries(cfg.env ?? {}).map(([k, v]) => [k, fill(v)]));

const client = new Client({ name: "bundle-check", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath, // Claude Desktop supplies its own Node.js for "node" servers
    args: cfg.args.map(fill),
    env: {
      PATH: process.env.PATH ?? "",
      HOME: path.join(work, "home"),
      ...env,
      LIFE_ADMIN_NO_BROWSER: "1",
      LIFE_ADMIN_PORT: "0",
    },
  })
);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text).join("\n");
  assert.notEqual(r.isError, true, `${name} failed: ${text}`);
  return text;
};

try {
  const { tools } = await client.listTools();
  assert.equal(tools.length, manifest.tools.length, "manifest lists every tool");

  const stats = await call("get_stats");
  assert.match(stats, /set by LIFE_ADMIN_PATH/);
  assert.match(stats, /Country: Scotland · currency GBP/, "country and region from the installer");
  await fs.access(path.join(folder, "items"));
  assert.match(await fs.readFile(path.join(folder, "README.md"), "utf-8"), /Life Admin/, "welcome note written");

  // Due in 10 days, so it shows under "Coming up" (which covers the next 30 days).
  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await call("add_item", { title: "Council tax", type: "bill", cost: 168, period: "monthly", due: soon });
  assert.match(await call("list_items"), /Council tax/);
  assert.match(
    await call("bank_holidays", { days: 400 }),
    /Scotland[\s\S]*St Andrew/,
    "region typed as 'Scotland' works"
  );
  assert.match(await call("export_calendar"), /Wrote 1 item/);

  const statement = path.join(work, "statement.csv");
  await fs.writeFile(statement, "Date,Description,Amount\n09/11/2026,TESCO STORES,-20.00\n");
  assert.match(await call("import_bank_file", { path: statement }), /1 new/);

  const opened = await call("open_home_screen");
  const url = opened.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  assert.ok(url, opened);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Coming up[\s\S]*Council tax/);
  assert.equal((await fetch(new URL("app.css", url))).status, 200, "home screen styles are in the bundle");

  console.log(`Bundle check passed: ${tools.length} tools, first-run folder created, home screen served.`);
} finally {
  await client.close();
  await fs.rm(work, { recursive: true, force: true });
}
