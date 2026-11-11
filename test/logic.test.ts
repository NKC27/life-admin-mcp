import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { containsCardNumber, isIsoDate, levenshtein, maskRef, slugify } from "../src/util.js";
import { parseItem, Store } from "../src/store.js";
import { resolveFolder } from "../src/config.js";

async function tempStore(): Promise<{ store: Store; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "la-logic-"));
  const store = new Store(dir);
  await store.init();
  return { store, dir };
}

test("slugify and levenshtein basics", () => {
  assert.equal(slugify("  Car Insurance (Admiral)! "), "car-insurance-admiral");
  assert.equal(slugify("!!!"), "untitled");
  assert.equal(levenshtein("kitten", "sitting"), 3);
});

test("isIsoDate accepts real dates only", () => {
  assert.ok(isIsoDate("2027-03-03"));
  assert.ok(isIsoDate("2028-02-29"), "leap day");
  assert.ok(!isIsoDate("2027-02-29"), "not a leap year");
  assert.ok(!isIsoDate("2027-13-01"));
  assert.ok(!isIsoDate("3 March 2027"));
  assert.ok(!isIsoDate("2027-3-3"));
});

test("containsCardNumber spots Luhn-valid card numbers, not other long numbers", () => {
  assert.ok(containsCardNumber("card 4111 1111 1111 1111 exp 12/29"));
  assert.ok(containsCardNumber("4111-1111-1111-1111"));
  assert.ok(containsCardNumber("5555555555554444"));
  assert.ok(!containsCardNumber("4111 1111 1111 1112"), "fails Luhn");
  assert.ok(!containsCardNumber("account 12345678 sort code 12-34-56"), "too short to be a card");
  assert.ok(!containsCardNumber("ends in 1111"));
});

test("maskRef keeps only the last four characters", () => {
  assert.equal(maskRef("12345678"), "…5678");
  assert.equal(maskRef("AB12 3456 7890"), "…7890");
  assert.equal(maskRef("7731"), "7731");
  assert.equal(maskRef("…7731"), "…7731");
});

test("parseItem defaults missing fields and reports what was wrong", () => {
  const { item, problems } = parseItem("x", "---\ntype: gadget\ndue: 2027-02-30\ncost: lots\n---\nbody", "/x.md");
  assert.equal(item.title, "x");
  assert.equal(item.type, "document");
  assert.equal(item.due, undefined);
  assert.equal(item.cost, undefined);
  assert.equal(item.period, "one-off");
  assert.equal(item.remind_days, 14);
  assert.equal(problems.length, 4, problems.join("; "));
});

test("parseItem reads unquoted YAML dates as YYYY-MM-DD", () => {
  const { item, problems } = parseItem("p", "---\ntitle: P\ntype: policy\ndue: 2027-03-03\n---\n", "/p.md");
  assert.equal(item.due, "2027-03-03");
  assert.deepEqual(problems, []);
});

test("an impossible hand-typed date is flagged, never rolled over to a different day", () => {
  // Default YAML parsing would turn 2027-02-30 into 2027-03-02 without a word.
  const { item, problems } = parseItem("p", "---\ntitle: P\ntype: policy\ndue: 2027-02-30\n---\n", "/p.md");
  assert.equal(item.due, undefined);
  assert.match(problems.join(), /2027-02-30.*not a valid/);
});

