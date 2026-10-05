# @zenvi/adobe-link — Zenvi Link

Zenvi Link is a CEP extension (`pro.zenvi.link`) for After Effects and Premiere
Pro. Inside each app it runs a small loopback MCP server, so Zenvi (the desktop
app and `zenvi mcp`) can drive the app with `ae_*` / `premiere_*` tools. Other
MCP clients can connect to it too.

This package holds:

- the tool catalog (TypeScript and zod, shared with the CLI),
- the ExtendScript tool implementations,
- the extension itself (server, panel, manifest),
- the client the CLI uses to find and call it,
- a test harness that runs the ExtendScript under Node against mock Adobe DOMs.

Contracts: `SPEC.md` §3.1–3.4 of the Zenvi handoff effort (discovery files, host
protocol, receipts, catalogs). Defaults: `src/taste.ts` (TASTE.md as data).

## Architecture

```
 Claude Code / Codex / Cursor                 Zenvi desktop (Assistant tools)
            │ stdio                                   │
   ┌────────▼─────────┐  reads ~/.openshot_qt/link/   │
   │ zenvi mcp (CLI)  │──────── aftereffects.json ────┤
   │ discoverHosts()  │         premiere.json         │
   │ HostClient       │                               │
   └────────┬─────────┘                               │
            │ POST http://127.0.0.1:<port>/mcp  (Bearer token, JSON-RPC)
   ┌────────▼──────────────────────────────────────────▼──────────┐
   │ Zenvi Link in After Effects / Premiere Pro (CEP)             │
   │  service extension (invisible) ── or ── panel (fallback)     │
   │  extension/server: HTTP → validate (schema.js) → FIFO queue  │
   │        │ evalScript('ZenviLink.dispatch("ae_x", "{…}")')     │
   │  host/aeft.jsx | host/ppro.jsx (ExtendScript, ES3):          │
   │   json2 + polyfills + ZenviLink runtime + app tools          │
   │        └──> contract-3 receipt (JSON string)                 │
   └──────────────────────────────────────────────────────────────┘
```

- One server per app, no hub. Clients never scan ports: they read the
  discovery file, check its pid, and send one `initialize` to the URL it names.
- The tool catalog is defined once in `src/catalog/*.ts`. `gen:catalog` writes
  it as JSON into the extension, so the server can list and validate tools
  without TypeScript.
- Tool calls run one at a time, because ExtendScript is single-threaded.

```
src/catalog/        HostToolDef catalogs (zod) + shared schema blocks; JSON via gen:catalog
src/taste.ts        TASTE defaults (also injected into the host scripts as ZenviLink.TASTE)
src/host-bundle.ts  concatenates the host scripts exactly as the build does
src/discovery.ts    discoverHosts / inspectHost: find running Zenvi Link servers (CLI side)
src/client.ts       HostClient: MCP SDK client with the bearer token
src/receipt.ts      HostReceipt type + parser
src/testing/        loadHostScript (ES3 vm realm), createAeMock, createPremiereMock, checkEs3,
                    FakeCep (window.__adobe_cep__ stand-in), typed loaders for extension/*.js
extension/catalog/  generated catalog JSON (committed; a test fails when stale)
extension/host/     ExtendScript: common/* (json2, polyfills, ZenviLink runtime), aeft/*, ppro/*
extension/server/   loopback MCP server, queue, schema check, discovery files, CEP boot (CommonJS, ES2017)
extension/panel/    the panel (vanilla HTML/CSS/JS), panel-core.js, send-to-zenvi-<app>.js hooks
extension/CSXS/     manifest.xml (version injected by the build); .debug for remote debugging
scripts/            gen-catalog, build-extension, install-dev, package-zxp
```

## Develop and install

```bash
npm run build -w @zenvi/adobe-link          # dist/pro.zenvi.link (dev build, with .debug)
npm run install:dev -w @zenvi/adobe-link    # build, link into the CEP folder, PlayerDebugMode on
npm run install:dev -w @zenvi/adobe-link -- --dry-run     # print the plan only
npm run install:dev -w @zenvi/adobe-link -- --copy        # copy instead of link
npm run install:dev -w @zenvi/adobe-link -- --uninstall
```

- **Extension folder.** macOS:
  `~/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link` (a
  symlink to `dist/pro.zenvi.link`). Windows:
  `%APPDATA%\Adobe\CEP\extensions\pro.zenvi.link` (a junction, so no admin
  rights are needed).
- **Unsigned extensions** load only with `PlayerDebugMode` set. On macOS that
  is `defaults write com.adobe.CSXS.<9-12> PlayerDebugMode 1`. On Windows it is
  `reg add HKCU\Software\Adobe\CSXS.<9-12> /v PlayerDebugMode /t REG_SZ /d 1 /f`.
  `install:dev` sets both forms.
- Restart After Effects or Premiere Pro after installing. The background
  service starts when the app activates. The panel is under
  **Window → Extensions → Zenvi Link**.
