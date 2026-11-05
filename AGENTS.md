# AGENTS.md - notes for AI agents

Project overview and setup: see README.md.

<!-- BEGIN:browserstack -->
## Cross-browser and real-device testing (BrowserStack)

BrowserStack (Janmejay's GitHub Student Pack licence) is available for this project. Use it after UI, CSS, layout, PWA or mobile changes to check the real browsers and phones that local Chromium can't show - Safari on iPhone, Chrome on Android, Edge and Firefox on Windows.

- **Coding agents (Claude Code, Codex, Cursor):** `.mcp.json` registers BrowserStack's official remote MCP server as `browserstack` (one-time `/mcp` sign-in). Codex: `codex mcp add browserstack --url https://mcp.browserstack.com/mcp`, then `codex mcp login browserstack`.
- **Agents that drive Chrome (Cowork / Claude in Chrome):** Janmejay's Chrome has the BrowserStack extension installed and is signed in - use https://live.browserstack.com/dashboard.
- How-to, default device set, localhost testing and troubleshooting: [docs/BROWSERSTACK.md](docs/BROWSERSTACK.md).
- Never a blocker: if BrowserStack isn't available (no sign-in, plan limit, network), say so in your summary and carry on.
<!-- END:browserstack -->
