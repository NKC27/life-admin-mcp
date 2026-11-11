# Changelog

## 0.1.0 (unreleased)

- Project set up from second-brain-mcp: typed life-admin items stored as markdown in `~/LifeAdmin/items`.
- Storage validates dates, costs and reminder windows, masks references to their last four characters, refuses card numbers, and keeps deletes recoverable.
- Dates are read as text, so an impossible date is reported instead of being rolled over to another day.
- `init` and `doctor` commands.
- Tools: `due_soon`, `add_item`, `get_item`, `update_item`, `mark_handled`, `search_items`, `list_items`, `delete_item`, `restore_item`, `get_stats`.
- Date handling works on whole calendar days in local time, keeps month-end and 29 February schedules from drifting, and rolls stale dates past today.
- `mark_handled` logs a dated history line and any price change with the old price and percentage.
- `LIFE_ADMIN_TODAY` pins today's date for tests and demos.
