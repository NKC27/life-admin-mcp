import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ITEM_TYPES } from "../src/types.js";
import { CATEGORY_IDS } from "../src/money.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
/** The public skill, plus any others named in SKILL_DIRS (colon-separated), e.g. the private Pro skill. */
const skillDirs = [
  path.join(projectRoot, "skill", "life-admin"),
  ...(process.env.SKILL_DIRS ?? "")
    .split(":")
    .filter(Boolean)
    .map((d) => path.resolve(d)),
];

let client: Client;
let folder: string;
let toolSchemas: Map<string, Set<string>>;
/** Every argument name of every tool, so `remind_days` in prose is not mistaken for a tool. */
let argumentNames: Set<string>;

async function markdownFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? markdownFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  );
  return files.flat().filter((f) => f.endsWith(".md"));
}

/** Names of keys at the top level of a call's argument text, ignoring nested objects and quoted strings. */
function topLevelKeys(args: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let token = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      token = "";
    } else if ("{[(<".includes(c)) {
      depth++;
      token = "";
    } else if ("}])>".includes(c)) {
      depth--;
      token = "";
    } else if (c === ":" && depth === 0 && /^[A-Za-z]\w*$/.test(token)) {
      keys.push(token);
      token = "";
    } else if (/\w/.test(c)) {
      token += c;
    } else {
      token = "";
    }
  }
  return keys;
}

