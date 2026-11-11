# Changelog

## 0.1.0 (unreleased)

- Project set up from second-brain-mcp: typed life-admin items stored as markdown in `~/LifeAdmin/items`.
- Storage validates dates, costs and reminder windows, masks references to their last four characters, refuses card numbers, and keeps deletes recoverable.
- Dates are read as text, so an impossible date is reported instead of being rolled over to another day.
- `init` and `doctor` commands; `get_stats` and `list_items` tools.
