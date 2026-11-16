# Changelog

## 0.1.0 (unreleased)

- Project set up from second-brain-mcp: typed life-admin items stored as markdown in `~/LifeAdmin/items`.
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
