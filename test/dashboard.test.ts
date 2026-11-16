import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml, startDashboard, type RunningDashboard } from "../src/dashboard.js";
import { Store } from "../src/store.js";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let folder: string;
let running: RunningDashboard;

/** GET or POST with an explicit Host header (fetch does not allow overriding it). */
function request(url: string, options: { host?: string; method?: string } = {}) {
  const u = new URL(url);
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: options.method ?? "GET",
        headers: { Host: options.host ?? u.host },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  process.env.LIFE_ADMIN_TODAY = "2026-11-14";
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "la-dash-"));
  await fs.cp(path.join(projectRoot, "demo"), folder, { recursive: true });
  const store = new Store(folder);
  await store.save({ title: '<script>alert("x")</script> & Co', type: "bill", due: "2026-11-16", cost: 5 });
  running = await startDashboard(store, 0);
});

after(async () => {
  await running.close();
  delete process.env.LIFE_ADMIN_TODAY;
  await fs.rm(folder, { recursive: true, force: true });
});

test("escapeHtml escapes everything that could break out of text or attributes", () => {
  assert.equal(
    escapeHtml(`<a href="x" onclick='y'>&</a>`),
    "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
  );
});

test("the home screen shows every card with the person's figures", async () => {
  const res = await request(running.url);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/html/);
  for (const heading of [
    "Coming up",
    "Next payday",
    "This week&#39;s spending",
    "Rainy-day pot",
    "Bank holidays (England and Wales)",
  ])
    assert.ok(res.body.includes(heading), heading);
  assert.match(res.body, /Saturday 14 November/);
  assert.match(res.body, /Wednesday 25 November/);
  assert.match(res.body, /£340<span class="muted"> of £1,000 \(34%\)/);
  assert.match(res.body, /Mum&#39;s birthday/);
  assert.match(res.body, /Christmas Day/);
  assert.doesNotMatch(res.body, /Salary<\/p>/, "paydays are not listed as things due");
});

test("titles are escaped, so a hostile item name cannot run script", async () => {
  const { body } = await request(running.url);
  assert.ok(body.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co"));
  assert.doesNotMatch(body, /<script>alert/);
});

test("no inline styles or scripts, which the security policy would block", async () => {
  const res = await request(running.url);
  assert.doesNotMatch(res.body, /\sstyle="/, "bar widths must use classes, or every bar shows full length");
  assert.doesNotMatch(res.body, /<script>(?!<\/script>)[^<]/);
  assert.match(res.headers["content-security-policy"] ?? "", /default-src 'self'/);
  assert.match(res.body, /class="w\d+"/);
});

test("only this computer can reach it, read-only", async () => {
  assert.equal((await request(running.url, { host: "evil.example" })).status, 403, "DNS rebinding blocked");
  assert.equal((await request(running.url, { method: "POST" })).status, 405);
  assert.equal((await request(new URL("/app.css", running.url).href)).status, 200);
  assert.equal((await request(new URL("/../package.json", running.url).href)).status, 404);
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test("a brand-new folder shows friendly empty states", async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), "la-dash-empty-"));
  const store = new Store(empty);
  await store.init();
  const fresh = await startDashboard(store, 0);
  try {
    const { body } = await request(fresh.url);
    assert.match(body, /Nothing tracked yet/);
    assert.match(body, /No spending recorded yet/);
    assert.match(body, /Tell your assistant when you're paid/);
  } finally {
    await fresh.close();
    await fs.rm(empty, { recursive: true, force: true });
  }
});
