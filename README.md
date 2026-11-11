# Life Admin MCP

> **Work in progress (0.1.0, not yet published).** The storage, CLI and tests are in place; the tracking tools (`add_item`, `due_soon`, calendar export) come next.

Local-first life admin for AI agents. Your renewals, bills, subscriptions, warranties, policies and documents live as plain markdown files in a folder you own (`~/LifeAdmin`), and any [MCP](https://modelcontextprotocol.io) client (Claude Code, Claude Desktop, Cursor, VS Code) can track them for you.

## Quick start (from a checkout)

```bash
npm install && npm run build
node dist/index.js init      # creates ~/LifeAdmin and prints the setup for your AI client
node dist/index.js doctor    # checks everything, including a live handshake
```

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

## Development

```bash
npm test             # build, then unit, CLI and end-to-end MCP tests
npm run format       # prettier
```

Set `DEBUG_MCP=1` for debug logging on stderr (stdout is reserved for the protocol).

## Licence

MIT
