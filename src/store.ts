import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import yaml from "js-yaml";
import { ITEM_TYPES, PERIODS, type Item, type ItemInput, type ItemType, type Period } from "./types.js";
import { containsCardNumber, isIsoDate, levenshtein, maskRef, slugify } from "./util.js";

export const DEFAULT_REMIND_DAYS = 14;
export const DEFAULT_CURRENCY = "GBP";

export interface ParsedItem {
  item: Item;
  /** Things wrong with the file that were defaulted or ignored when loading it. */
  problems: string[];
}

/**
 * Parse frontmatter with YAML's core schema, which has no timestamp type. The default schema turns an
 * unquoted `due: 2027-02-30` into a Date and silently rolls it over to 2027-03-02; a reminders tool must
 * never move a date, so dates stay as text here and are validated by `isIsoDate`.
 */
export function readFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, {
    engines: { yaml: (s: string) => (yaml.load(s, { schema: yaml.CORE_SCHEMA }) ?? {}) as object },
  });
}

function dateString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  return undefined;
}

/** Turn a file's contents into an Item, defaulting anything missing and listing what was wrong. */
export function parseItem(slug: string, raw: string, filePath: string): ParsedItem {
  const parsed = readFrontmatter(raw);
  const data = parsed.data as Record<string, unknown>;
  const problems: string[] = [];

  let title = slug;
  if (typeof data.title === "string" && data.title.trim()) title = data.title.trim();
  else problems.push("no title (the file name is used)");

  let type: ItemType = "document";
  if (ITEM_TYPES.includes(data.type as ItemType)) type = data.type as ItemType;
  else problems.push(data.type === undefined ? "no type (treated as document)" : `unknown type "${String(data.type)}"`);

  let period: Period = "one-off";
  if (data.period !== undefined) {
    if (PERIODS.includes(data.period as Period)) period = data.period as Period;
    else problems.push(`unknown period "${String(data.period)}"`);
  }

  let due: string | undefined;
  const rawDue = dateString(data.due);
  if (rawDue) {
    if (isIsoDate(rawDue)) due = rawDue;
    else problems.push(`due date "${rawDue}" is not a valid YYYY-MM-DD date`);
  }

  let cost: number | undefined;
  if (data.cost !== undefined) {
    const n = typeof data.cost === "number" ? data.cost : Number(data.cost);
    if (Number.isFinite(n) && n >= 0) cost = n;
    else problems.push(`cost "${String(data.cost)}" is not a number`);
  }

  let remind_days = DEFAULT_REMIND_DAYS;
  if (data.remind_days !== undefined) {
    const n = Number(data.remind_days);
    if (Number.isInteger(n) && n >= 0 && n <= 365) remind_days = n;
    else problems.push(`remind_days "${String(data.remind_days)}" should be a whole number from 0 to 365`);
  }

  return {
    item: {
      slug,
      title,
      type,
      provider: typeof data.provider === "string" ? data.provider : undefined,
      cost,
      currency: typeof data.currency === "string" ? data.currency : DEFAULT_CURRENCY,
      period,
      due,
      remind_days,
      auto_renews: data.auto_renews === true,
      ref: typeof data.ref === "string" ? data.ref : undefined,
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      created: dateString(data.created) ?? "",
      updated: dateString(data.updated) ?? "",
      body: parsed.content.trim(),
      path: filePath,
    },
    problems,
  };
}

/** Check caller-supplied fields before anything is written. Throws a readable error. */
export function validateInput(input: ItemInput): void {
  if (!input.title?.trim()) throw new Error("An item needs a title");
  if (!ITEM_TYPES.includes(input.type)) throw new Error(`type must be one of: ${ITEM_TYPES.join(", ")}`);
  if (input.period !== undefined && !PERIODS.includes(input.period))
    throw new Error(`period must be one of: ${PERIODS.join(", ")}`);
  if (input.due !== undefined && !isIsoDate(input.due))
    throw new Error(`due must be a real date written as YYYY-MM-DD, got "${input.due}"`);
  if (input.cost !== undefined && !(Number.isFinite(input.cost) && input.cost >= 0))
    throw new Error("cost must be a number of zero or more");
  if (
    input.remind_days !== undefined &&
    !(Number.isInteger(input.remind_days) && input.remind_days >= 0 && input.remind_days <= 365)
  )
    throw new Error("remind_days must be a whole number from 0 to 365");
  for (const [field, value] of Object.entries({
    title: input.title,
    provider: input.provider,
    ref: input.ref,
    body: input.body,
  })) {
    if (typeof value === "string" && containsCardNumber(value))
      throw new Error(
        `The ${field} looks like it contains a full card number. Store only the last four digits (for example "…1234").`
      );
  }
}

export class Store {
  readonly root: string;
  private readonly itemsDir: string;
  private readonly trashDir: string;

