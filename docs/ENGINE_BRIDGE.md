# Engine bridge: the desktop runs `@zenvi/engine` tools

Status: RFC + working prototype (zenvi-web `zenvi tool-run` / `zenvi bridge`;
zenvi-core `classes/engine_bridge.py`, off by default). Owner: Jashan.
Written 2026-10-26.

## 1. Problem

New editing capabilities land in the TypeScript engine (this repo) and reach
the web editor, the CLI, the local MCP server and the cloud at once. The
desktop app (zenvi-core, Python + libopenshot) only gets one through a hand
port: `build_reel_tool` was ported with parity tests over 2,591 inputs, the
5k-line motion module never was, and SFX, motion transitions, match cuts, 3D
and motion blocks are all arriving in the engine now. A port per tool is a
second implementation of each domain rule (a bug by this repo's doctrine) and
does not scale.

## 2. Decision

The desktop executes an engine tool through the bundled `zenvi` CLI (Node)
against the open project's JSON, and applies the returned change as one undo
step. One implementation of each tool; the desktop stays the owner of its
project, history, files, playback and export.

```
 Zenvi desktop (Python, Qt)                          zenvi CLI (Node, bundled)
 ─────────────────────────                           ─────────────────────────
 execute_tool(name, args)  ── worker thread ──┐
   1 GUI thread: json.dumps(project − history)│
   2 worker: client.run ─────────── stdio JSON-RPC line ──► zenvi bridge
                                              │             parseProject → ProjectDocument
                                              │             registry.run(tool) with the bridge host
                                              │             ChangeEvents → toDesktopActions
              ◄──────────────── { receipt, actions, files } ─┘
   3 GUI thread: data_version unchanged?  convert_paths_to_absolute(actions)
                 IgnoreUpdates(True) · updates.insert/update/delete … · IgnoreUpdates(False)
   execute_tool's transaction → one undo step;  receipt (contract 3) back to the caller
```

1. **Snapshot** (GUI thread, briefly): the project as the desktop holds it in
   memory (`ProjectDataStore._data`, absolute paths), without `history`, plus
   `current_filepath` and `updates.data_version`. A project that was never
   saved is refused ("save it first"): the engine writes a tool's files into
   `<name>_assets`, which only a saved project has (§8).
2. **Run** (worker thread): the client sends the snapshot to `zenvi bridge`
   (or writes it to a temp file for `zenvi tool-run`). The CLI loads it into a
   `ProjectDocument`, runs the tool with the bridge host (§5) and answers
   `{ ok, text, receipt, label, actions, files, images, timings }`.
3. **Apply** (GUI thread): refused when `data_version` moved (the user or
   another tool edited while Node ran: nothing is applied, "try again").
   Otherwise the actions go through the desktop's own path rules
   (`convert_paths_to_absolute`, so `@transitions/…`, `@emojis/…`, `@assets/…`
   resolve exactly like a project load) and then `UpdateManager.insert /
   update / delete` under `IgnoreUpdates` (one timeline refresh at the end),
   inside `execute_tool`'s transaction: **one intent = one undo step**. A
   failed, refused or no-op call has no actions and leaves no undo step; its
   files are removed (by the CLI, and by the desktop when it refuses a stale
   answer).
4. **Listing**: the desktop reads the CLI's catalog (`zenvi bridge --tools`,
   cached per CLI build in `~/.openshot_qt/engine_bridge/`) and registers
   every available engine tool it does not implement itself. Its MCP server
   lists them with the engine's schema and description (marked "Runs in the
   Zenvi engine (engine bridge)."); the Assistant dispatches them through the
   same `execute_tool`. Desktop tools of the same name always win, and
   project lifecycle tools (`new/open/save_project_tool`, `undo/redo_tool`)
   never bridge.

New files arrive as Project Files inserts, so the files model makes their
thumbnails as for any insert; fingerprints are backfilled at save like other
insert paths. Generated drawings are not indexed.

## 3. Wire format

`zenvi bridge`: JSON-RPC 2.0, one message per line, requests served one at a
time. Python's `NaN` / `Infinity` tokens are tolerated (the engine's
`replaceNonFiniteTokens`). Diagnostics go to stderr.

| Method | Params | Result |
| --- | --- | --- |
| `hello` | — | `{ protocol: 1, engine_version }` |
| `tools` | — | `{ tools: [{ name, title, description, inputSchema, annotations?, available, missing? }] }` |
| `run` | `{ tool, args, project, project_file, surface?, backend_token? }` | the answer below |
| `shutdown` | — | `null`, then exit |

`zenvi tool-run <tool> --snapshot <file> --project-file <zvn> [--args json] [k=v…]`
prints the same answer (exit 1 when `ok` is false); `ZENVI_BACKEND_TOKEN`
carries the token.

