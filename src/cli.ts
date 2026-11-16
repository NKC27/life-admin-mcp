import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { defaultHomeFolder, describeSource, resolveFolder } from "./config.js";
import { Store } from "./store.js";
import { containsCardNumber } from "./util.js";
import { today } from "./dates.js";
import { dueReport } from "./report.js";
import { buildCalendar } from "./calendar.js";
import { openInBrowser, startDashboard } from "./dashboard.js";
import { VERSION } from "./version.js";

const PACKAGE = "@nkc27/life-admin-mcp";

const HELP = `life-admin-mcp ${VERSION}
Local-first life admin for AI agents, served over MCP: renewals, bills, subscriptions, warranties.

Usage:
  life-admin-mcp                 Start the MCP server on stdio (what your AI client runs)
  life-admin-mcp init [--dir D]  Create your own folder (default: ~/LifeAdmin) and print setup steps
  life-admin-mcp doctor          Check your setup and run a live handshake against the server
  life-admin-mcp dashboard [--port N] [--no-open]
                                 Open the home screen in your browser (this computer only)
  life-admin-mcp due [--days N]  Print what's overdue and due soon (default: next 30 days)
  life-admin-mcp ics [--out F] [--minimal]
                                 Write a calendar file of every due date (default: <folder>/exports/life-admin.ics)
  life-admin-mcp --version       Print the version

Environment:
  LIFE_ADMIN_PATH  Use this folder (overrides ~/LifeAdmin and the demo folder)
  DEBUG_MCP=1      Log debug output to stderr
`;

const entryPath = fileURLToPath(new URL("./index.js", import.meta.url));

