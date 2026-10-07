---
description: Set up Zenvi Link so Zenvi can drive After Effects and Premiere Pro
---

Help the user connect After Effects and/or Premiere Pro to Zenvi through the Zenvi Link extension. The CLI is `node ${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs`.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs adobe doctor` and summarise it: which apps are installed, whether Zenvi Link is installed (and which version), PlayerDebugMode, which apps are connected. Zenvi Link runs on macOS and Windows only.
2. If Zenvi Link is missing or older than the one this plugin ships, show the plan with `node ${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs adobe install --dry-run`. Explain it: it copies the extension into the user's CEP extensions folder and turns on PlayerDebugMode (needed for unsigned extensions; other unsigned extensions are allowed too). Ask before running it, then run `node ${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs adobe install`.
3. Ask the user to restart After Effects / Premiere Pro (quit fully, then open it with a project). Zenvi Link starts with the app; its panel is Window > Extensions > Zenvi Link and shows "Running" and the server URL.
4. Run `adobe doctor` again and call `list_hosts`. When the app shows as connected, call `ae_get_state` or `premiere_get_state` and tell the user what you see (project, active comp or sequence). If the `ae_*` / `premiere_*` tools do not appear in your tool list yet, the MCP client may need a restart (`/mcp` reconnect in Claude Code).
5. Still not connected: read the doctor's hints to the user (the app not running, a stale file after a crash, Zenvi Link not answering: reopen its panel). Never edit files under ~/.openshot_qt/link yourself.
