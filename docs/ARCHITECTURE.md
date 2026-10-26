# Zenvi web platform — architecture

Status: living document. Owner: Jashan. Last revised 2026-10-04.

This repository takes Zenvi beyond the desktop app. It adds four surfaces that
share one engine, one project format and one tool catalog:

| Surface | Who uses it | Where it runs | Media lives |
| --- | --- | --- | --- |
| **Web editor** | anyone on zenvi.pro/editor | browser (React) | browser storage (OPFS), or Zenvi Cloud |
| **`zenvi` CLI** | developers, scripts, coding agents | Node 22+, local ffmpeg | local disk |
| **Local MCP server** (`zenvi mcp`) | Claude Code, Claude Desktop, Codex, Cursor | same process as the CLI; also drives the desktop app, After Effects and Premiere Pro (§4) | local disk |
| **Remote MCP server** | ChatGPT, Claude.ai connectors | Zenvi Cloud (Azure) | Zenvi Cloud |
| **Zenvi Link** (`pro.zenvi.link`) | After Effects / Premiere Pro users, and every Zenvi surface that drives those apps | a CEP extension inside each Adobe app (loopback MCP server) | the Adobe project |

Plus two that already exist and are extended, not replaced:

| Surface | Change |
| --- | --- |
| **Desktop editor** (zenvi-core, PyQt + libopenshot) | "Push to Zenvi Cloud" / "Open from Zenvi Cloud"; runs engine tools it does not implement through the bundled CLI ([ENGINE_BRIDGE.md](ENGINE_BRIDGE.md), prototype, off by default) |
| **Zenvi Assistant** (zenvi-backend agent) | can drive the web editor exactly like it drives the desktop |

```
                    ┌────────────────── Supabase Auth (users, JWT ES256/JWKS) ─────────────────┐
                    │                                                                         │
 Desktop (Python) ──┼── push / pull ──┐                                                       │
                    │                 ▼                                                       │
 Web editor ────────┼──────────► Zenvi Cloud (Node, Azure Container Apps) ◄── ChatGPT / Claude.ai
 (React, engine)    │            │  REST /v1 · remote MCP /mcp · OAuth · device login          (remote MCP)
                    │            │  render worker (engine + render-node + ffmpeg)
 zenvi CLI ─────────┼── push/pull┘            │
 (engine+ffmpeg) ◄── Claude Code / Codex      ▼
  (local MCP)       │                   Azure Storage (Blob: projects, media, renders · Tables: tokens, jobs)
                    │
 Web editor ◄───────┴── Zenvi Assistant (zenvi-backend WS /api/v1/chat/ws) ── tool_call / tool_result
```

## 1. Principles

1. **One project format.** The engine reads and writes the desktop project JSON
   (`.zvn`, OpenShot `.osp` lineage) losslessly. Unknown keys survive a round
   trip. A project can move desktop → cloud → web → CLI → desktop.
2. **One tool catalog.** Every editing capability is a tool defined once in
   `@zenvi/engine/tools` (zod input schema + handler). The web editor, the CLI,
   the local MCP server, the remote MCP server and the Zenvi Assistant bridge all
   expose that catalog. The 57 editor tools the backend agent already calls keep
   their exact names and argument names so the Assistant works unchanged.
3. **One transaction per intent.** Every tool call and every UI gesture is one
   undo step. Failed, cancelled and no-op calls leave history untouched
   (validate before mutating). Mirrors `UpdateManager` in zenvi-core.
4. **Desktop parity by construction where it matters.** Keyframe interpolation,
   clip transforms, transitions (luma masks) and effect math are ported from
   libopenshot 1.0 (see `docs/specs/libopenshot-semantics.md`) and implemented
   once, in pure TypeScript, in the engine. Renderers only move pixels.
5. **Local-first.** The web editor works signed out with media kept in the
   browser. Cloud is opt-in: sign in, then push.
6. **Pure core.** `@zenvi/engine` has no DOM and no Node imports. Platform code
   lives in `render-web` (browser) and `render-node` (Node).

## 2. Packages

