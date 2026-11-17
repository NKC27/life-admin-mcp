#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { prepareFolder, runCli } from "./cli.js";
import { resolveFolder } from "./config.js";
import { log } from "./logger.js";
import { createServer } from "./server.js";
import { Store } from "./store.js";

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== null) {
    process.exitCode = exitCode;
    return;
  }

  const location = resolveFolder();
  const store = new Store(location.path);
  // A folder chosen for us (for example by the one-click install) is created on first start, with
  // its welcome note, so real details never go into the demo folder.
  if (location.source === "env") await prepareFolder(location.path);
  await store.init();

  const server = createServer(store, location);
  await server.connect(new StdioServerTransport());
  log(`life-admin MCP server connected via stdio, folder at ${location.path} (${location.source})`);
}

main().catch((err) => {
  console.error("Fatal error starting life-admin MCP server:", err);
  process.exit(1);
});