/** Every `tool_name(...)` call in some markdown, with the keys passed to it. */
function findCalls(text: string): { name: string; keys: string[] }[] {
  const calls: { name: string; keys: string[] }[] = [];
  const start = /`?([a-z]+(?:_[a-z]+)+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(text))) {
    let depth = 1;
    let quote: string | null = null;
    let i = start.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    calls.push({ name: m[1]!, keys: topLevelKeys(text.slice(start.lastIndex, i - 1)) });
  }
  return calls;
}

before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "la-skill-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  env.LIFE_ADMIN_PATH = folder;
  client = new Client({ name: "skill-lint", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [path.join(projectRoot, "dist", "index.js")], env })
  );

  const { tools } = await client.listTools();
  toolSchemas = new Map(
    tools.map((t) => [t.name, new Set(Object.keys((t.inputSchema as { properties?: object }).properties ?? {}))])
  );
  argumentNames = new Set([...toolSchemas.values()].flatMap((s) => [...s]));
});

after(async () => {
  await client.close();
  await fs.rm(folder, { recursive: true, force: true });
});

for (const skillDir of skillDirs) {
  test(`[${path.basename(skillDir)}] SKILL.md has valid, well-sized frontmatter and stays concise`, async () => {
    const raw = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8");
    const { data, content } = matter(raw);
    assert.match(data.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "name must be lowercase letters, digits and hyphens");
    assert.equal(data.name, path.basename(skillDir), "name must match the folder name");
    assert.ok(typeof data.description === "string");
    assert.ok(
      data.description.length >= 150 && data.description.length <= 1024,
      `description is ${data.description.length} chars`
    );
    assert.doesNotMatch(data.description, /[<>]/);
    assert.ok(content.split("\n").length <= 200, "SKILL.md should stay a concise router");
  });

  test(`[${path.basename(skillDir)}] every file SKILL.md points to exists`, async () => {
    const text = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8");
    const refs = new Set([...text.matchAll(/`((?:workflows|reference|examples)\/[\w./-]+)`/g)].map((m) => m[1]!));
    assert.ok(refs.size >= 3, "expected the reference files to be linked");
    for (const ref of refs) {
      await fs.access(path.join(skillDir, ref));
    }
    // Every workflow file is reachable from the router.
    const workflows = await fs.readdir(path.join(skillDir, "workflows")).catch(() => [] as string[]);
    for (const file of workflows) {
      assert.ok(text.includes(`workflows/${file}`), `${file} is not linked from SKILL.md`);
    }
  });

  test(`[${path.basename(skillDir)}] every tool named in the skill really exists`, async () => {
    const unknown: string[] = [];
    for (const file of await markdownFiles(skillDir)) {
      const text = await fs.readFile(file, "utf-8");
      for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)(?=[`(])/g)) {
        const name = m[1]!;
        if (!toolSchemas.has(name) && !argumentNames.has(name))
          unknown.push(`${path.relative(skillDir, file)}: ${name}`);
      }
    }
    assert.deepEqual(unknown, []);
  });

  test(`[${path.basename(skillDir)}] every argument used in a documented tool call is a real argument`, async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of await markdownFiles(skillDir)) {
      for (const call of findCalls(await fs.readFile(file, "utf-8"))) {
        const schema = toolSchemas.get(call.name);
        if (!schema) continue;
        checked++;
        for (const key of call.keys) {
          if (!schema.has(key)) problems.push(`${path.relative(skillDir, file)}: ${call.name}(${key}: ...)`);
        }
      }
    }
    const hasExamples = await fs.access(path.join(skillDir, "examples")).then(
      () => true,
      () => false
    );
    if (hasExamples) assert.ok(checked >= 10, `only ${checked} calls were checked; the parser may be broken`);
    assert.deepEqual(problems, []);
  });

  test(`[${path.basename(skillDir)}] reference/tools.md documents every tool with exactly its real arguments`, async () => {
    const text = await fs.readFile(path.join(skillDir, "reference", "tools.md"), "utf-8");
    const documented = new Map<string, Set<string>>();
    for (const line of text.split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      const name = cells[1]?.match(/^`([a-z_]+)`$/)?.[1];
      if (!name || !toolSchemas.has(name)) continue;
      documented.set(name, new Set([...(cells[2] ?? "").matchAll(/`([A-Za-z_]+)\??`/g)].map((m) => m[1]!)));
    }
    assert.deepEqual([...documented.keys()].sort(), [...toolSchemas.keys()].sort(), "tools.md must cover every tool");
    for (const [name, args] of documented) {
      assert.deepEqual([...args].sort(), [...toolSchemas.get(name)!].sort(), `arguments of ${name} are out of date`);
    }
  });

  test(`[${path.basename(skillDir)}] documented item types and categories match the server`, async () => {
    const text = await fs.readFile(path.join(skillDir, "reference", "tools.md"), "utf-8");
    const typesLine = text.split("\n").find((l) => l.includes("Types: renewal"));
    assert.ok(typesLine, "item type list not found in tools.md");
    const types = typesLine
      .match(/Types: ([a-z, ]+)\./)![1]!
      .split(", ")
      .sort();
    assert.deepEqual(types, [...ITEM_TYPES].sort());
    const categoriesLine = text.split("\n").find((l) => l.startsWith("Categories:"));
    assert.ok(categoriesLine, "category list not found in tools.md");
    const categories = [...categoriesLine.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!).sort();
    assert.deepEqual(categories, [...CATEGORY_IDS].sort());
  });

  test(`[${path.basename(skillDir)}] web links only point to official or vetted sources`, async () => {
    const allowed =
      /^https:\/\/(www\.)?(gov\.uk|ofgem\.gov\.uk|ofcom\.org\.uk|fca\.org\.uk|ncsc\.gov\.uk|tvlicensing\.co\.uk|moneyhelper\.org\.uk|stepchange\.org|nodejs\.org)(\/|$)/;
    const bad: string[] = [];
    for (const file of await markdownFiles(skillDir)) {
      for (const m of (await fs.readFile(file, "utf-8")).matchAll(/https?:\/\/[^\s)>\]]+/g)) {
        const local = /^http:\/\/127\.0\.0\.1[:/]/.test(m[0]); // the home screen on this computer
        if (!allowed.test(m[0]) && !local) bad.push(`${path.relative(skillDir, file)}: ${m[0]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test(`[${path.basename(skillDir)}] the skill makes no network or shell promises it cannot keep`, async () => {
    for (const file of await markdownFiles(skillDir)) {
      const text = await fs.readFile(file, "utf-8");
      assert.doesNotMatch(text, /curl |wget |eval\(|base64 -d/i, `${file} contains a risky command`);
    }
  });
}