```
packages/engine        @zenvi/engine       model · keyframes · history · ops · tools · frame planner · effect kernels
packages/render-web    @zenvi/render-web   Mediabunny decode · Canvas2D compositor · Web Audio · WebCodecs export
packages/render-node   @zenvi/render-node  ffmpeg probe/decode/encode · CPU compositor · resvg-wasm SVG raster
packages/scenes3d      @zenvi/scenes3d     Zenvi 3D: procedural Blender scenes (bpy) · persistent Blender worker · render cache
packages/cli           @zenvi/cli          `zenvi` binary · local MCP (stdio) · cloud client · device login
packages/cloud         @zenvi/cloud        REST /v1 · remote MCP · OAuth 2.1 AS · render jobs · Azure storage
packages/adobe-link    @zenvi/adobe-link   Zenvi Link: ae_* / premiere_* catalogs (zod) · ExtendScript tools · CEP server/panel · discovery + client
apps/editor            @zenvi/editor       React web editor, served at zenvi.pro/editor
plugins/zenvi          Claude Code plugin  bundled CLI (+ Zenvi Link) + MCP config + skills + commands
```

Internal packages export TypeScript sources (`"exports": "./src/index.ts"`);
Vite, Vitest, tsx and esbuild compile them on the fly. Deployables are bundled
(esbuild for CLI and cloud, Vite for the editor).

### 2.1 `@zenvi/engine`

```
src/model/       types.ts (Project, ProjectFile, Clip, Transition, Effect, Layer, Marker, Keyframe…)
                 defaults.ts (default project, clip, transition — same keys/values as libopenshot JSON)
                 ids.ts (10-char uppercase ids like the desktop), profiles.ts, fraction.ts
src/keyframe/    evaluate (bezier/linear/constant exactly like libopenshot), edit (add/remove/move points)
src/timeline/    time↔frame math, clip windows, queries (clips at time, per layer, gaps), snapping
src/history/     UpdateAction (insert/update/delete/load with OpenShot key paths), ProjectDocument
                 (apply, transaction, undo/redo, subscribe, serialize history slice)
src/ops/         editing operations: files, clips (add/move/trim/split/delete/speed/fade/volume),
                 effects, transitions, titles, tracks, markers, presets (fade/animate/rotate/layout)
src/effects/     effect registry: metadata + parameter schema + defaults for every libopenshot effect
src/transitions/ transition registry (mask catalog from zenvi-core `src/transitions`)
src/titles/      title templates (SVG) + text substitution
src/render/      frame planner (Project × frame → FramePlan), audio planner, effect kernels (RGBA),
                 CPU compositor (reference implementation, used by render-node)
src/fx/          Zenvi FX: footage effect catalog, ffmpeg filtergraphs, zenvi-fx links (docs/FX.md)
src/tools/       tool catalog (zod schemas + handlers + host capability interfaces)
src/io/          parse/validate/migrate project JSON, path/media resolution, export presets
```

Key contracts (see `packages/engine/src/**/types.ts` for the source of truth):

- `ProjectDocument` wraps a `Project`: `apply(action)`, `transaction(label, fn)`,
  `undo(n)`, `redo(n)`, `subscribe(fn)`, `toJSON()`.
- `planFrame(project, frame, { width, height }) → FramePlan`: bottom-to-top
  `LayerPlan[]`, each with the media source time, a 2×3 affine transform from
  source pixels to canvas pixels, opacity, evaluated effects and masks.
- `planAudio(project, range) → AudioPlan`: per clip source ranges, gain curve, speed.
- Effect kernels: `(image: RgbaImage, params, ctx) → void`, in place.
- Tools: `ToolDefinition { name, title, description, input: zod, annotations, run(ctx, input) }`.
  `ctx` carries the document plus optional host capabilities (`media`, `player`,
  `exporter`, `backend`, `ui`). A tool that needs a capability the host lacks
  returns an `Error: …` result instead of throwing.

### 2.2 Renderers

**Browser (`render-web`).** Mediabunny (WebCodecs) gives frame-accurate decoding
from a `File`/OPFS blob or a signed URL. Each `LayerPlan` is drawn with Canvas2D
(`setTransform` + `globalAlpha` + `drawImage`, GPU-backed). Clips with effects or
masks are first drawn into a scratch canvas and run through the engine's RGBA
kernels. Preview renders at the preview widget size, in a Worker on an
`OffscreenCanvas` where the browser allows (the page keeps the clock and Web
Audio; playback drops resolution while effects cannot keep up); export renders at full
size and encodes with Mediabunny (`CanvasSource` + `AudioBufferSource`, H.264/AAC
MP4 when the browser can encode it, VP9/Opus WebM otherwise). Audio preview
schedules decoded `AudioBuffer`s with Web Audio and applies the gain curve.