```jsonc
{
  "protocol": 1, "engine_version": "0.1.0",
  "ok": true,
  "text": "{\"contract\":3,\"status\":\"applied\",…}",   // the tool's result, a contract-3 receipt
  "receipt": { … },                                       // the same, parsed
  "label": "Add motion template end_card",                // the undo label
  "actions": [                                            // desktop UpdateManager calls, in order
    { "type": "insert", "key": ["layers"], "value": { "id": "…", "number": 2000000, … } },
    { "type": "insert", "key": ["files"],  "value": { "id": "…", "path": "/…/promo_assets/title/end_card-end-name.svg", … } },
    { "type": "update", "key": ["clips", { "id": "C1" }], "value": { "position": 4 } }
  ],
  "files": ["/…/promo_assets/title/end_card-end-name.svg"],   // written by this call
  "images": [ { "mimeType": "image/png", "data": "…" } ],      // when the tool returns frames
  "timings": { "parse_ms": 36, "run_ms": 7, "translate_ms": 0.3 }
}
```

### Actions in the desktop's form

The engine records `ProjectDocument` actions; `toDesktopActions`
(`packages/engine/src/history/desktop.ts`) turns them into calls zenvi-core's
`ProjectDataStore._set` (src/classes/project_data.py:220) applies to the same
result. Its rules differ from the engine's in four ways:

| Desktop `_set` behaviour | Translation |
| --- | --- |
| string key parts and match fields are lower-cased before lookup | a change under an upper-case key (`…/alpha/Points`) is sent as an update of the nearest addressable field above it |
| an update with a non-object value writes the **root** key of that name (`self._data[my_key] = values`) | a nested scalar or list is sent as `update(parent, { name: value })` |
| object updates always merge (`obj.update`), `objects` maps merged per id | an engine `replace` (`Transaction.replace`, now flagged on `ChangeEvent.replaced`) that drops fields, or a merge that would merge `objects` differently, is sent as the parent update with the resulting value; a replaced top-level list item as delete + insert |
| inserts append to top-level lists only | a nested insert is sent as the parent update with the new list |

The lifted values are read by replaying the actions on a scratch document.
What cannot be expressed is refused before anything is applied: `history`,
a root `fps` change (the desktop rescales clips itself when fps changes; the
engine already did), replacing a root object with fewer fields. The tests
check every rule against a TypeScript transcription of `_set`, and zenvi-core
checks the real `_set` end to end.

## 4. Process model and performance

Measured on an Apple M2 Pro, Node 26, the built 5.7 MB `zenvi.mjs`, a
300-clip project (1.9 MB of JSON: every clip carries its reader). Medians;
the desktop side is the real `ProjectDataStore` + `UpdateManager` in the
headless harness. Reproduce with zenvi-core
`tests/benchmarks/bench_engine_bridge.py`.

| | `move_clip_tool` | `add_motion_template_tool` |
| --- | --- | --- |
| snapshot (`json.dumps`, GUI thread) | 22 ms | 24 ms |
| **warm `zenvi bridge`** round trip | 51 ms | 66 ms |
|   of which engine parse + validate | 38 ms | 36 ms |
|   of which tool | 0.5 ms | 7 ms |
|   of which translation | 0.1 ms | 0.3 ms |
| apply (GUI thread) | 0.4 ms | 39 ms |
| **end to end, warm** | **73 ms** | **130 ms** |
| `zenvi tool-run` round trip (Node start per call) | 308 ms | 410 ms |
| end to end, one-shot | 333 ms | 474 ms |

Node start + bundle load: 212 ms (`zenvi --version`), which is also the
cold start of `zenvi bridge`. The target (under 400 ms end to end for a
typical tool, warm) is met with a wide margin by the long-lived process;
one-shot is borderline for anything bigger. **Decision: `zenvi bridge`,
started lazily on the first bridged call and kept for the session**;
`tool-run` stays for debugging and for one-off scripted use.

Where the time goes, and what to do when it matters:

- The apply's 39 ms for the motion template is the desktop's own cost of an
  insert (`_set` deep-copies the whole list it inserts into to record old
  values); every desktop insert pays it today.
- Parse (structuredClone + zod validation + load upgrades of 1.9 MB) dominates
  the round trip. A revision-keyed cache in the bridge process (send the
  project only when `data_version` moved since the last call, else a
  reference) would remove it and the snapshot for chained calls. Not done:
  every edit moves `data_version`, so it helps agent loops of read-only
  calls more than edits; measure on real sessions first.

## 5. The bridge host

The Node host minus what the desktop owns: no `storage` (open/save/recovery),
no `exporter`, no `player`, no `ui`; tools that need them are listed as
unavailable (`missing`) and not registered. Media `collect` / `removeCopies`
are dropped too. `media`, `frames`, `audio`, `assets` and `backend` stay.
Every path the host writes (`writeGenerated`, copies made by `importPath` /
`importUrl`) is recorded when it is inside the project's assets folder and
reported in `files`.

