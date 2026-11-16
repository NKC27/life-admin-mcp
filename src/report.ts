import { describeDays, dueStatus } from "./dates.js";
import type { Item, ItemType } from "./types.js";
import { formatMoney } from "./util.js";

/** "£412.00/year", "£10.99/month", or "£80.00" for a one-off. */
export function formatCost(item: Item): string {
  if (item.cost === undefined) return "";
  const money = formatMoney(item.cost, item.currency);
  return item.period === "one-off" ? money : `${money}/${item.period.replace(/ly$/, "")}`;
}

/** One-line summary used by every listing. */
export function itemLine(item: Item, extra = ""): string {
  const parts = [`**${item.title}** (${item.type})`];
  if (item.provider) parts.push(item.provider);
  const cost = formatCost(item);
  if (cost) parts.push(cost);
  const on = item.type === "birthday" || item.type === "reminder" || item.type === "income" ? "on" : "due";
  if (item.due) parts.push(`${on} ${item.due}${extra ? `, ${extra}` : ""}`);
  if (item.auto_renews) parts.push("renews automatically");
  return `- ${parts.join(" · ")}`;
}

/**
 * What needs attention on `todayDate`: overdue items, items due within `window` days, and items further
 * out whose reminder window has already opened. Shared by the due_soon tool and the `due` command.
 */
export function dueReport(items: Item[], todayDate: string, window: number, type?: ItemType): string {
  const overdue: string[] = [];
  const upcoming: string[] = [];
  const early: string[] = [];
  const dated = items
    .filter(
      (i): i is Item & { due: string } => i.due !== undefined && i.type !== "income" && (!type || i.type === type)
    )
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  for (const item of dated) {
    const s = dueStatus(item.due, todayDate, item.remind_days);
    if (s.overdue) overdue.push(itemLine(item, describeDays(s.daysLeft)));
    else if (s.daysLeft <= window) upcoming.push(itemLine(item, describeDays(s.daysLeft)));
    else if (s.remindersOn)
      early.push(itemLine(item, `${describeDays(s.daysLeft)}, reminders started ${s.remindFrom}`));
  }

  const sections = [`Today is ${todayDate}.`];
  if (overdue.length) sections.push(`Overdue:\n${overdue.join("\n")}`);
  if (upcoming.length) sections.push(`Due in the next ${window} days:\n${upcoming.join("\n")}`);
  if (early.length) sections.push(`Further out, but the reminder window is open:\n${early.join("\n")}`);
  if (!overdue.length && !upcoming.length && !early.length)
    sections.push(`Nothing overdue or due in the next ${window} days.`);
  return sections.join("\n\n");
}
