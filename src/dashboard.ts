import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { moneyAhead, rainyDayPlan, spendingSummary, type PlanOption } from "./budget.js";
import { describeDays, dueStatus, today } from "./dates.js";
import { holidayWord, upcomingHolidays } from "./holidays.js";
import { settings } from "./locale.js";
import { MoneyStore } from "./money.js";
import { longDate, shortDate } from "./money-report.js";
import { workingDayFor } from "./money-tools.js";
import { formatCost } from "./report.js";
import type { Store } from "./store.js";
import type { Item } from "./types.js";
import { money } from "./util.js";

// The home screen: one calm, read-only page built on the server (works without JavaScript and
// prints cleanly), served only to this computer.

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, "..", "dashboard");

const gbp = (n: number) => money(n);
/** Whole pounds for the glanceable cards: £263 rather than £262.78. */
const pounds = (n: number) => money(Math.round(n));
/** Width class in 5% steps (inline styles are blocked by the page's security policy). */
const widthClass = (pct: number) => `w${pct <= 0 ? 0 : Math.max(5, Math.min(100, Math.round(pct / 5) * 5))}`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const h = escapeHtml;

// ---------------------------------------------------------------------------
// icons (simple line drawings, decorative: every status also has words)
// ---------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  alert:
    '<circle cx="12" cy="12" r="9.5"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="16.6" x2="12" y2="16.7"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><polyline points="12 6.5 12 12 15.5 14"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><polyline points="7.5 12.5 10.5 15.5 16.5 9"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3.5" y1="10" x2="20.5" y2="10"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5.5 12.5v8h13v-8"/><line x1="12" y1="8.5" x2="12" y2="20.5"/><path d="M12 8.5C10.5 5 7 4.6 7 6.7 7 8.5 9.5 8.5 12 8.5zm0 0c1.5-3.5 5-3.9 5-1.8 0 1.8-2.5 1.8-5 1.8z"/>',
  umbrella: '<path d="M3 12.5a9 9 0 0 1 18 0z"/><path d="M12 12.5v6a2.5 2.5 0 0 1-5 0"/>',
  wallet:
    '<rect x="3" y="6" width="18" height="14" rx="2.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="15.5" y1="15" x2="17.5" y2="15"/>',
  basket: '<path d="M4 9.5h16l-1.6 9.6a2 2 0 0 1-2 1.7H7.6a2 2 0 0 1-2-1.7z"/><path d="M8.5 9.5 12 4l3.5 5.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  print:
    '<polyline points="6.5 9 6.5 3.5 17.5 3.5 17.5 9"/><rect x="3" y="9" width="18" height="8" rx="2"/><rect x="7" y="14" width="10" height="6.5"/>',
};