/** Handle CLI subcommands. Returns an exit code, or null when the server should start. */
export async function runCli(args: string[]): Promise<number | null> {
  const [command, ...rest] = args;
  switch (command) {
    case undefined:
    case "serve":
    case "--stdio":
      return null;
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return 0;
    case "-v":
    case "--version":
    case "version":
      console.log(VERSION);
      return 0;
    case "init":
      return init(rest);
    case "doctor":
      return doctor();
    case "due":
      return due(rest);
    case "dashboard":
      return dashboard(rest);
    case "ics":
      return ics(rest);
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const README = `# Life Admin

Everything your AI assistant tracks for you lives in \`items/\`, one markdown file per thing:
a bill, a renewal, a subscription, a warranty, a policy, a vehicle or a document.
Open any file to see exactly what your assistant sees, and edit it by hand if you like.

Things to try:

- "Add my car insurance: Admiral, £412 a year, renews 3 March 2027"
- "What's coming up in the next 30 days?"
- "What do I spend on subscriptions?"

Privacy: this folder never leaves your computer. Store only the last four digits of any
account or card number; the server refuses full card numbers.
`;

function setupInstructions(folder: string, isDefaultLocation: boolean): string {
  const viaNpx = entryPath.includes(`${path.sep}_npx${path.sep}`);
  const command = viaNpx ? "npx" : "node";
  const argList = viaNpx ? ["-y", PACKAGE] : [entryPath];
  const server = { command, args: argList, ...(isDefaultLocation ? {} : { env: { LIFE_ADMIN_PATH: folder } }) };
  const claudeCodeEnv = isDefaultLocation ? "" : ` -e LIFE_ADMIN_PATH=${JSON.stringify(folder)}`;
  const block = (value: unknown) =>
    JSON.stringify(value, null, 2)
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");

  return [
    "Connect it to your AI client (then restart the client):",
    "",
    "  Claude Code",
    `    claude mcp add --scope user life-admin${claudeCodeEnv} -- ${command} ${argList.join(" ")}`,
    "",
    "  Claude Desktop (claude_desktop_config.json) and Cursor (.cursor/mcp.json)",
    block({ mcpServers: { "life-admin": server } }),
    "",
    "  VS Code (.vscode/mcp.json)",
    block({ servers: { "life-admin": server } }),
    "",
  ].join("\n");
}

async function init(args: string[]): Promise<number> {
  const dirFlag = args.indexOf("--dir");
  const customDir = dirFlag >= 0 ? args[dirFlag + 1] : undefined;
  if (dirFlag >= 0 && !customDir) {
    console.error("--dir needs a folder path.");
    return 2;
  }
  const dir = path.resolve(customDir ?? defaultHomeFolder());
  const isDefault = !customDir || dir === defaultHomeFolder();

  const exists = await fs
    .stat(path.join(dir, "items"))
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (exists) {
    console.log(`A life-admin folder already exists at ${dir}. Leaving it untouched.\n`);
  } else {
    await fs.mkdir(path.join(dir, "items"), { recursive: true });
    await fs.writeFile(path.join(dir, "README.md"), README, "utf-8");
    console.log(`Created your life-admin folder at ${dir}\n`);
  }

  console.log(setupInstructions(dir, isDefault));
  if (isDefault) console.log("Your folder is at the default location, so no LIFE_ADMIN_PATH setting is needed.");
  console.log(`Check everything with:  npx -y ${PACKAGE} doctor`);
  return 0;
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

type Level = "ok" | "warn" | "fail";

async function doctor(): Promise<number> {
  const results: { level: Level; text: string }[] = [];
  const report = (level: Level, text: string) => results.push({ level, text });

  const major = Number.parseInt(process.versions.node.split(".")[0]!, 10);
  report(
    major >= 18 ? "ok" : "fail",
    `Node.js ${process.versions.node}${major >= 18 ? "" : " (version 18 or newer is required)"}`
  );

  const location = resolveFolder();
  report("ok", `Folder: ${location.path} (${describeSource(location.source)})`);
  if (location.source === "demo") {
    report("warn", `You are using the demo folder. Run \`npx -y ${PACKAGE} init\` to create your own.`);
  }

  const store = new Store(location.path);
  const itemsDirExists = await fs
    .stat(path.join(location.path, "items"))
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!itemsDirExists) {
    report("warn", "No items/ folder yet. It will be created the first time the server starts.");
  } else {
    try {
      const probe = path.join(location.path, ".doctor-write-test");
      await fs.writeFile(probe, "ok");
      await fs.unlink(probe);
      report("ok", "The folder is writable");
    } catch {
      report("fail", "The folder is not writable, so items cannot be saved");
    }

    const slugs = await store.listSlugs();
    const problems: string[] = [];
    const cardNumbers: string[] = [];
    let dated = 0;
    for (const slug of slugs) {
      const parsed = await store.parse(slug);
      if (!parsed) continue;
      if (parsed.item.due) dated += 1;
      for (const p of parsed.problems) problems.push(`${slug}: ${p}`);
      const raw = await fs.readFile(path.join(location.path, "items", `${slug}.md`), "utf-8");
      if (containsCardNumber(raw)) cardNumbers.push(slug);
    }
    report("ok", `${slugs.length} item(s), ${dated} with a due date`);

    if (problems.length) {
      report(
        "warn",
        `${problems.length} problem(s) in item files: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; ..." : ""}`
      );
    } else if (slugs.length) {
      report("ok", "Every item file is well formed");
    }
    if (cardNumbers.length) {
      report(
        "warn",
        `Possible full card number in: ${cardNumbers.slice(0, 3).join(", ")}. Keep only the last four digits.`
      );
    }
  }

  // Live handshake: start the server exactly as an AI client would and ask it a question.
  let client: Client | undefined;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
      string,
      string
    >;
    env.LIFE_ADMIN_PATH = location.path;
    client = new Client({ name: "life-admin-doctor", version: VERSION });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entryPath], env }));
    const { tools } = await client.listTools();
    const stats = await client.callTool({ name: "get_stats", arguments: {} });
    report(stats.isError ? "fail" : "ok", `Server handshake succeeded: ${tools.length} tools available`);
  } catch (err) {
    report("fail", `Server handshake failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client?.close().catch(() => undefined);
  }

  const label: Record<Level, string> = { ok: "[ok]  ", warn: "[warn]", fail: "[FAIL]" };
  console.log(`life-admin-mcp ${VERSION}\n`);
  for (const r of results) console.log(`${label[r.level]} ${r.text}`);
  const failed = results.some((r) => r.level === "fail");
  console.log(failed ? "\nSome checks failed." : "\nEverything needed to run looks good.");
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// due and ics
// ---------------------------------------------------------------------------

/** Value after `--flag`, or undefined. Returns null when the flag is present without a value. */
function flagValue(args: string[], flag: string): string | undefined | null {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

async function openStore(): Promise<{ store: Store; demo: boolean }> {
  const location = resolveFolder();
  return { store: new Store(location.path), demo: location.source === "demo" };
}

async function due(args: string[]): Promise<number> {
  const raw = flagValue(args, "--days");
  const days = raw === undefined ? 30 : Number(raw);
  if (raw === null || !Number.isInteger(days) || days < 1 || days > 366) {
    console.error("--days needs a whole number from 1 to 366.");
    return 2;
  }
  const { store, demo } = await openStore();
  // Plain text in a terminal, so drop the markdown bold markers.
  console.log(dueReport(await store.loadAll(), today(), days).replace(/\*\*/g, ""));
  if (demo) console.log(`\n(These are the demo items. Run \`npx -y ${PACKAGE} init\` to start your own.)`);
  return 0;
}

async function ics(args: string[]): Promise<number> {
  const out = flagValue(args, "--out");
  if (out === null) {
    console.error("--out needs a file path.");
    return 2;
  }
  if (out !== undefined && !out.toLowerCase().endsWith(".ics")) {
    console.error("--out must be a file ending in .ics.");
    return 2;
  }
  const { store, demo } = await openStore();
  const {
    ics: text,
    events,
    skipped,
  } = buildCalendar(await store.loadAll(), new Date(), {
    minimal: args.includes("--minimal"),
  });
  if (!events) {
    console.log("No items have a due date yet, so there is nothing to put in a calendar.");
    return 0;
  }
  let file: string;
  if (out) {
    file = path.resolve(out);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf-8");
  } else {
    file = await store.writeExport("life-admin.ics", text);
  }
  console.log(`Wrote ${events} item(s) to ${file}`);
  if (skipped) console.log(`${skipped} item(s) without a due date were left out.`);
  console.log('Open it with your calendar app, ideally into a calendar of its own such as "Life Admin".');
  if (demo) console.log(`(These are the demo items. Run \`npx -y ${PACKAGE} init\` to start your own.)`);
  return 0;
}

async function dashboard(args: string[]): Promise<number> {
  const raw = flagValue(args, "--port");
  const port = raw === undefined ? 4747 : Number(raw);
  if (raw === null || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("--port needs a number from 0 to 65535.");
    return 2;
  }
  const { store } = await openStore();
  const running = await startDashboard(store, port);
  console.log(`Your home screen is at ${running.url}`);
  console.log("It is only visible on this computer. Press Ctrl+C to stop it.");
  if (!args.includes("--no-open")) openInBrowser(running.url);
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await running.close();
  return 0;
}
