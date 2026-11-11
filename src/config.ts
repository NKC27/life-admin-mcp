import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type FolderSource = "env" | "home" | "demo";

export interface FolderLocation {
  path: string;
  source: FolderSource;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** The demo folder that ships with the package (fictional items). */
export const DEMO_FOLDER = path.join(here, "..", "demo");

export function defaultHomeFolder(home: string = os.homedir()): string {
  return path.join(home, "LifeAdmin");
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Decide which folder to use:
 *   1. LIFE_ADMIN_PATH, if set
 *   2. ~/LifeAdmin, if it exists (created by `life-admin-mcp init`)
 *   3. the bundled demo folder
 */
export function resolveFolder(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): FolderLocation {
  if (env.LIFE_ADMIN_PATH) return { path: path.resolve(env.LIFE_ADMIN_PATH), source: "env" };
  const homeFolder = defaultHomeFolder(home);
  if (isDirectory(homeFolder)) return { path: homeFolder, source: "home" };
  return { path: DEMO_FOLDER, source: "demo" };
}

export function describeSource(source: FolderSource): string {
  switch (source) {
    case "env":
      return "set by LIFE_ADMIN_PATH";
    case "home":
      return "your ~/LifeAdmin folder";
    case "demo":
      return "the bundled demo folder";
  }
}
