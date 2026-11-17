# Setup

The skill needs the free **life-admin** MCP server, which keeps everything in a folder on the person's own computer (`~/LifeAdmin`).

## Install (about two minutes)

1. Needs Node.js 18 or newer ([nodejs.org](https://nodejs.org)).
2. In a terminal: `npx -y @nkc27/life-admin-mcp init`. This creates `~/LifeAdmin` and prints the exact line for each AI app.
3. Connect it. For Claude Code: `claude mcp add --scope user life-admin -- npx -y @nkc27/life-admin-mcp`. For Claude Desktop, Cursor and VS Code, `init` prints the settings to paste.
4. Restart the AI app, then check: `npx -y @nkc27/life-admin-mcp doctor` (every line should say `[ok]`).

## Their own folder vs the demo

Until `init` has run, the server uses a built-in demo folder with made-up items, and `get_stats` says so. Real information should go in their own folder: run `init`.

## Scotland and Northern Ireland

Country, region and currency are asked for when installing the one-click extension (change them later in Claude's extension settings). For other setups, set `LIFE_ADMIN_COUNTRY` (e.g. `Ireland`, `United States`), optionally `LIFE_ADMIN_REGION` (e.g. `Scotland`, `California`) and `LIFE_ADMIN_CURRENCY` (e.g. `EUR`) in the server's settings. With nothing set it uses the UK (England and Wales) and pounds.

## The home screen

`npx -y @nkc27/life-admin-mcp dashboard` opens it in the browser, or ask the assistant to "show my home screen". It runs only on this computer.
