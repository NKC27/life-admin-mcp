# Changelog

## 1.1.0 (2026-11-17)

- Works in any country. New settings: country, optional state or region, and optional currency (`LIFE_ADMIN_COUNTRY`, `LIFE_ADMIN_REGION`, `LIFE_ADMIN_CURRENCY`), asked for by the one-click installer. With nothing set it behaves exactly as before: the UK (England and Wales) and pounds; a region on its own still means the UK.
- Public holidays for about 200 countries and their regions from the open date-holidays data, worked out on the computer. The UK keeps the official gov.uk dates, with date-holidays after 2028.
- `bank_holidays` takes `place` (e.g. "Ireland", "United States, California", "AU-NSW") instead of `region`.
- Money is shown in the person's currency and their country's English style; paydays move for that country's holidays and weekends (Friday and Saturday where that's the weekend).
- Bank statements from other countries: comma, semicolon or tab separated; decimal commas ("1.234,56"); month-first dates worked out from the file (falling back to the country's usual order); common German, French, Spanish, Dutch and Italian column names; more shop names from outside the UK.
- Free-help wording is country-aware: UK services are named for UK users, and others get a neutral pointer to their country's free guidance and debt advice.
- `doctor` and `get_stats` show the country and currency, and warn about settings they don't recognise.
- The free skill no longer gives UK rules to people elsewhere.

## 1.0.0 (2026-11-17)

- First public release. Typed life-admin items stored as markdown in `~/LifeAdmin/items`.
- Storage validates dates, costs and reminder windows, masks references to their last four characters, refuses card numbers, and keeps deletes recoverable.
- Dates are read as text, so an impossible date is reported instead of being rolled over to another day.
- `init`, `doctor`, `due` and `ics` commands.
- Tools: `due_soon`, `add_item`, `get_item`, `update_item`, `mark_handled`, `search_items`, `list_items`, `delete_item`, `restore_item`, `get_stats`.
- Date handling works on whole calendar days in local time, keeps month-end and 29 February schedules from drifting, and rolls stale dates past today.
- `mark_handled` logs a dated history line and any price change with the old price and percentage.
- `LIFE_ADMIN_TODAY` pins today's date for tests and demos.
- Calendar export (`export_calendar` tool and `ics` command): all-day events with 9am reminders, repeats that match `mark_handled` (checked against ical.js), stable event IDs, no references or notes, optional minimal mode.
- `due` command prints what's overdue and due soon in the terminal.
- Money: bank statement import (common UK layouts, preview first, duplicates skipped, spreadsheet-formula-safe CSV), typed spending, category rules, weekly and monthly summaries against what's usual, bills before payday, and a rainy-day planner with risk checks and set-asides for big yearly bills.
- Birthdays and reminders as item types; paydays (income) kept out of due lists and the calendar.
- UK bank holidays bundled from gov.uk; paydays on weekends or bank holidays move to the working day before.
- Home screen (`dashboard` command, `open_home_screen` tool): large text, light and dark, print-friendly, served to this computer only.
- One-click Claude Desktop installer (`npm run bundle` builds `life-admin.mcpb`): asks where to keep files and where in the UK you live, creates the folder on first start, and is checked by installing it the way Claude Desktop does.
- The region setting accepts plain names such as "Scotland" or "Northern Ireland".
- Free companion skill in `skill/life-admin`, with a lint test against the live server and behaviour evals.
