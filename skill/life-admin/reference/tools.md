# Tool reference

Items are addressed by **title** (case doesn't matter). If nothing matches, the error suggests the closest title ("Did you mean ...?"): confirm the suggestion with the person before acting on it.

Safety column: **read** never changes anything; **write** adds or changes something without losing anything; **destructive** removes something (recoverable ones say so).

## Dates, renewals and bills

| Tool | Arguments | Notes |
| --- | --- | --- |
| `get_stats` | none | Where the folder is, counts by type, how many are overdue and due in the next 30 days, and today's date. Good first call. read |
| `due_soon` | `days?` (default 30), `type?` | Overdue items, items due within `days`, and items further out whose reminder window has opened. Paydays are never listed. Adds any bank holidays in the window. read |
| `list_items` | `type?`, `limit?` | Everything, sorted by due date. read |
| `get_item` | `item` | Full details: provider, cost, due date with days left, when reminders start, notes and the dated history (including past prices). read |
| `search_items` | `query`, `type?`, `limit?` | Matches any word in titles, providers, tags and notes. Use before `add_item`. read |
| `add_item` | `title`, `type`, `provider?`, `cost?`, `currency?`, `period?`, `due?`, `remind_days?`, `auto_renews?`, `ref?`, `tags?`, `notes?` | Types: renewal, bill, subscription, warranty, policy, vehicle, document, income, birthday, reminder. `due` must be YYYY-MM-DD. Refuses an exact duplicate title, impossible dates and anything that looks like a card number. Birthdays default to yearly with 7 days' notice. `ref` keeps only the last four characters. write |
| `update_item` | `item`, `title?`, `type?`, `provider?`, `cost?`, `currency?`, `period?`, `due?`, `remind_days?`, `auto_renews?`, `ref?`, `tags?`, `clear?`, `add_note?` | Changes only what you pass. `clear` removes `provider`, `cost`, `due` or `ref`. `add_note` appends a dated line to the history. write |
| `mark_handled` | `item`, `note?`, `new_cost?`, `next_due?` | Logs that it was dealt with and moves the date on by its period (month ends stay right; stale dates roll past today). One-offs lose their date unless `next_due` is given. `new_cost` logs old price, new price and the % change. write |
| `delete_item` | `item` | Exact title only; moves to the trash. Confirm first. destructive (recoverable) |
| `restore_item` | `item` | Brings back the most recently deleted item with that title. write |

## Money

| Tool | Arguments | Notes |
| --- | --- | --- |
| `import_bank_file` | `path`, `confirm?` | Reads a bank statement CSV. `confirm` false (default) only previews: count, dates, totals, new vs already imported, unsorted shops. `confirm: true` saves. Duplicates are always skipped. write |
| `add_spending` | `amount`, `description`, `category?`, `date?`, `money_in?` | One payment or refund. `amount` is always positive; `money_in: true` for refunds or money received. Card numbers are masked. write |
| `categorise` | `match`, `category`, `remember?` | Moves every transaction whose description contains `match` (whole words) into `category`, and remembers it for future imports unless `remember: false`. write |
| `spending_summary` | `period?`, `offset?` | Week (default) or month. Totals by category against the person's usual (up to four earlier periods), money in, money saved, biggest shops. `offset: 1` is last week or month. read |
| `money_ahead` | `balance?`, `days?` | Payments due before the next payday (moved to the working day before a weekend or bank holiday). With `balance`, roughly what's left until payday. read |
| `rainy_day_plan` | none | Income, usual spending, set-asides for big yearly bills, then Gentle / Steady / Stretch amounts with a risk check against the tightest recent month, plus warnings and ideas. read |
| `update_pot` | `saved?`, `add?`, `target?` | The rainy-day pot: set the amount, add or take some, or set a goal. write |

Categories: `bills`, `groceries`, `shopping`, `going-out`, `transport`, `tax`, `subscriptions`, `savings`, `income`, `transfers`, `other`.

## Calendar, holidays and the home screen

| Tool | Arguments | Notes |
| --- | --- | --- |
| `export_calendar` | `minimal?` | Writes `exports/life-admin.ics`: every dated item as an all-day event with 9am reminders (when the reminder window opens, and on the day). Repeats match `mark_handled`. Never includes references or notes; `minimal: true` also leaves out provider and cost. write |
| `bank_holidays` | `days?`, `region?` | Official gov.uk dates for `england-and-wales`, `scotland` or `northern-ireland`. read |
| `open_home_screen` | none | Opens the home screen in the browser (this computer only). read |