function icon(name: string, cls = "icon"): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ""}</svg>`;
}

// ---------------------------------------------------------------------------
// page data
// ---------------------------------------------------------------------------

type Status = "overdue" | "soon" | "later";

interface Row {
  date: string;
  title: string;
  detail: string;
  status: Status;
  when: string;
  kind: "birthday" | "payment" | "other";
}

const STATUS_WORD: Record<Status, string> = { overdue: "Overdue", soon: "This week", later: "Coming up" };
const STATUS_ICON: Record<Status, string> = { overdue: "alert", soon: "clock", later: "check" };

function comingUp(items: Item[], todayDate: string): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    if (!item.due || item.type === "income") continue;
    const s = dueStatus(item.due, todayDate, item.remind_days);
    if (!s.overdue && s.daysLeft > 30 && !s.remindersOn) continue;
    const parts: string[] = [];
    const cost = formatCost(item);
    if (cost) parts.push(cost.replace(/\.00(?=\/|$)/, ""));
    if (item.provider) parts.push(item.provider);
    if (item.auto_renews)
      parts.push(item.type === "subscription" || item.type === "policy" ? "renews by itself" : "taken automatically");
    rows.push({
      date: item.due,
      title: item.type === "birthday" && !/birthday/i.test(item.title) ? `${item.title}'s birthday` : item.title,
      detail: parts.join(" · "),
      status: s.overdue ? "overdue" : s.daysLeft <= 7 ? "soon" : "later",
      when: s.overdue
        ? `Was due ${describeDays(s.daysLeft)}`
        : s.daysLeft <= 1
          ? describeDays(s.daysLeft).replace(/^./, (c) => c.toUpperCase())
          : `In ${s.daysLeft} days`,
      kind:
        item.type === "birthday"
          ? "birthday"
          : ["bill", "subscription", "policy", "renewal", "vehicle"].includes(item.type)
            ? "payment"
            : "other",
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function riskWord(o: PlanOption): { word: string; cls: Status } {
  if (o.tightestMonthLeft === undefined) return { word: "Can't check yet", cls: "later" };
  return o.tightestMonthLeft >= 50
    ? { word: "Comfortable", cls: "later" }
    : o.tightestMonthLeft >= 0
      ? { word: "Tight in a lean month", cls: "soon" }
      : { word: "Too tight", cls: "overdue" };
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export async function renderHome(store: Store, money: MoneyStore, now: Date = new Date()): Promise<string> {
  const todayDate = today();
  const region = settings().place;
  const items = await store.loadAll();
  const transactions = await money.loadTransactions();
  const pot = await money.loadPot();

  const rows = comingUp(items, todayDate);
  const needYou = rows.filter((r) => r.status !== "later").length;
  const ahead = moneyAhead(items, todayDate, { workingDay: workingDayFor(region) });
  let week = spendingSummary(transactions, todayDate, "week");
  let weekTitle = "This week's spending";
  if (week.transactions === 0 && transactions.length) {
    week = spendingSummary(transactions, todayDate, "week", 1);
    weekTitle = "Last week's spending";
  }
  const plan = rainyDayPlan(transactions, items, pot, todayDate);
  const holidays = upcomingHolidays(todayDate, 120, region).slice(0, 4);

  // ---- summary line ----
  const summary: string[] = [
    needYou === 0
      ? "Nothing due this week."
      : `${needYou} ${needYou === 1 ? "thing" : "things"} due this week${rows.some((r) => r.status === "overdue") ? " or overdue" : ""}.`,
  ];
  if (ahead.payday) summary.push(`Your next payday is ${longDate(ahead.payday.date)}.`);

  // ---- coming up ----
  const comingHtml = rows.length
    ? `<ul class="rows">${rows
        .map(
          (r) => `<li class="row ${r.status}">
  <div class="date" aria-hidden="true"><span class="day">${h(r.date.slice(8, 10).replace(/^0/, ""))}</span><span class="mon">${h(shortDate(r.date).split(" ").at(-1)!)}</span></div>
  <div class="what"><p class="title">${r.kind === "birthday" ? icon("gift", "icon inline") : ""}${h(r.title)}</p>${r.detail ? `<p class="detail">${h(r.detail)}</p>` : ""}<p class="sr-only">${h(longDate(r.date))}</p></div>
  <div class="status"><span class="pill ${r.status}">${icon(STATUS_ICON[r.status]!, "icon small")}${STATUS_WORD[r.status]}</span><span class="when">${h(r.when)}</span></div>
</li>`
        )
        .join("")}</ul>`
    : `<p class="empty">Nothing tracked yet. Ask your assistant to add a bill, a renewal or a birthday.</p>`;

  // ---- before payday ----
  let paydayHtml: string;
  if (ahead.payday) {
    const days = Math.round((Date.parse(ahead.payday.date) - Date.parse(todayDate)) / 86_400_000);
    paydayHtml = `<p class="big">${h(longDate(ahead.payday.date))}</p>
<p class="muted">${h(ahead.payday.title)}${ahead.payday.amount !== undefined ? ` · ${gbp(ahead.payday.amount)}` : ""} · in ${days} day${days === 1 ? "" : "s"}</p>
${ahead.payday.scheduled ? `<p class="note">Due ${h(longDate(ahead.payday.scheduled))}, but that's ${h(ahead.payday.movedBecause ?? "not a working day")}, so it usually arrives the day before.</p>` : ""}
<h3>Bills before then</h3>
${
  ahead.bills.length
    ? `<ul class="simple">${ahead.bills
        .map(
          (b) =>
            `<li><span>${h(shortDate(b.date))} · ${h(b.title)}</span><span class="amount">${b.amount !== undefined ? gbp(b.amount) : "not recorded"}</span></li>`
        )
        .join("")}<li class="total"><span>Total</span><span class="amount">${gbp(ahead.total)}</span></li></ul>`
    : `<p class="muted">No tracked bills before payday.</p>`
}`;
  } else {
    paydayHtml = `<p class="empty">Tell your assistant when you're paid (your wages or pension) to see the bills due before then.</p>`;
  }

  // ---- spending ----
  let spendHtml: string;
  if (!transactions.length) {
    spendHtml = `<p class="empty">No spending recorded yet. Ask your assistant to import a bank statement, or tell it what you spent.</p>`;
  } else {
    const max = Math.max(1, ...week.lines.map((l) => Math.max(l.amount, l.usual ?? 0)));
    spendHtml = `<p class="big">${pounds(week.total)}<span class="muted"> ${week.partial ? "so far" : "spent"}</span></p>
${week.usualTotal !== undefined ? `<p class="muted">A usual week is about ${pounds(week.usualTotal)}.</p>` : ""}
<ul class="bars">${week.lines
      .filter((l) => l.amount > 0)
      .map((l) => {
        const more = !week.partial && l.usual !== undefined && l.amount - l.usual >= Math.max(5, l.usual * 0.2);
        return `<li><span class="label">${h(l.label)}</span><span class="bar" aria-hidden="true"><span class="${widthClass((l.amount / max) * 100)}${more ? " more" : ""}"></span></span><span class="amount">${pounds(l.amount)}${more ? '<span class="tag">more than usual</span>' : ""}</span></li>`;
      })
      .join("")}</ul>
<p class="muted small">${h(shortDate(week.range.start))} to ${h(shortDate(week.range.end))}</p>`;
  }

  // ---- rainy-day pot ----
  const saved = plan.pot.saved;
  const goal = plan.pot.target ?? plan.goals.starter;
  const pct = Math.min(100, Math.round((saved / Math.max(goal, 1)) * 100));
  // Suggest the largest amount that stays comfortable in a lean month; otherwise the gentlest, with a caution.
  const comfortable = plan.options.filter((o) => (o.tightestMonthLeft ?? 0) >= 50);
  const pick = comfortable.at(-1) ?? plan.options[0];
  const potHtml = `<div class="pot">
  <div class="meter" role="img" aria-label="${pct}% of the goal saved"><span class="${widthClass(pct)}"></span></div>
  <p class="big">${pounds(saved)}<span class="muted"> of ${pounds(goal)} (${pct}%)</span></p>
</div>
${
  pick
    ? `<p>${comfortable.length ? "A comfortable amount on your figures" : "Even the gentlest amount would be tight"}: about <strong>${pounds(pick.weekly)} a week</strong>.</p>
<ul class="options">${plan.options
        .map((o) => {
          const r = riskWord(o);
          return `<li><span class="name">${o.name}</span><span class="amount">${pounds(o.weekly)} a week</span><span class="pill ${r.cls}">${h(r.word)}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">${h(plan.flags[0] ?? "Add your income and some spending records to see what you could put aside.")}</p>`
}
<p class="note">Sums on your own figures, not financial advice.${region.country === "GB" ? " Free guidance: MoneyHelper." : ""}</p>`;

  // ---- bank holidays ----
  const holidaysHtml = holidays.length
    ? `<ul class="holidays">${holidays.map((x) => `<li><span class="when-day">${h(longDate(x.date))}</span><span class="muted">${h(x.title)}</span></li>`).join("")}</ul>
<p class="note">Banks and many businesses are closed. Payments due then usually go out the next working day.</p>`
    : `<p class="muted">None in the next few months.</p>`;

  const card = (id: string, ic: string, title: string, body: string, size: "" | "wide" | "full" = "") =>
    `<section class="card${size ? ` ${size}` : ""}" aria-labelledby="${id}"><h2 id="${id}">${icon(ic)}${h(title)}</h2>${body}</section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Life Admin</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
</head>
<body>
<a class="skip" href="#main">Skip to the main page</a>
<header class="top">
  <div class="brand"><img src="/icon.svg" alt="" width="40" height="40"><span>Life Admin</span></div>
  <div class="tools">
    <button type="button" id="text-size" aria-pressed="false">Bigger text</button>
    <button type="button" id="theme">Dark colours</button>
    <button type="button" id="print">${icon("print", "icon small")}Print</button>
  </div>
</header>
<main id="main">
  <div class="hello">
    <h1>${h(greeting(now))}</h1>
    <p class="today">${h(longDate(todayDate))}</p>
    <p class="summary">${h(summary.join(" "))}</p>
  </div>
  <div class="grid">
    ${card("coming", "bell", "Coming up", comingHtml, "wide")}
    ${card("payday", "wallet", "Next payday", paydayHtml)}
    ${card("spending", "basket", weekTitle, spendHtml, "wide")}
    ${card("pot", "umbrella", "Rainy-day pot", potHtml)}
    ${card("holidays", "calendar", `${holidayWord(region).replace(/^./, (c) => c.toUpperCase())} (${settings().label})`, holidaysHtml, "full")}
  </div>
</main>
<footer class="foot">
  <p>Your information stays on this computer. Printed or viewed on ${h(longDate(todayDate))}.</p>
</footer>
<script src="/app.js"></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const STATIC: Record<string, string> = {
  "/app.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/icon.svg": "image/svg+xml",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export interface RunningDashboard {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serve the home screen on 127.0.0.1 only. Requests whose Host header is not this address are
 * refused, which blocks other websites from reaching it through DNS rebinding.
 */
export async function startDashboard(store: Store, preferredPort = 4747): Promise<RunningDashboard> {
  const money = new MoneyStore(store.root);
  let port = preferredPort;
  const server = http.createServer(async (req, res) => {
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowed.has(req.headers.host ?? "")) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("Forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === "/") {
        const html = await renderHome(store, money);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS }).end(html);
        return;
      }
      const type = STATIC[url.pathname];
      if (type) {
        const body = await fs.readFile(path.join(ASSETS, url.pathname.slice(1)));
        res.writeHead(200, { "Content-Type": type, ...SECURITY_HEADERS }).end(body);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    } catch (err) {
      res
        .writeHead(500, { "Content-Type": "text/plain" })
        .end(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (address && typeof address === "object") port = address.port;
      return {
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((resolve) => {
            server.close(() => resolve());
            // Browsers keep connections open; end them so closing never hangs.
            server.closeAllConnections();
          }),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE" || preferredPort === 0) throw err;
      port += 1;
    }
  }
  throw new Error(`Could not find a free port from ${preferredPort} to ${port}`);
}

/** Open a URL in the default browser. Best effort: failures are ignored. */
export function openInBrowser(url: string): void {
  if (process.env.LIFE_ADMIN_NO_BROWSER) return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" })
      .on("error", () => undefined)
      .unref();
  } catch {
    // no browser available; the URL is printed for the person to open
  }
}
