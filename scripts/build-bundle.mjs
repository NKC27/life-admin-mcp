// Builds life-admin.mcpb, the one-click installer for Claude Desktop.
//   npm run bundle
//
// Stages a lean copy of the server (built code, data, home screen, demo, production dependencies only),
// fills in the manifest's version and tool list from the real server, validates it with the official
// mcpb tool, and packs it. Claude Desktop ships its own Node.js, so people need nothing else installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "build", "bundle");
const output = path.join(root, "life-admin.mcpb");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"));

await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });

// 1. The server and everything it reads at runtime.
for (const dir of ["dist", "data", "dashboard", "demo/items", "demo/money"]) {
  await fs.cp(path.join(root, dir), path.join(stage, dir), { recursive: true });
}
await fs.copyFile(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
await fs.copyFile(path.join(root, "bundle", "icon.png"), path.join(stage, "icon.png"));
await fs.mkdir(path.join(stage, "screenshots"), { recursive: true });
await fs.copyFile(
  path.join(root, "docs", "screenshots", "home-screen.png"),
  path.join(stage, "screenshots", "home-screen.png")
);

// 2. Production dependencies only, exactly as locked.
const lean = {
  name: pkg.name,
  version: pkg.version,
  type: "module",
  license: pkg.license,
  dependencies: pkg.dependencies,
};
await fs.writeFile(path.join(stage, "package.json"), `${JSON.stringify(lean, null, 2)}\n`);
await fs.copyFile(path.join(root, "package-lock.json"), path.join(stage, "package-lock.json"));
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"], stage);

// 3. Ask the staged server itself for its tools, so the manifest can never drift from the code.
const client = new Client({ name: "bundle-builder", version: pkg.version });
const probe = await fs.mkdtemp(path.join(stage, ".probe-"));
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(stage, "dist", "index.js")],
    env: { ...process.env, LIFE_ADMIN_PATH: probe, LIFE_ADMIN_NO_BROWSER: "1" },
  })
);
const { tools } = await client.listTools();
await client.close();
await fs.rm(probe, { recursive: true, force: true });

const firstSentence = (text) => (text ?? "").split(/(?<=\.)\s/)[0].trim();
const manifest = JSON.parse(await fs.readFile(path.join(root, "bundle", "manifest.json"), "utf-8"));
manifest.version = pkg.version;
manifest.tools = tools.map((t) => ({ name: t.name, description: firstSentence(t.description) }));
await fs.writeFile(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. Validate and pack with the official tool.
const mcpb = path.join(root, "node_modules", ".bin", "mcpb");
run(mcpb, ["validate", path.join(stage, "manifest.json")]);
await fs.rm(output, { force: true });
run(mcpb, ["pack", stage, output]);

const size = (await fs.stat(output)).size;
console.log(
  `\nBuilt ${path.relative(root, output)} (${(size / 1024 / 1024).toFixed(1)} MB, ${tools.length} tools, version ${pkg.version})`
);
