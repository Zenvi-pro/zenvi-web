# Zenvi Link: After Effects and Premiere Pro

Zenvi Link is one CEP extension (`pro.zenvi.link`) that loads in Adobe After
Effects and Adobe Premiere Pro. Inside each app it runs a small MCP server
on this computer only, so Zenvi can drive the app with `ae_*` and
`premiere_*` tools: build and animate comps, cut sequences, look at frames,
render, and move edits between the apps and Zenvi.

Who talks to it:

- **`zenvi mcp`** (Claude Code, Codex, Cursor, Claude Desktop): the tools
  appear next to the Zenvi tools ([LOCAL_AGENTS.md](LOCAL_AGENTS.md)).
- **The `zenvi` CLI**: `zenvi hosts`, `zenvi ae <tool>`, `zenvi premiere <tool>`.
- **The Zenvi desktop app**: the Zenvi Assistant drives the apps
  (`list_link_hosts_tool`, `call_link_host_tool`), and File > Send To sends
  the open project to After Effects or Premiere Pro.
- Any other MCP client that reads the discovery file.

The extension's code, tool catalog and its own developer documentation live
in [`packages/adobe-link`](../packages/adobe-link/README.md). The defaults
the tools apply are in [TASTE.md](TASTE.md).

- [Install](#install)
- [Use it](#use-it)
- [How it works](#how-it-works)
- [Security model](#security-model)
- [Tools](#tools)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

## Install

Requirements: After Effects or Premiere Pro 2019 or newer (CEP 9-12) on
macOS or Windows, and the `zenvi` CLI ([CLI.md](CLI.md#install)) or the
Claude Code plugin (which contains it).

```bash
zenvi adobe install --dry-run   # what it will do
zenvi adobe install             # do it
zenvi adobe doctor              # check everything
```

In Claude Code: `/zenvi:adobe-setup` walks through the same steps.

`zenvi adobe install`:

1. Copies the Zenvi Link that ships with this `zenvi` (`dist/adobe/pro.zenvi.link`
   next to the CLI bundle) into your CEP extensions folder, replacing an
   older copy:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\pro.zenvi.link` (no admin rights needed)
2. Turns on `PlayerDebugMode` for CSXS 9-12 (macOS:
   `defaults write com.adobe.CSXS.<N> PlayerDebugMode 1`; Windows:
   `reg add HKCU\Software\Adobe\CSXS.<N> /v PlayerDebugMode /t REG_SZ /d 1 /f`).
   The apps load unsigned extensions only with it on. It applies to every
   unsigned extension, not just Zenvi Link.

Then quit and reopen After Effects / Premiere Pro. Zenvi Link starts in the
background when the app starts; its panel is **Window > Extensions >
Zenvi Link** (status, server URL, recent tool calls, "Copy MCP config").

- `zenvi adobe install --uninstall` removes the extension. PlayerDebugMode
  stays on; the command prints how to turn it off.
- Developers: `npm run install:dev -w @zenvi/adobe-link` builds from source
  and links the build into the CEP folder, so later builds load after a
  reload. `zenvi adobe install` replaces such a link with a copy (and says so).
- Distribution without PlayerDebugMode: a signed ZXP
  (`npm run package:zxp -w @zenvi/adobe-link`, see the package README),
  installed with Adobe's UPIA or a ZXP installer into the machine-wide CEP
  folder. `zenvi adobe doctor` finds copies there too.
- `ZENVI_ADOBE_EXTENSION=/path/to/pro.zenvi.link` makes `zenvi adobe install`
  use another build.

`zenvi adobe doctor` checks the bundled extension, the installed copies and
their versions, PlayerDebugMode, whether each app is installed and
connected (and whether its Zenvi Link has every tool this `zenvi` knows),
and which tool families `zenvi mcp` lists.

## Use it

Open the app with a project, then:

```console
$ zenvi hosts
host              state          details
zenvi-desktop     not running    start it with `zenvi open`
zenvi-portable    ready          trip.zvn
after-effects *   connected      Adobe After Effects 2026 26.3.0 · /Users/me/Work/promo.aep · 30 tools
premiere-pro      not connected  no discovery file (the app is not running, or Zenvi Link is not installed) · 25 tools · `zenvi adobe doctor`

$ zenvi ae get_state
$ zenvi ae add_text text="Launch day" style=lower-third placement=lower-third animation=slide-in
$ zenvi ae capture_frame time=2 --out check.png
$ zenvi premiere get_sequence --json
$ zenvi call ae_render comp=Promo preset=h264 output=/Users/me/out/promo.mp4
```

The tool prefix is optional after `zenvi ae` / `zenvi premiere`; arguments
are `key=value` like `zenvi call` (values that look like JSON are parsed,
strings are converted to numbers and booleans by the tool's schema).
`zenvi ae` alone lists the tools. Exit code 1 when a call is refused or
fails.

From Claude Code, ask in plain words ("in After Effects, add a lower third
for Ana Ruiz, Head of Design, and show me the frame"). The agent calls
`list_hosts`, then the `ae_*` tools, and checks frames with
`ae_capture_frame`; the plugin's `after-effects` and `premiere-pro` skills
carry the workflow and the taste rules.

Moving edits between the apps and Zenvi is in [HANDOFF.md](HANDOFF.md):
`send_to_after_effects_tool`, `bring_from_after_effects`,
`send_to_premiere_tool`, `bring_from_premiere`.

### Which tools `zenvi mcp` lists

The two families are large (about 18k tokens of tool definitions for After
Effects, 10k for Premiere Pro), so `zenvi mcp` lists a family only where it
can be used. `ZENVI_MCP_ADOBE` in the server's environment:

| Value | Lists |
| --- | --- |
| `auto` (default) | a family when its app's discovery file exists (Zenvi Link has run in it here), or when Zenvi Link is installed and the app is installed (in `/Applications` or `Program Files\Adobe`; when neither app is found there, both families) |
| `on` | both families |
| `off` | neither (calls are refused) |

`list_hosts` always says whether a family is listed and how to enable it.
When a family appears during a session (you installed Zenvi Link and opened
the app), the server sends `notifications/tools/list_changed`; clients that
ignore it pick the tools up after a restart.

## How it works

```
 Claude Code / Codex / Cursor          Zenvi desktop app (Assistant, Send To)
        │ stdio                                   │
 ┌──────▼──────────┐  reads ~/.openshot_qt/link/  │
 │ zenvi mcp / CLI │───── aftereffects.json ──────┤
 │ host registry   │      premiere.json           │
 └──────┬──────────┘                              │
        │  POST http://127.0.0.1:<port>/mcp   (Authorization: Bearer <token>, JSON-RPC)
 ┌──────▼─────────────────────────────────────────▼─────────┐
 │ Zenvi Link inside After Effects / Premiere Pro (CEP)     │
 │  server: auth, Host/Origin guard → validate against the  │
 │          catalog schema (+ TASTE defaults) → FIFO queue  │
 │  evalScript('ZenviLink.dispatch("ae_add_text", "{…}")')  │
 │  host/aeft.jsx · host/ppro.jsx (ExtendScript, ES3)       │
 │          └─> contract-3 receipt (+ PNG frame captures)   │
 └──────────────────────────────────────────────────────────┘
```

- **Discovery.** When its server starts, the extension writes
  `~/.openshot_qt/link/aftereffects.json` or `premiere.json` (Windows:
  `%USERPROFILE%\.openshot_qt\link\`): `url`, `token_file`, `pid`,
  `project`, `version`, `app`, `app_name`, `app_version`, `protocol`,
  `started_at`, `last_active_at`. The token goes into `token_file` first.
  `project` follows the open project; `last_active_at` moves when the app
  comes to the front and on every tool call. A clean quit removes both
  files; the newest instance of an app wins.
- **Finding it.** A client trusts a file only when its `pid` is alive, its
  URL is `127.0.0.1` / `localhost`, and one `initialize` with the token
  answers within 1.5 s as `zenvi-link-<app>`. It contacts only that URL.
  `zenvi` reuses one connection per app while the file names the same
  server, and removes files whose process is gone.
- **Hosts.** `zenvi mcp` knows four hosts: the Zenvi desktop app, the
  portable Zenvi engine (itself), After Effects and Premiere Pro. The
  **active** host is the connected one used most recently: the app that was
  last frontmost or called, or the portable engine after its own calls.
- **Calls.** One at a time per app (ExtendScript is single-threaded), 120 s
  by default (renders allow longer). Arguments are checked against the
  tool's JSON Schema before any ExtendScript runs (unknown keys, types,
  enums, ranges: `refused` with `INVALID_ARGUMENT`), and omitted arguments
  get the TASTE defaults.
- **Receipts** (contract 3): `status` `ok` (read-only) | `applied` |
  `unchanged` | `refused` | `error`, `summary` (`Error: …` on failure),
  `data` (ids: `comp_id`, `layer_id`, `node_id`, …), `warnings` (frame
  snapping, fallbacks), `undoSteps`, `error {code, message}` with codes
  `INVALID_ARGUMENT`, `NOT_FOUND`, `NO_PROJECT`, `NO_ACTIVE_COMP`,
  `NO_ACTIVE_SEQUENCE`, `UNSUPPORTED`, `HOST_ERROR`, `TIMEOUT`, `BUSY` (and
  `NOT_CONNECTED` from `zenvi` itself). `refused` means nothing changed.
- **Undo.** After Effects: every mutating call is exactly one undo group
  ("Zenvi: <tool title>"). Premiere Pro's scripting has no undo grouping:
  each change a tool makes is its own undo step, and `undoSteps` says so
  when it is known.
- **Ids and times.** After Effects comps by `comp_id` or name, layers by
  `layer_id`, `{"index": n}` (1 = top) or name. Premiere sequences by
  `sequence_id` or name, clips and items by `node_id`, tracks as
  `{"kind": "video" | "audio", "index": n}` (0-based: V1 is 0). Times are
  seconds, snapped to the frame grid (with a warning when they move).
  `zenvi` reads an all-digits text value for a field that takes an id or a
  name (`layer=12`, `"comp": "4"`) as the id; address a layer whose name is
  only digits by its `layer_id` or `{"index": n}`.

## Security model

- **This computer only.** The server listens on `127.0.0.1` on a random
  port. Clients accept only loopback URLs and never scan ports.
- **A token per start.** 32 random bytes (hex), new each time the server
  starts, in a token file readable only by you (mode 0600) and written
  before the discovery file appears. Requests without it get 401.
- **No browsers.** Any request with an `Origin` header gets 403, and so does
  a `Host` header other than `127.0.0.1:<port>` / `localhost:<port>` (DNS
  rebinding). Bodies are limited to 8 MB. `GET` and `DELETE` are refused.
- **Same rights as the app.** A caller with the token can do what the tools
  do in your project, including `ae_run_script` / `premiere_run_script`
  (arbitrary ExtendScript, marked destructive) and renders to paths you
  choose. Only processes running as your user can read the token.
- **No telemetry.** Zenvi Link makes no network requests beyond this
  computer: the server answers local clients, and the panel's "Send to
  Zenvi" talks only to the Zenvi desktop app's own loopback server.
- **PlayerDebugMode** lets the apps load any unsigned CEP extension. Turn it
  off when you stop using unsigned extensions (`zenvi adobe install
  --uninstall` prints the commands), or install a signed ZXP instead.

## Tools

The catalogs (names, descriptions with the defaults, JSON Schemas) are
defined once in `packages/adobe-link/src/catalog/` and generated into
`packages/adobe-link/extension/catalog/*.json`; `zenvi mcp` lists them from
the same definitions. `zenvi ae` / `zenvi premiere` print the current list.

**After Effects (`ae_*`)**

| Area | Tools |
| --- | --- |
| Read | `ae_get_state`, `ae_list_items`, `ae_get_comp`, `ae_get_layer`, `ae_list_effects`, `ae_capture_frame` (a PNG of the comp at a time) |
| Comps and media | `ae_create_comp` (presets 1080p, 4k, vertical, square, 720p), `ae_set_comp`, `ae_import_files`, `ae_precompose` |
| Layers | `ae_add_layer` (footage, solid, adjustment, null, shape, camera, light), `ae_set_layer`, `ae_arrange_layers` (move, duplicate, delete, split) |
| Text | `ae_add_text` (styles and title-safe placements, optional animation), `ae_set_text` |
| Motion | `ae_apply_motion_preset` (fade, slide, scale-pop, blur-in, typewriter, word-cascade, line-rise, ken-burns, push-in, drift, whip-in), `ae_animate` (keyframes with named easing), `ae_set_property`, `ae_add_expression` |
| Look | `ae_apply_effect`, `ae_set_effect`, `ae_apply_look` (clean, warm-film, teal-orange, moody, bw-contrast), `ae_add_mask`, `ae_add_marker` |
| Output | `ae_render` (H.264 / ProRes presets, render now, queue, Media Encoder), `ae_render_for_zenvi` (for a Zenvi linked clip), `ae_save_project`, `ae_undo` |
| Scripts | `ae_run_jsx_file` (runs a Zenvi export), `ae_run_script` (escape hatch) |

**Premiere Pro (`premiere_*`)**

| Area | Tools |
| --- | --- |
| Read | `premiere_get_state`, `premiere_list_items`, `premiere_get_sequence`, `premiere_capture_frame` |
| Project and sequences | `premiere_import_files`, `premiere_create_sequence` (1080p30/25/24, 4k30, vertical, square), `premiere_open_sequence`, `premiere_save_project` |
| Editing | `premiere_place_clip` (overwrite / insert), `premiere_edit_clip` (move, trim, enable, rename, speed, delete with ripple), `premiere_razor` |
| Motion and look | `premiere_set_clip_properties`, `premiere_animate`, `premiere_apply_effect`, `premiere_add_transition` (Cross Dissolve 0.5 s by default), `premiere_apply_look` |
| Graphics and assist | `premiere_add_text`, `premiere_add_marker`, `premiere_add_captions` (SRT), `premiere_auto_reframe` (9:16, 1:1, 4:5), `premiere_scene_detect` |
| Output | `premiere_export` (presets, range, Media Encoder or direct), `premiere_export_xml` / `premiere_import_xml` (FCP7 XML, used by the Zenvi handoffs) |
| Scripts | `premiere_run_script` (ExtendScript + QE, escape hatch) |

## Troubleshooting

`zenvi adobe doctor` first; it names most problems and their fix.

- **"After Effects is not connected: no discovery file"**: the app is not
  running, Zenvi Link is not installed, or the app was not restarted after
  installing. Open the app; check Window > Extensions > Zenvi Link.
- **"quit or crashed (its Zenvi Link file was left behind)"**: the file's
  process is gone. `zenvi` removes such files; open the app again.
- **"running but Zenvi Link did not answer"**: the server inside the app is
  not responding (it restarted with a new token, or a modal dialog blocks
  ExtendScript). Close dialogs, reopen the Zenvi Link panel, or restart the
  app.
- **The `ae_*` / `premiere_*` tools do not show up in Claude Code**:
  Zenvi Link is not installed here (with `ZENVI_MCP_ADOBE=auto`), or the
  client has not reloaded the tool list: reconnect the server (`/mcp` in
  Claude Code) or restart the client. `list_hosts` says which.
- **"Zenvi Link 1.0.0 in After Effects has no ae_…"**: the installed
  extension is older than this `zenvi`. `zenvi adobe install`, then restart
  the app.
- **`BUSY`**: another call is still running (a long render), or the app
  shows a dialog. Nothing ran; try again when it is free.
- **`TIMEOUT`**: the call took longer than its limit but may still finish in
  the app. Check `ae_get_state` / `premiere_get_state` before retrying.
- **Linked After Effects clips cannot re-render**: save the After Effects
  project first; a clip linked to an unsaved project has no `.aep` to come
  back to.
- **Debug a development build**: `.debug` (dev builds only) opens Chrome
  DevTools on `http://localhost:8088` (After Effects service), 8089
  (Premiere service), 8090 / 8091 (the panels). The package README has a
  `curl` example that calls a tool by hand.

## Roadmap

CEP is the one extension system both apps load today. Premiere Pro supports
UXP plugins since 25.6 and After Effects UXP enters public beta in November
2026; Adobe plans to disable CEP by default in December 2028. The protocol,
catalogs, receipts and discovery files do not depend on CEP, so a UXP port
replaces only the extension's bridge and host scripts.
