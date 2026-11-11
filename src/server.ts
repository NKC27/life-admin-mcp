import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Store } from "./store.js";
import { describeSource, type FolderLocation } from "./config.js";
import { ITEM_TYPES, type Item } from "./types.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS =
  "Local-first life admin: renewals, bills, subscriptions, warranties, policies, vehicles and documents, each " +
  "stored as a markdown file on the user's own machine. Store only the last four digits of any account or card " +
  "number. Never invent dates or prices; ask the user. get_stats shows where the folder is and what it holds.";

// Tool annotations let clients tell safe reads from writes and decide when to ask for approval.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function textResult(text: string, isError = false) {
  return { isError, content: [{ type: "text" as const, text }] };
}

function formatCost(item: Item): string {
  if (item.cost === undefined) return "";
  const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: item.currency }).format(item.cost);
  return item.period === "one-off" ? money : `${money}/${item.period.replace(/ly$/, "")}`;
}

export function itemLine(item: Item): string {
  const parts = [`**${item.title}** (${item.type})`];
  if (item.provider) parts.push(item.provider);
  const cost = formatCost(item);
  if (cost) parts.push(cost);
  if (item.due) parts.push(`due ${item.due}`);
  return `- ${parts.join(" · ")}`;
}

export function createServer(store: Store, location: FolderLocation): McpServer {
  const server = new McpServer(
    { name: "life-admin", version: VERSION, title: "Life Admin" },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "get_stats",
    {
      title: "Folder stats",
      description:
        "Where the life-admin folder lives and what it holds: item counts by type and how many have a due date. " +
        "Call once at the start of a conversation to orient.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const items = await store.loadAll();
      const lines = [`Folder: ${store.root} (${describeSource(location.source)})`, `Items: ${items.length}`];
      for (const type of ITEM_TYPES) {
        const count = items.filter((i) => i.type === type).length;
        if (count) lines.push(`  ${type}: ${count}`);
      }
      lines.push(`With a due date: ${items.filter((i) => i.due).length}`);
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
      return textResult(items.map(itemLine).join("\n"));
    }
  );

  return server;
}