- After changing JSX or server code, run `npm run build` again and reload the
  extension (close and reopen the panel, or restart the app). A symlinked
  install picks up the new build.

## Debugging

- `.debug` opens Chrome DevTools ports. Open `http://localhost:8088` for the
  service in After Effects, 8089 for the service in Premiere Pro, 8090 for the
  panel in After Effects, and 8091 for the panel in Premiere Pro. Server logs
  appear in the console as `[Zenvi Link] …`.
- **Discovery files.** `~/.openshot_qt/link/aftereffects.json` and
  `premiere.json` hold the URL, pid and project. The bearer token is in the
  `*.token` file next to each (mode 0600).
- **Manual call:**
  ```bash
  F=~/.openshot_qt/link/aftereffects.json
  curl -s "$(jq -r .url $F)" -H "Authorization: Bearer $(cat "$(jq -r .token_file $F)")" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ae_get_state","arguments":{}}}'
  ```
- **"the Zenvi Link host script did not answer".** The JSX failed to load.
  Open the ExtendScript console (VS Code ExtendScript Debugger) or the service
  DevTools. A HOST_ERROR receipt carries `error.line`. In tests,
  `loadHostScript(...).locate(line)` maps that line back to the source file.

## Protocol (SPEC §3.2)

- **Requests.** `POST <url>` with JSON-RPC 2.0. Send
  `Authorization: Bearer <token>` and `Content-Type: application/json`.
  Responses are `application/json`; there is no SSE and no session.
  `GET`/`DELETE` return 405.
- **Rejected requests.** Any `Origin` header, or a `Host` header other than
  `127.0.0.1:<port>` / `localhost:<port>`, gets 403. A missing or wrong token
  gets 401 with `WWW-Authenticate: Bearer`. Bodies over 8 MB get 413.
- **Methods.** `initialize` negotiates the protocol version (2025-06-18,
  2025-03-26 or 2024-11-05, falling back to 2025-06-18). The others are
  `notifications/*` (202), `ping`, `tools/list` and `tools/call`. Anything else
  is -32601, and an unknown tool name is -32602.
- **`tools/call` result.** It returns
  `{content: [{type: "text", text: JSON(receipt)}, …images], structuredContent: receipt, isError}`.
  Arguments are checked against the catalog schema first: unknown keys, types,
  enums and ranges are refused with `INVALID_ARGUMENT`. Schema defaults are
  filled before ExtendScript runs.
- **Queue.** Calls run in FIFO order, one at a time. The default timeout is
  120 s, and the catalog's `timeoutMs` can override it. A call that times out
  returns `TIMEOUT`, but the queue waits until ExtendScript actually returns.
  While a call has been running for more than 10 minutes, new calls are refused
  with `BUSY`.
- **Receipts (contract 3).** A receipt has `status`
  (`ok | applied | unchanged | refused | error`), `tool`, `host`, `summary`
  (`Error: …` on failure), `data`, `warnings`, `undoSteps` and `error {code, message}`.
  - After Effects: every mutating call is exactly one undo group, named
    `Zenvi: <title>`.
  - Premiere Pro has no undo grouping. `undoSteps` is what the tool reports, or
    `null` when unknown.

## Adding a host tool

1. **Define it** in `src/catalog/aftereffects.ts` (or `premiere.ts`) with
   `defineHostTool({...})`, and add it to `AE_TOOLS` / `PREMIERE_TOOLS`.
   - The input is a `z.strictObject` with `.describe()` on every field.
   - Reuse `seconds`, `easing`, `color`, `layerRef`, `trackRef`,
     `absolutePath` and `placement` from `src/catalog/types.ts`.
   - Take defaults from `TASTE`.
   - `readOnlyHint: false` makes dispatch wrap the call in one After Effects
     undo group.
   - Set `returnsImage` / `timeoutMs` when needed.
2. **Regenerate** with `npm run gen:catalog -w @zenvi/adobe-link`, then commit
   `extension/catalog/*.json`.
3. **Implement it** in `extension/host/aeft/NN-<area>.jsx` (or `ppro/`). The
   file is ES3 and ASCII only:
   `(function (Z) { Z.register("ae_x", function (args, ctx) { … }); }(ZenviLink));`.
   Title and mutating-ness come from the catalog.
4. **Inside the tool**:
   - **Validate first.** Use `Z.required`, `Z.optional(args, key, type, TASTE fallback)`,
     `Z.oneOf` and `Z.inRange`. The lookups `Z.ae.findComp` / `findLayer` /
     `findItem` and `Z.ppro.findSequence` / `findTrack` /
     `findProjectItemByNodeId` throw refusals for you.
   - **Mutate.** Call `ctx.changed()` right before the first mutation, then
     mutate. Never call `app.beginUndoGroup` yourself.
   - **Warn** with `ctx.warn()` for snapping or fallbacks. Snap times with
     `Z.ae.snapTime(comp, t, ctx, label)` / `Z.ppro.snapTime(seq, t, ctx, label)`.
   - **Return** `Z.ok(summary, data)` (read-only), `Z.applied(summary, data[, undoSteps])`
     or `Z.unchanged(summary, data)`.
   - **Fail.** Refuse with `throw Z.refuse(code, message)`, or fail with
     `throw Z.fail(code, message)`.
   - **Frame captures** write a PNG to the temp folder and return
     `data.image_path`. The server attaches the image and deletes the file. To
     report a path the user should keep, use another key.
