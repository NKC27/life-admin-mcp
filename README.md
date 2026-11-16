# Life Admin MCP

> **Work in progress (0.1.0, not yet published).** Tracking and calendar export work; the agent skill comes next.

Local-first life admin for AI agents. Your renewals, bills, subscriptions, warranties, policies and documents live as plain markdown files in a folder you own (`~/LifeAdmin`), and any [MCP](https://modelcontextprotocol.io) client (Claude Code, Claude Desktop, Cursor, VS Code) can track them for you.

## Quick start (from a checkout)

```bash
npm install && npm run build
node dist/index.js init      # creates ~/LifeAdmin and prints the setup for your AI client
node dist/index.js doctor    # checks everything, including a live handshake
node dist/index.js due       # what's overdue and due in the next 30 days
node dist/index.js ics       # write a calendar file of every due date
```

## Tools

| Tool | Does |
| --- | --- |
| `due_soon` | Overdue items, items due in the next N days (default 30), and items further out whose reminder window has opened |
| `add_item` | Start tracking something; refuses duplicates, card numbers and impossible dates |
| `get_item` | Full details, days left, when reminders start, notes and history |
| `update_item` | Change, clear or add a dated note; untouched fields stay as they are |
| `mark_handled` | Log that it was dealt with and move the due date on (month-end dates stay right); logs price changes |
| `search_items`, `list_items` | Find things by words, type or due date |
| `delete_item`, `restore_item` | Delete to a recoverable trash (exact title only), and bring it back |
| `export_calendar` | Write an `.ics` file for Apple Calendar, Google Calendar or Outlook |
| `get_stats` | Folder location, counts, what's overdue and due soon |

## Reminders through your calendar

An AI agent only acts when you talk to it, so reminders go through your own calendar instead. `export_calendar` (or `life-admin-mcp ics`) writes `exports/life-admin.ics`:

- Each item with a due date becomes an all-day event, with a 9am reminder when its reminder window opens and another on the day.
- Repeating items repeat in the calendar, matching `mark_handled` exactly. Only repeat rules every calendar app supports are used; February dates for bills on the 29th or 30th are added as separate events five years ahead.
- Event IDs are stable, so importing a new export into the same calendar updates events instead of duplicating them (in apps that match on event ID).
- Provider and cost are included unless you ask for a minimal export. References and notes are never included. Calendars often sync to a cloud account, so keep that in mind.



## What an item looks like

```markdown
---
title: Car insurance
type: policy            # renewal | bill | subscription | warranty | policy | vehicle | document
provider: Example Motor Insurance
cost: 412
currency: GBP
period: yearly          # one-off | weekly | monthly | quarterly | yearly
due: '2027-03-03'       # next renewal, payment or expiry
remind_days: 21         # start reminding this many days before
auto_renews: true
ref: …7731              # last four only
---
## History
- 2026-03-03 Renewed at £412 (was £356)
```

## Safety and privacy

- **Local only.** Nothing leaves your computer.
- **No full card numbers.** The server refuses anything that looks like a card number and keeps only the last four characters of a reference.
- **Dates are never moved.** An impossible date such as `2027-02-30` is reported by `doctor`, not silently rolled over to another day.
- **Recoverable deletes.** Deleted items go to `.trash/`.
- **Month-end dates stay right.** A bill due on the 31st goes 31 Jan → 28 Feb → 31 Mar, and a 29 February renewal returns to the 29th in leap years.

## Development

```bash
npm test             # build, then unit, CLI and end-to-end MCP tests
npm run format       # prettier
```

Set `LIFE_ADMIN_TODAY=YYYY-MM-DD` to pretend it is another day (handy for testing), and `DEBUG_MCP=1` for debug logging on stderr (stdout is reserved for the protocol).

## Licence

MIT