## 6. Versioning

- **Protocol**: `BRIDGE_PROTOCOL` (CLI) and `engine_bridge.PROTOCOL`
  (desktop) are one integer, bumped when a field changes meaning. `hello`
  checks it; a mismatch turns the bridge off for the session with a log line
  (the desktop's own tools keep working).
- **Which CLI**: the desktop runs the CLI bundled with it (§9), never a
  `zenvi` found on PATH, so a desktop release pins its engine. The catalog
  cache is keyed by the bundle's size and mtime, so an update re-reads it.
  `engine_version` is in every answer for logs and receipts.
- **Desktop vs engine names**: the engine's desktop contract is generated
  from zenvi-core (`schemas.gen.ts`, `pending.ts`), so names cannot drift;
  where both implement a tool, the desktop's runs.

## 7. Failure modes

| Failure | What happens |
| --- | --- |
| bridge off / CLI or Node missing | no engine tools listed; one log warning at startup |
| protocol mismatch | no engine tools listed; a process answering another protocol at `hello` is stopped and the call answers `Error: engine bridge: …` |
| CLI crashes or hangs | watchdog kills it after `ZENVI_ENGINE_BRIDGE_TIMEOUT` (120 s); the call answers an error; the next call starts a new process |
| tool refuses / fails | engine receipt with `status: refused/error`, no actions, files removed, no undo step |
| tool replaces the project (`new_project`…) or runs undo/redo | refused by the CLI, nothing applied |
| change the desktop cannot express | refused by the CLI (`made a change the desktop cannot apply`) |
| project edited while the tool ran | refused by the desktop before applying; files removed |
| project never saved | refused before the CLI runs |
| a listener raises while applying | `dispatch_action` logs and continues (desktop behaviour for every edit) |

## 8. Security

- The CLI reads only the snapshot it is given (stdin, or the temp file the
  desktop wrote in a private `mkdtemp` folder, deleted after the call) and
  media the project references; it writes only into the project's
  `<name>_assets` folder. It never opens, saves or exports projects (no
  `storage` / `exporter` in the bridge host).
- No network unless the tool needs the backend (`backend` capability); then
  it uses the **desktop's** Supabase session token, passed per request on the
  pipe (`backend_token`) or in the child's environment for `tool-run`, never
  on the command line (visible in `ps`) and never the CLI's own login.
- The pipe is private to the two processes; there is no port.
- Arguments are validated by the engine's zod schemas exactly as on every
  other surface; the desktop does not pre-validate bridged tools (they have
  no `TOOL_SCHEMAS` entry, the engine coerces Assistant strings itself).

## 9. Bundling Node (plan; not in this change)

- Ship a Node runtime per platform inside the installers (macOS app bundle
  `Contents/Resources/engine/`, Windows next to `zenvi.exe`, Linux AppImage),
  with `zenvi.mjs`, `composite-worker.mjs`, `resvg.wasm`, fonts and the engine
  assets (`node packages/cli/scripts/build.mjs --no-plugin` output: ~8 MB of
  code, 68 MB of assets, of which 38 MB are LUTs and 13 MB transition masks).
  The desktop already ships the same masks and LUTs (`@transitions`,
  `@colors`), so its build can leave them out and point the engine's asset
  roots at the desktop's copies.
- Node: the official 22 LTS binary (~45 MB arm64/x64) or a Node
  single-executable application with the bundle injected (one signed file).
  macOS: sign and notarize it with the app (hardened runtime needs
  `com.apple.security.cs.allow-jit`); Windows: sign with the same certificate
  as the other bundled binaries (zenvi-core #341).
- ffmpeg: the client should point the CLI at the desktop's bundled ffmpeg
  (`ZENVI_FFMPEG` / `ZENVI_FFPROBE` in the child's environment); the
  prototype uses whatever the CLI finds.
- Until then: `ZENVI_ENGINE_CLI` (path to a built `zenvi.mjs`) and
  `ZENVI_NODE` (default `node` on PATH) in a development checkout.

## 10. Open questions and follow-ups

- **Unsaved projects**: the desktop keeps their generated files in
  `~/.openshot_qt/{title,…}` and moves them on first save; the bridge host
  only knows `<name>_assets`. Option: an explicit `assets_dir` in the request.
- **Assistant manifest**: the backend's tool list comes from
  `export_editor_tool_manifest.py`; bridged tools should be exported there
  (with the engine's schemas) so the Assistant sees them without the MCP path.
- **Preference**: an Advanced preference next to the env var once Node ships.
- **Engine-imported media** (downloads, copies) should get the desktop's
  indexing; generated drawings should not. The answer's `files` plus the
  inserted file records are enough to decide; not wired yet.
- **Progress and cancel** for long engine tools (renders, analysis): JSON-RPC
  notifications on the same pipe.
