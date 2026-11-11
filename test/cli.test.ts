import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, "..");
const entry = path.join(projectRoot, "dist", "index.js");

async function cli(args: string[], env: Record<string, string> = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  delete base.LIFE_ADMIN_PATH;
  try {
    const { stdout, stderr } = await run(process.execPath, [entry, ...args], { env: { ...base, ...env } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

test("--version matches package.json and --help lists the commands", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf-8")) as { version: string };
  assert.equal((await cli(["--version"])).stdout.trim(), pkg.version);

  const help = await cli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /init/);
  assert.match(help.stdout, /doctor/);
});

test("unknown commands fail loudly instead of silently starting a server", async () => {
  const result = await cli(["frobnicate"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown command "frobnicate"/);
});

test("init creates a usable folder, is idempotent, and prints setup for every client", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "la-cli-home-"));
  const first = await cli(["init"], { HOME: home });
  assert.equal(first.code, 0);
  assert.match(first.stdout, /Created your life-admin folder at/);
  assert.match(first.stdout, /claude mcp add --scope user life-admin -- node /);
  assert.match(first.stdout, /"mcpServers"/);
  assert.match(first.stdout, /"servers"/);
  assert.doesNotMatch(first.stdout, /-e LIFE_ADMIN_PATH|"LIFE_ADMIN_PATH"/, "default location needs no env var");

  const folder = path.join(home, "LifeAdmin");
  assert.deepEqual(await fs.readdir(path.join(folder, "items")), []);
  const readme = path.join(folder, "README.md");
  assert.match(await fs.readFile(readme, "utf-8"), /last four digits/);

  await fs.writeFile(readme, "my own edits");
  const second = await cli(["init"], { HOME: home });
  assert.match(second.stdout, /already exists/);
  assert.equal(await fs.readFile(readme, "utf-8"), "my own edits");
  await fs.rm(home, { recursive: true, force: true });
});

test("init --dir uses a custom folder and tells you to set LIFE_ADMIN_PATH", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "la-cli-custom-"));
  const target = path.join(dir, "my admin");
  const result = await cli(["init", "--dir", target]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /-e LIFE_ADMIN_PATH=/);
  assert.match(result.stdout, /"LIFE_ADMIN_PATH"/);
  await fs.access(path.join(target, "items"));
  await fs.rm(dir, { recursive: true, force: true });
});

test("a freshly initialised folder passes doctor, including the live handshake", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "la-cli-doctor-"));
  await cli(["init"], { HOME: home });
  const result = await cli(["doctor"], { HOME: home });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /your ~\/LifeAdmin folder/);
  assert.match(result.stdout, /0 item\(s\)/);
  assert.match(result.stdout, /Server handshake succeeded: \d+ tools available/);
  await fs.rm(home, { recursive: true, force: true });
});

test("doctor flags malformed items and card numbers as warnings, not failures", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "la-cli-warn-"));
  await fs.mkdir(path.join(dir, "items"), { recursive: true });
  await fs.writeFile(path.join(dir, "items", "good.md"), "---\ntitle: Good\ntype: bill\ndue: '2027-01-01'\n---\n");
  await fs.writeFile(path.join(dir, "items", "bad-date.md"), "---\ntitle: Bad\ntype: bill\ndue: soon\n---\n");
  await fs.writeFile(
    path.join(dir, "items", "card.md"),
    "---\ntitle: Card\ntype: bill\n---\npaid with 4111 1111 1111 1111\n"
  );

  const result = await cli(["doctor"], { LIFE_ADMIN_PATH: dir });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /3 item\(s\), 1 with a due date/);
  assert.match(result.stdout, /\[warn\].*bad-date: due date "soon"/);
  assert.match(result.stdout, /\[warn\].*Possible full card number in: card/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("doctor on the demo folder warns you to create your own", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "la-cli-demo-"));
  const result = await cli(["doctor"], { HOME: home });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /\[warn\].*demo folder/);
  assert.match(result.stdout, /Every item file is well formed/);
  await fs.rm(home, { recursive: true, force: true });
});
