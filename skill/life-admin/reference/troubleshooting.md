# Troubleshooting

| Problem | What to do |
| --- | --- |
| The tools aren't there | The server isn't connected. Run `npx -y @nkc27/life-admin-mcp doctor`, then restart the AI app. See `reference/setup.md`. |
| "This is the demo folder" | Run `npx -y @nkc27/life-admin-mcp init` to create their own, then restart. |
| "Did you mean ...?" | The title didn't match exactly. Confirm the suggestion with them before acting. |
| A date was refused | Dates must be real and written YYYY-MM-DD (`2027-03-03`). Ask for the date rather than guessing. |
| "looks like a card number" | Store only the last four digits in `ref`. Never repeat the number back. |
| Bank file not recognised | It must be the CSV export, not a PDF. The error shows the first row; check it has a date, a description and an amount. |
| Wrong category after import | `categorise` with a few words from the description; it's remembered for next time. |
| Calendar events not appearing | Make sure they opened `exports/life-admin.ics` with their calendar app and chose a calendar. After changes, export and import again. |
| Home screen won't open | It shows its address (`http://127.0.0.1:...`). Paste that into the browser. It only works on the same computer. |
| An item has a problem | `doctor` lists item files with unreadable dates or costs. |
