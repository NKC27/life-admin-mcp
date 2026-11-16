# Life Admin: roadmap

_Written 2026-11-16, updated the same day. Done: storage, tracking tools, calendar export, money core, birthdays, reminders, UK bank holidays and the home screen (115 tests). Next: the skill, then shipping._

## The promise

**"Never miss a bill, never pay a loyalty penalty, and always know what's safe to spend."**
Private (everything stays on your computer), plain English, and simple enough for someone who is not confident with technology, with a family member helping once at setup.

## Principles

1. **Private by design.** The server never touches the internet. Connectors (email, calendar) are used by the AI agent, only when asked, and only to *suggest* things the person then confirms.
2. **Calm, not clever.** Plain words ("Due in 3 days", "Renews by itself"), big text, one thing per screen. Never colour alone: every status also has an icon and a word.
3. **Never invent money.** Every figure comes from the person's own records or what they typed. Estimates are labelled as estimates.
4. **Budgeting help, not financial advice.** The tool does arithmetic on the person's own numbers and explains the trade-offs. It never recommends financial products, accounts or investments, and points to free, impartial help (MoneyHelper, and StepChange for debt).

## 1. Money (new)

### What it stores (plain files, opens in Excel)
| File | Holds |
| --- | --- |
| `money/transactions-2026.csv` | date, amount, description, category, source (typed / bank file / email), id |
| `money/rules.csv` | "if the description contains TESCO, it's Groceries"; grows as the person corrects categories |
| `money/pots.md` | Rainy-day pot: target and current amount (typed by the person) |
| items with type `income` | Payday, amount, how often (reuses the existing item tools) |

**Categories** (fixed, plain English): Bills & energy · Groceries · Shopping · Eating & going out · Transport · Tax (council tax, HMRC) · Subscriptions · Savings · Other.

### Where the numbers come from
- **Bank statement files.** Every UK bank app can export a CSV. Import is private: no third party sees anything. The importer recognises the common UK bank formats, shows a preview before saving, and skips duplicates.
- **Typed or spoken:** "I spent £42 on a meal out".
- **Email receipts:** through the Gmail or Outlook connectors (see section 3), always confirmed first.
- _Not_ live bank connections: Open Banking needs FCA authorisation, which is out of scope. Saying so plainly is part of the trust story.

### New tools
| Tool | Does |
| --- | --- |
| `import_bank_file` | Read a bank CSV, preview, categorise with rules, list unknown shops to sort, skip duplicates |
| `add_spending` | Record a single spend or refund |
| `set_category` / `category_rule` | Fix a category and remember the rule for next time |
| `spending_summary` | This week or month by category, compared with the person's usual (average of the last 4), top shops |
| `money_ahead` | Bills due before next payday, taken from tracked items. With a balance the person types, it gives "after bills, about £X until payday" |
| `rainy_day_plan` | See below |