test("save writes a round-trippable item, masks refs and keeps created on update", async () => {
  const { store, dir } = await tempStore();
  const saved = await store.save({
    title: "Car insurance",
    type: "policy",
    provider: "Example Motor",
    cost: 412,
    period: "yearly",
    due: "2027-03-03",
    remind_days: 21,
    auto_renews: true,
    ref: "POL-0099887731",
    body: "## History\n- 2026-03-03 Renewed",
  });
  assert.equal(saved.slug, "car-insurance");
  assert.equal(saved.ref, "…7731");
  assert.equal(saved.due, "2027-03-03");
  assert.equal(saved.cost, 412);
  assert.equal(saved.currency, "GBP");
  assert.equal(saved.auto_renews, true);
  assert.match(saved.body, /Renewed/);

  const raw = await fs.readFile(saved.path, "utf-8");
  assert.doesNotMatch(raw, /0099887731/, "the full reference never reaches disk");
  assert.deepEqual(parseItem("car-insurance", raw, saved.path).problems, []);

  const updated = await store.save({ ...saved, cost: 450 }, { slug: saved.slug, created: saved.created });
  assert.equal(updated.cost, 450);
  assert.equal(updated.created, saved.created);
  assert.equal((await store.listSlugs()).length, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("save rejects bad input before writing anything", async () => {
  const { store, dir } = await tempStore();
  await assert.rejects(store.save({ title: "", type: "bill" }), /needs a title/);
  await assert.rejects(store.save({ title: "X", type: "gadget" as never }), /type must be one of/);
  await assert.rejects(store.save({ title: "X", type: "bill", due: "next Friday" }), /YYYY-MM-DD/);
  await assert.rejects(store.save({ title: "X", type: "bill", cost: -5 }), /cost/);
  await assert.rejects(store.save({ title: "X", type: "bill", remind_days: 1.5 }), /remind_days/);
  await assert.rejects(
    store.save({ title: "Card", type: "bill", body: "paid with 4111 1111 1111 1111" }),
    /full card number/
  );
  await assert.rejects(store.save({ title: "Card", type: "bill", ref: "4111111111111111" }), /full card number/);
  assert.deepEqual(await store.listSlugs(), []);
  await fs.rm(dir, { recursive: true, force: true });
});

test("new items get unique slugs; lookup by title and fuzzy suggestions work", async () => {
  const { store, dir } = await tempStore();
  await store.save({ title: "Broadband", type: "bill" });
  const second = await store.save({ title: "Broadband", type: "bill" });
  assert.equal(second.slug, "broadband-2");
  assert.equal((await store.findBySlugOrTitle("BROADBAND"))?.slug, "broadband");
  assert.equal((await store.suggestClosest("brodband"))?.title, "Broadband");
  assert.equal(await store.suggestClosest("zzzzzzzzzz"), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test("delete moves to trash and restore brings it back", async () => {
  const { store, dir } = await tempStore();
  await store.save({ title: "TV licence", type: "renewal", due: "2027-05-01" });
  assert.ok(await store.delete("tv-licence"));
  assert.equal(await store.load("tv-licence"), null);
  const restored = await store.restore("TV licence");
  assert.equal(restored?.due, "2027-05-01");
  assert.equal(await store.restore("nothing like this"), null);
  await fs.rm(dir, { recursive: true, force: true });
});

test("path traversal through slugs is refused", async () => {
  const { store, dir } = await tempStore();
  assert.equal(await store.load("../../etc/passwd"), null);
  await assert.rejects(store.save({ title: "x", type: "bill" }, { slug: "../escape" }), /Invalid file name/);
  assert.equal(await store.delete("../escape"), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("resolveFolder prefers LIFE_ADMIN_PATH, then ~/LifeAdmin, then the demo", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "la-home-"));
  assert.equal(resolveFolder({ LIFE_ADMIN_PATH: "/tmp/x" }, home).source, "env");
  assert.equal(resolveFolder({}, home).source, "demo");
  await fs.mkdir(path.join(home, "LifeAdmin"));
  assert.equal(resolveFolder({}, home).source, "home");
  await fs.rm(home, { recursive: true, force: true });
});

test("the bundled demo items are all well formed", async () => {
  const store = new Store(resolveFolder({}, "/nonexistent-home").path);
  const slugs = await store.listSlugs();
  assert.ok(slugs.length >= 4);
  for (const slug of slugs) {
    const parsed = await store.parse(slug);
    assert.deepEqual(parsed?.problems, [], slug);
  }
});