**Node (`render-node`).** ffmpeg decodes each active clip to raw RGBA at the size
it is drawn, the engine's CPU compositor composites the frame, and ffmpeg encodes
the result (libx264/aac by default). Audio is mixed by an ffmpeg filter graph
generated from the `AudioPlan`. SVG titles are rasterized with resvg (WASM) so the
bundle stays pure JS + WASM. The cloud render worker uses the same code.

**Loudness.** The engine owns the meter (`mastering/loudness.ts`: BS.1770-4 /
EBU R128 LUFS, true peak) and the gain-staging plan (`mastering/gain-stage.ts`);
a renderer only supplies PCM through `AudioHost.mixPcm` (render-node runs the
export's own audio graph). `master_audio_tool` turns the plan into clip volume
and Compressor makeup gain, so the desktop plays the same mix. Export-time
`ExportOptions.loudness` (render-node, cloud, `zenvi render --loudness`) is the
safety net: two-pass ffmpeg `loudnorm` plus a limiter, off unless asked for.

Both renderers execute the same `FramePlan`, so a frame looks the same in the
browser preview, a CLI render and a cloud render.

## 3. Tool catalog

Two families, one registry (`packages/engine/src/tools`):

1. **Assistant-compatible tools** — the 57 names in zenvi-backend
   `core/tools/openshot/__init__.py:FRONTEND_TOOL_NAMES`, with the argument names
   and result conventions of zenvi-core `src/classes/tool_handlers.py`. The
   backend's schemas are snapshotted in `docs/specs/backend-frontend-tools.json`.
   A result that starts with `Error` is a failure (backend convention).
2. **Direct editing tools** — precise operations the Assistant does not have but
   coding agents need: `move_clip`, `trim_clip`, `split_clip`, `set_clip_property`
   (keyframe-aware), `add_effect`, `set_effect_property`, `remove_effect`,
   `add_title`, `set_clip_speed`, `fade_clip`, `add_transition`, `render_video`,
   `preview_frame` (returns a PNG so the model can see the frame), `review_edit_tool` (one contact sheet of the whole cut plus pacing, beat and loudness numbers and a ranked problem list: the agent watches its own edit), `probe_media`,
   `list_effects`, `describe_project`.

Every mutating tool returns a receipt: `{ ok, text, data }` where `data` lists
created/changed ids, so agents can chain calls without re-reading the timeline.

The desktop contract is generated, not written: `packages/engine/scripts/gen-tool-schemas.py`
reads every tool Zenvi desktop lists at a zenvi-core develop commit (`TOOL_SCHEMAS`, the
editor tool manifest vendored in `docs/specs/desktop-editor-tools-manifest.json`, the
MCP-only extras) into `schemas.gen.ts`. Desktop tools not ported yet, and desktop
arguments a ported tool does not handle yet, are listed in `src/tools/pending.ts`: no
surface lists a pending tool and a call to one is refused like an unknown name; a
pending argument is refused, never ignored. Porting one removes its line.
`docs/TOOLS.md` ("Not ported yet") lists both.

## 4. Hosts and handoffs (`zenvi mcp`, Zenvi Link)

`zenvi mcp` drives four **hosts** (contract: the handoff SPEC §3.8):

```
                 Claude Code / Codex / Cursor (MCP client)
                                 │ stdio
                      ┌──────────▼──────────┐   reads discovery files in ~/.openshot_qt/
                      │  zenvi mcp (Node)   │   gui_mcp.json · headless_mcp.json · link/<app>.json
                      │  host registry      │   (one initialize per file, never a port scan)
                      └──┬───────┬───────┬──┘
     unprefixed tools,   │       │       │  ae_* / premiere_* (catalogs from @zenvi/adobe-link)
     project open there  │       │       │
     ┌───────────────────▼┐  ┌───▼───────▼───────────────────┐
     │ Zenvi desktop app  │  │ Zenvi Link (CEP) per app       │◄─ ExtendScript in After Effects
     │ (zenvi-core MCP)   │─►│ loopback MCP, bearer token     │◄─ ExtendScript + QE in Premiere
     │ handoff tools,     │  └────────────────────────────────┘
     │ linked clips       │──► node + Remotion / HyperFrames CLIs (renders)
     └────────────────────┘
     otherwise: the portable engine in the zenvi process edits the .zvn file
```

- **Registry** (`packages/cli/src/hosts/registry.ts`): `list_hosts` and
  `zenvi://hosts` (and `zenvi hosts`) report `zenvi-desktop`,
  `zenvi-portable`, `after-effects`, `premiere-pro`, each connected or not
  (with how to connect), and the **active** host: the connected one used
  most recently (an Adobe app's `last_active_at`, the desktop's discovery
  file or last forwarded call, the portable engine's last call).
- **Routing**: `ae_*` / `premiere_*` go to that app through one cached
  `HostClient` per app; unprefixed Zenvi tools go to the desktop app while it
  has the session's project open, else to the portable engine. The Adobe
  families are listed per `ZENVI_MCP_ADOBE` (`auto` lists a family only where
  Zenvi Link can run, because the 55 tools cost ~115 KB, roughly 29k
  tokens, of definitions).
- **Handoffs**: every conversion of the Zenvi format (After Effects `.jsx`,
  Premiere FCP7 XML, Remotion and HyperFrames projects, all imports, linked
  clips) is implemented once, in the desktop app. `zenvi mcp` lists the
  desktop's handoff tools with the desktop's schemas (vendored in
  `desktop-handoff-tools.gen.json`, regenerated from zenvi-core's editor tool
  manifest), opens the desktop on the session's project when needed and
  forwards; `bring_from_after_effects` / `bring_from_premiere` chain the
  Adobe step and the desktop import into one receipt.
- **Catalog once**: the `ae_*` / `premiere_*` definitions (names, zod
  schemas, descriptions with the defaults) live in
  `packages/adobe-link/src/catalog`; the extension validates against the
  generated JSON, the CLI lists and checks from the same definitions.
- **Taste**: `docs/TASTE.md` holds the motion and editing defaults the
  Adobe tools apply, served as `zenvi://taste`, embedded in the
  `taste_motion_design` and `edit_review` prompts and in the plugin's
  skills. Agents look at frames (`preview_frame`, `ae_capture_frame`,
  `premiere_capture_frame`) before reporting success.

Details: [ADOBE.md](ADOBE.md) (Zenvi Link), [HANDOFF.md](HANDOFF.md) (every
direction, linked clips).

## 5. Zenvi Cloud (`packages/cloud`)

Node (Hono) service on Azure Container Apps (`zenvi-rg` / `zenvi-env`), image in
`zenviregistry`. State in a dedicated Azure Storage account:

- Blob container `zenvi`:
  - `u/{userId}/p/{projectId}/project.json` — the project (revisioned by ETag)
  - `u/{userId}/p/{projectId}/meta.json` — name, timestamps, thumbnail, stats
  - `u/{userId}/media/{sha256}` — content-addressed media (dedupe across projects)
  - `u/{userId}/p/{projectId}/renders/{renderId}.mp4`
- Tables: `tokens` (hashed personal access tokens + OAuth tokens), `oauthclients`,
  `oauthcodes`, `devicecodes`, `renders`.

Auth: every request carries either a Supabase access token (website, editor,
desktop) verified against Supabase JWKS (ES256), or a Zenvi token (`zvn_…`)
issued by device login (CLI) or OAuth (connectors).

REST API (full reference in `docs/CLOUD_API.md`):

```
GET    /health
GET    /v1/me
GET    /v1/projects                 POST /v1/projects
GET    /v1/projects/:id             PUT  /v1/projects/:id (If-Match revision)   DELETE /v1/projects/:id
POST   /v1/media/check {sha256[]}  POST /v1/media {sha256,size,name,contentType} → { uploadUrl (SAS), exists }
POST   /v1/media/:sha256/complete  GET  /v1/media/:sha256/url                   (content-addressed per user, full-file SHA-256)
POST   /v1/projects/:id/renders     GET /v1/projects/:id/renders/:renderId
POST   /v1/device/code              POST /v1/device/approve   POST /v1/device/token
GET    /v1/tokens                   POST /v1/tokens           DELETE /v1/tokens/:id
POST|GET|DELETE /mcp                remote MCP (Streamable HTTP)
/.well-known/oauth-protected-resource · /.well-known/oauth-authorization-server
/oauth/register · /oauth/authorize · /oauth/token · /oauth/revoke
```

Consent and device-approval pages live in the web editor (`/editor/connect`,
`/editor/device`) because it shares the website's origin and Supabase session.

## 6. Flows

**Push from desktop.** File → *Push to Zenvi Cloud*. The desktop signs in with
its existing Supabase session, hashes each media file (it already stores
`fingerprint.sha256`), asks the cloud which hashes are missing, uploads only
those (SAS PUT, blocks for large files), uploads the project JSON, and opens
`https://zenvi.pro/editor/p/{projectId}`.

**Open in web.** The editor loads the project JSON, resolves each file's media to
a short-lived signed URL, and decodes by HTTP range requests (no full download).

**Pull to desktop / CLI.** Download project JSON + missing media into a local
folder, rewrite `path` fields to local paths, open.

**Claude Code.** `/plugin marketplace add Zenvi-pro/zenvi-web` then
`/plugin install zenvi@zenvi`. The plugin starts `zenvi mcp` (stdio) and ships
skills for video editing, After Effects, Premiere Pro and code-video
handoffs. Everything runs locally; `zenvi push` shares to the cloud.

**Adobe apps.** `zenvi adobe install` copies Zenvi Link into the CEP
extensions folder. In After Effects or Premiere Pro it serves `ae_*` /
`premiere_*` tools on a loopback port and writes its discovery file;
`zenvi mcp`, the CLI and the desktop app find it there. Edits move between
the apps through the desktop's handoff tools (§4).

**ChatGPT / Claude.ai.** Add the connector URL (`https://<cloud-host>/mcp`).
OAuth 2.1 (dynamic client registration, PKCE) signs the user in through
zenvi.pro. Tools edit cloud projects, renders run in the cloud, results come back
as links (and preview frames as images).

**Zenvi Assistant in the browser.** The editor opens the same WebSocket the
desktop uses (`wss://api.zenvi.pro/api/v1/chat/ws`), sends `user_message` with the
Supabase token, executes each `tool_call` with the engine's tool catalog, and
replies with `tool_result`.

## 7. Deployment

| Piece | Where | How |
| --- | --- | --- |
| Web editor | Azure Static Web App `zenvi-site` (`zenvi-rg`), copied into the website's deployment at zenvi.pro/editor | `.github/workflows/deploy-site.yml` on push to `main` (calls the website's `azure-deploy.yml`), or `scripts/deploy-editor.sh` |
| Zenvi Cloud | Azure Container App `zenvi-cloud` in `zenvi-env` | `scripts/azure/deploy.sh` (`az acr build` + `az containerapp update`) |
| Render workers | Azure Container Apps job `zenvi-render` in `zenvi-env`, one execution per message on queue `render-jobs` | `scripts/azure/render-jobs.sh`; deploy.sh keeps its image current |
| Storage | Azure Storage account (Blob + Tables), `zenvi-rg` | `scripts/azure/provision.sh` |
| CLI | tarball on GitHub releases / zenvi.pro; npm once the org has an npm account | `npm run build -w @zenvi/cli` |
| Claude Code plugin | this repo's `.claude-plugin/marketplace.json` | plugin bundle built into `plugins/zenvi/dist` |
| Zenvi Link | inside the CLI bundle (`dist/adobe/pro.zenvi.link`), installed by `zenvi adobe install`; a signed ZXP for distribution | `npm run build -w @zenvi/cli` / `npm run package:zxp -w @zenvi/adobe-link` |

## 8. Out of scope for the first release (tracked in `docs/ROADMAP.md`)

- OpenCV effects (stabilizer, tracker, object detection/AI masking) in the browser.
- Blender animated titles.
- Real-time multi-user collaboration (the cloud keeps last-writer-wins with
  revision checks; conflicts ask the user).
- Exact libopenshot parity for exported audio resampling.