### The rainy-day planner
1. **Essentials:** average monthly bills, groceries, transport and tax, from the person's own data.
2. **Smooth the big bills:** yearly and quarterly bills turned into a monthly set-aside, for example car insurance of £412 in March works out at about £34 a month. This alone prevents a lot of "bill shock".
3. **What's left:** income minus usual spending minus set-asides.
4. **Three options, each with its risks spelled out:**
   - **Gentle** (25% of what's left), **Steady** (50%) and **Stretch** (75%).
   - For each option: what would be left in the leanest week of the last 3 months, whether every bill before next payday is still covered, and how long until a £1,000 starter pot and until 3 months of essentials.
5. **Risk flags:**
   - income that changes a lot from month to month
   - a big bill coming soon
   - spending trending up
   - signs of borrowing to cover bills. Here it suggests a free debt adviser (StepChange) before saving, because clearing expensive debt usually matters more. This is framed as general guidance.
6. **Where the money could come from:**
   - categories above the person's usual level
   - subscriptions that went up at renewal
   - subscriptions that look unused, for the person to decide on

## 2. The home screen (new)

`life-admin-mcp dashboard` opens a page in the browser. It works without an AI chat, and it's where the screenshots come from.

- **Three cards:** *Coming up* (next 14 days), *This week's spending* (simple bars by category), *Rainy-day pot* (progress, plus "you could put away £X a week").
- **Colours:**
  - warm off-white background `#FAF7F2`, dark ink text `#1F2A37`, calm teal `#2F7D78` for actions
  - status colours: sage `#5E8C61` for fine, amber `#B7791F` for soon, muted brick `#A7473A` for overdue, each with an icon and a word
  - a matching dark mode
- **Readability:** 18-20px text, large buttons, one column on phones, and it still works at 200% zoom. Meets WCAG 2.2 AA contrast. Works with the keyboard and with screen-reader labels.
- **"Print this month":** one tidy page for the fridge, or for a family member who helps.
- Later, the same page shown inside the Claude chat as an interactive view (MCP Apps), where the client supports it.

## 3. Connectors (used by the skill, with the person's say-so)

| Connector | Used for | Guardrails |
| --- | --- | --- |
| **Gmail / Outlook mail** (Microsoft 365) | "Check my email for bills and renewals": finds renewal notices, bills, price-rise letters and receipts, and proposes items and spending in a table to confirm | Read-only. Never clicks links. Stores the facts only, never email text. **Scam check:** flags urgent-payment emails, unknown senders and odd links, never adds them, and says "contact the company on a number you already have" |
| **Google Calendar / Outlook calendar** | "Put my renewals in my calendar": creates events with reminders directly, after showing the list | Falls back to the `.ics` export when no calendar connector is available |
| **Google Drive / OneDrive** | "Where's my boiler warranty?": finds the PDF and notes where it is on the item | Read-only. Links to the file, never copies it |

Status in this setup: Gmail, Google Calendar and Google Drive are connected. Microsoft 365 is installed and needs a sign-in.

## 4. The skill (paid Pro)

- **Workflows:**
  - weekly check-in
  - add from a letter or email
  - email sweep (with the scam check)
  - calendar sync
  - bank file import
  - spending review
  - rainy-day plan
  - renewal prep (old vs new price, haggle or switch notes)
  - "something broke" (warranty)
  - moving house / new car checklists
  - annual review
- **UK pack, every rule checked against its source with a link and a "last checked" date:**
  - MOT
  - car tax
  - TV licence
  - council tax (including asking for 12 instalments)
  - fixed energy deals ending
  - broadband and mobile end-of-contract notices and price rises
  - insurance renewal pricing rules
  - passport and driving licence renewal
  - boiler service
- **Everyday paperwork, explained** (checked against gov.uk and the regulators, with sources):
  - **Payslips:** read a pasted or uploaded payslip and check the tax code (flag emergency codes such as 0T, BR or W1/M1), National Insurance, pension contributions and student loan, and say what to ask payroll or HMRC about. It never says the figures are wrong for certain.
  - **Pensions:** pension payments as income, a reminder to check the State Pension forecast on gov.uk, and tracking workplace pension statements.
  - **Council tax:** asking for 12 monthly instalments instead of 10, the 25% single-person discount, and how to challenge a band.
  - **Insurance renewals:** comparing the renewal price with last year's (already logged by `mark_handled`), the rule that renewal prices can't exceed the new-customer price, and a short haggle-or-switch script.
- **"Are you missing out?" signposts:** free benefits calculators (for example Pension Credit, which many eligible pensioners don't claim), Warm Home Discount, and social tariffs for broadband. Signposting only, never eligibility decisions.
- **Behaviour tests** (like Second Brain), checking that it:
  - never invents a figure
  - never recommends a product
  - flags a scam email
  - asks before saving anything from email
  - doesn't promise reminders without the calendar

## 5. Easy install

The biggest barrier for a non-technical person is setup. Plan:

- **One-click Claude Desktop extension (`.mcpb`):** double-click to install. No terminal, no Node.js to set up.
- The `npx` route stays for developers.
- The README gets a 3-step "for you, or for the family member helping" section.

## Build order

1. **Confirm the calendar demo** imports correctly (Apple, then Google).
2. **Money core:** data files, bank import (with real export formats), categories and rules, `add_spending`, `spending_summary`, `money_ahead`, `rainy_day_plan`, all with tests. _Largest piece._
3. **Home screen:** dashboard, print view, light and dark, accessibility checks. Then screenshots.
4. **Skill:** workflows, connectors, UK pack with sources, behaviour tests.
5. **Ship:** one-click extension, README, screenshots, GitHub, npm, Agensi listing (free server plus paid Pro).