  constructor(root: string) {
    this.root = root;
    this.itemsDir = path.join(root, "items");
    this.trashDir = path.join(root, ".trash");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.itemsDir, { recursive: true });
  }

  /**
   * Resolve a file name inside `dir`, refusing anything that is not a plain file name there.
   * Names reach this code from tool arguments, so a name like `../../x` must never escape the folder.
   */
  private inside(dir: string, fileName: string): string {
    const base = path.resolve(dir);
    const full = path.resolve(base, fileName);
    if (path.dirname(full) !== base) throw new Error(`Invalid file name: ${JSON.stringify(fileName)}`);
    return full;
  }

  private itemPath(slug: string): string {
    return this.inside(this.itemsDir, `${slug}.md`);
  }

  async listSlugs(): Promise<string[]> {
    const files = await fs.readdir(this.itemsDir).catch(() => [] as string[]);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  }

  async parse(slug: string): Promise<ParsedItem | null> {
    try {
      const file = this.itemPath(slug);
      return parseItem(slug, await fs.readFile(file, "utf-8"), file);
    } catch {
      return null;
    }
  }

  async load(slug: string): Promise<Item | null> {
    return (await this.parse(slug))?.item ?? null;
  }

  async loadAll(): Promise<Item[]> {
    const items = await Promise.all((await this.listSlugs()).map((s) => this.load(s)));
    return items.filter((i): i is Item => i !== null);
  }

  /** Resolve a user-supplied string to an item by exact slug, then exact title. */
  async findBySlugOrTitle(query: string): Promise<Item | null> {
    const bySlug = await this.load(slugify(query));
    if (bySlug) return bySlug;
    const wanted = query.trim().toLowerCase();
    return (await this.loadAll()).find((i) => i.title.toLowerCase() === wanted) ?? null;
  }

  /** Best-effort fuzzy match, used to power "did you mean" suggestions. */
  async suggestClosest(query: string): Promise<Item | null> {
    const items = await this.loadAll();
    const q = query.trim().toLowerCase();
    if (!q || items.length === 0) return null;
    let best: { item: Item; score: number } | null = null;
    for (const item of items) {
      const t = item.title.toLowerCase();
      const containment = t.includes(q) || q.includes(t);
      const score = containment
        ? Math.min(t.length, q.length) / Math.max(t.length, q.length)
        : 1 - levenshtein(t, q) / Math.max(t.length, q.length, 1);
      if (!best || score > best.score) best = { item, score };
    }
    return best && best.score >= 0.4 ? best.item : null;
  }

  async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let n = 2;
    while (await this.load(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  /**
   * Write an item. With `slug` it overwrites that item (keeping `created`); without, it creates a new one.
   * Validates dates, costs and references, masks `ref` to its last four characters, and refuses card numbers.
   */
  async save(input: ItemInput, options: { slug?: string; created?: string } = {}): Promise<Item> {
    validateInput(input);
    const slug = options.slug ?? (await this.uniqueSlug(slugify(input.title)));
    const now = new Date().toISOString();

    const frontmatter: Record<string, unknown> = {
      title: input.title.trim(),
      type: input.type,
      provider: input.provider?.trim() || undefined,
      cost: input.cost,
      currency: input.currency ?? DEFAULT_CURRENCY,
      period: input.period ?? "one-off",
      due: input.due,
      remind_days: input.remind_days ?? DEFAULT_REMIND_DAYS,
      auto_renews: input.auto_renews ?? false,
      ref: input.ref ? maskRef(input.ref) : undefined,
      tags: input.tags ?? [],
      created: options.created ?? now,
      updated: now,
    };
    // YAML cannot represent undefined, so leave unset fields out of the file entirely.
    for (const key of Object.keys(frontmatter)) if (frontmatter[key] === undefined) delete frontmatter[key];

    const content = matter.stringify(`${(input.body ?? "").trim()}\n`, frontmatter);
    await fs.mkdir(this.itemsDir, { recursive: true });
    await fs.writeFile(this.itemPath(slug), content, "utf-8");
    const saved = await this.load(slug);
    if (!saved) throw new Error(`Failed to read back item "${slug}" after saving`);
    return saved;
  }

  /** Move an item to `.trash/` so it can be restored. */
  async delete(slug: string): Promise<boolean> {
    try {
      const from = this.itemPath(slug);
      await fs.mkdir(this.trashDir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      await fs.rename(from, path.join(this.trashDir, `${slug}--${stamp}.md`));
      return true;
    } catch {
      return false;
    }
  }

  /** Restore the most recently trashed item matching a slug or title. */
  async restore(query: string): Promise<Item | null> {
    const wantedSlug = slugify(query);
    const wantedTitle = query.trim().toLowerCase();
    const files = (await fs.readdir(this.trashDir).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));

    const candidates: { file: string; slug: string }[] = [];
    for (const file of files) {
      const slug = file.slice(0, file.lastIndexOf("--"));
      const parsed = readFrontmatter(await fs.readFile(path.join(this.trashDir, file), "utf-8"));
      const title = typeof parsed.data.title === "string" ? parsed.data.title : slug;
      if (slug === wantedSlug || title.toLowerCase() === wantedTitle) candidates.push({ file, slug });
    }
    const latest = candidates.sort((a, b) => b.file.localeCompare(a.file))[0];
    if (!latest) return null;

    const slug = (await this.load(latest.slug)) ? await this.uniqueSlug(latest.slug) : latest.slug;
    await fs.mkdir(this.itemsDir, { recursive: true });
    await fs.rename(path.join(this.trashDir, latest.file), this.itemPath(slug));
    return this.load(slug);
  }
}