5. **Test it** in `src/host/<area>.test.ts`:
   `const mock = createAeMock()`, `const host = loadHostScript("aeft", mock.globals)`,
   `host.dispatch("ae_x", args)`. Then assert the receipt and the mock
   (`mock.state.undoGroups`, `layer.scale.key(1)`, …). Grow the mocks in
   `src/testing/*-mock.ts` with the real DOM names. Catalog parity, ES3 syntax
   and ASCII checks pick new files up automatically.
6. **Check** with `npx vitest run --project adobe-link`,
   `npx eslint packages/adobe-link` and `npm run typecheck -w @zenvi/adobe-link`.

The test realm is ECMAScript 3, like ExtendScript. `[].map`, `forEach`,
`Object.assign`, `"".startsWith` and similar methods do not exist there, or in
the apps. Use `Z.each` / `Z.map` / `Z.filter`, `indexOf` and `trim`
(polyfilled), and bracket access for reserved words
(`TASTE.timing.audioFade["in"]`).

**Panel "Send to Zenvi".** `extension/panel/send-to-zenvi-aftereffects.js` and
`…-premiere.js` export `{label, run}`. Set `run(ctx)` to wire the button. `ctx`
provides `callHostTool`, `callDesktopTool` and `desktop`.

## ZXP packaging

```bash
npm run package:zxp -w @zenvi/adobe-link            # dist/pro.zenvi.link-<version>.zxp
```

- **ZXPSignCmd** comes from Adobe's
  [CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources) (`ZXPSignCMD/`).
  Put it on PATH or set `ZXP_SIGN_CMD`.
- **Certificate.** Set `ZXP_CERT` and `ZXP_CERT_PASSWORD` to use a real
  certificate. Otherwise a self-signed one is created in `dist/zxp/`; installers
  then show an unknown publisher. `ZXP_TSA` adds a timestamp server.
- **Contents.** The ZXP is a release build, without `.debug`. Install it with
  Adobe's UPIA (`UnifiedPluginInstallerAgent --install <zxp>`) or a ZXP
  installer.
- Without ZXPSignCmd the script explains what to do and exits 0.

## Roadmap: UXP

CEP is still the only way to reach both apps today, but:

- Premiere Pro supports UXP plugins since 25.6.
- Adobe disables CEP by default in Dec 2028 and removes it in Dec 2029.
- After Effects UXP enters public beta in Nov 2026.

The protocol, catalog, receipts and discovery files do not depend on CEP. Only
`extension/` (the server's evalScript bridge and the ES3 host scripts) would be
ported to a UXP plugin. Its HTTP server would come from UXP's network APIs or a
companion process.

## Manual test plan (needs After Effects or Premiere Pro)

Automated tests run the real server and host scripts against mock DOMs. They do
not touch the Adobe apps. With an app installed:

1. **Install.** Run `npm run install:dev -w @zenvi/adobe-link`, then restart
   After Effects.
   **Pass:** within a few seconds of the app activating,
   `~/.openshot_qt/link/aftereffects.json` exists. Its `pid` is alive, and its
   `app_version` matches *Help → About*.
2. **Panel.** Open *Window → Extensions → Zenvi Link*.
   **Pass:** it shows "Running", the server URL and "Background service", and
   its colours follow the app theme.
3. **Discovery.** Call `ae_get_state` with the `curl` above (or through
   `zenvi mcp` once it knows the Adobe hosts).
   **Pass:** the receipt shows the open project and the active comp. The panel
   lists the call under *Recent tool calls*.
4. **Copy MCP config.** Click *Copy MCP config* and paste the
   `claude mcp add …` line into a terminal.
   **Pass:** Claude Code lists the `ae_*` tools.
5. **Project changes.** Save the project under a new name and switch away from
   the app and back.
   **Pass:** `project` in the discovery file updates within ~15 s, and
   `last_active_at` updates on activation.
6. **Quit.** Quit After Effects.
   **Pass:** the discovery and token files are gone.
7. **Panel fallback.** Disable the service, for example by removing its
   `<Extension Id="pro.zenvi.link.service">` dispatch from the installed
   manifest, then restart.
   **Pass:** after 3 s the panel says it runs the server itself, and calls work
   while it is open.
8. **Premiere Pro.** Repeat steps 1–6 with `premiere_get_state`.
   **Pass:** the receipt lists sequences, the playhead and the selected clips.
