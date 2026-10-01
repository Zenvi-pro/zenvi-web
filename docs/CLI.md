# `zenvi` CLI

`zenvi` edits Zenvi projects from a terminal, a script, or a coding agent.
It runs the same editing engine as the Zenvi web editor and the same tool
catalog as the Zenvi Assistant, renders with ffmpeg on your machine, and
reads and writes the desktop app's project files (`.zvn`), so a project can
go back and forth between `zenvi`, the desktop app and the web editor.

- [Install](#install)
- [Concepts](#concepts)
- [Commands](#commands)
- [Rendering](#rendering)
- [Working with the desktop app](#working-with-the-desktop-app)
- [Signing in and Zenvi Cloud](#signing-in-and-zenvi-cloud)
- [Environment variables and files](#environment-variables-and-files)

For Claude Code, Claude Desktop, Codex and Cursor setup see
[LOCAL_AGENTS.md](LOCAL_AGENTS.md).

## Install

Requirements:

- Node.js 22 or newer.
- FFmpeg (`ffmpeg` and `ffprobe`) with libx264 and AAC; VP9/Opus and LAME
  for WebM and MP3 exports. macOS: `brew install ffmpeg`. Windows:
  `winget install ffmpeg`. Debian/Ubuntu: `sudo apt install ffmpeg`.
  Set `ZENVI_FFMPEG` / `ZENVI_FFPROBE` if they are not on `PATH`.

From this repository:

```bash
npm ci
npm run build -w @zenvi/cli          # → packages/cli/dist/zenvi.mjs (+ resvg.wasm, fonts/, assets/)
node packages/cli/dist/zenvi.mjs --version
```

The bundle is one file plus its resources; keep the `dist/` folder together.
To get a `zenvi` command, link it onto your PATH, e.g.
`ln -s "$PWD/packages/cli/dist/zenvi.mjs" ~/.local/bin/zenvi`. During
development you can run the sources directly: `npm run zenvi -- <args>`.

`zenvi doctor` checks ffmpeg, fonts, the renderer, the desktop app, Zenvi
Cloud and backend reachability, and your sign-in.

## Concepts

**Project file.** A `.zvn` file in the desktop format (OpenShot `.osp`
lineage). Media paths are stored the desktop's way: relative inside the
project folder, absolute outside it, `@assets/…` inside
`<name>_assets/`. Files `zenvi` generates (titles, downloads, copies of
temporary files) go into `<name>_assets/title` and `<name>_assets/media`.

**Which project.** `-p/--project <file.zvn>`, else `$ZENVI_PROJECT`, else
the only `.zvn` in the current folder. Several candidates is an error.

**One command, one undo step.** Every edit is one tool call recorded as one
undo step. The undo history is saved in the project file (the desktop's
format, last 50 steps), so `zenvi undo` works across commands and in the
desktop app.

**Receipts.** Edits return a contract-3 receipt (the format the desktop's
tools return): `status` (`applied`, `unchanged`, `refused`, `error`),
`summary`, and what changed (`clips`, `shifted`, `removedClipIds`,
`createdTracks`, `markers`, `undoSteps`, …). `--json` prints it, plus
`engine` (`portable` or `desktop`) and `project`:

```console
$ zenvi add footage/beach.mp4 --at 2 --json
{
  "contract": 3,
  "status": "applied",
  "tool": "add_clip_to_timeline_tool",
  "summary": "Added beach.mp4 to track 1 at 2.00s",
  "clips": [{ "id": "K3J9X0Q2LM", "track": 1, "position": 2, "start": 0, "end": 1 }],
  …
  "engine": "portable",
  "project": "/Users/me/trip/trip.zvn"
}
```

**Exit codes.** `0` success (including `unchanged`), `1` the command or
tool failed, `2` usage error. Errors go to stderr (`error: …`, then a hint);
with `--json` the error is the JSON document on stdout.

**Engines.** By default (`--engine auto`) `zenvi` edits the file itself
(the *portable* engine). If the Zenvi desktop app is running with the same
project open, edits are sent to the app instead, so you see them live and
the app's next save cannot overwrite them. `--desktop` requires the app;
`--engine portable` edits the file even then (with a warning).

## Commands

Global options: `-p, --project <file>`, `--json`, `-q, --quiet`,
`--engine <auto|portable|desktop>`, `--desktop`, `-V, --version`, `-h, --help`.

Times accept seconds (`12.5`, `12.5s`, `2m`) or timecodes (`1:05.5`,
`01:02:03`). Track numbers count from the bottom (1 is the lowest track).

### Projects

| Command | What it does |
| --- | --- |
| `zenvi new [file] [--profile <p>] [-f]` | Create an empty project (default `untitled.zvn`, profile "HD 720p 30 fps"). `--profile list` prints the profiles. |
| `zenvi info` | Profile, duration, files, tracks, clips. |
| `zenvi files` | The media bin (file ids, durations, sizes). |
| `zenvi clips [-t <track>]` | Clips on the timeline. |
| `zenvi tracks` | Tracks, bottom to top. |
| `zenvi markers` | Markers. |
| `zenvi undo [steps]` / `zenvi redo [steps]` | Undo / redo edits (saved history). |
| `zenvi save [file]` | Save, or save as `file`. |

### Editing

| Command | Tool | Notes |
| --- | --- | --- |
| `zenvi import <paths…> [--index]` | `import_files_tool` | Files, folders, globs. `--index` also sends media to the Zenvi backend for AI indexing (sign-in needed). |
| `zenvi add <file> [--at t] [-t n] [--start t] [--end t \| --duration t]` | `add_clip_to_timeline_tool` | `<file>` is a file id or a path (imported first). No window flags = the whole file (`full_file`); `--duration` counts from `--start`; `--start` alone keeps the rest. The window you give is used as is (no AI re-trim). Default position: after the last clip on the track. |
| `zenvi move <clip> [--to t \| --by t] [-t n]` | `move_clip_tool` | `--by` shifts relative to the current position. |
| `zenvi trim <clip> [--start t] [--end t] [--edge left\|right --to t]` | `trim_clip_tool` | Source in/out points, or drag an edge to a timeline time. |
| `zenvi split [clip] --at t [--keep both\|left\|right]` | `split_clip_tool` | Desktop slice semantics; without a clip, cuts everything under that time. |
| `zenvi delete <clips…>` (`rm`) | `delete_from_timeline_tool` | One undo step per clip. |
| `zenvi fade <clip> [--in t] [--out t] [--video-only]` | `fade_clip_tool` | Picture and sound by default. |
| `zenvi speed <clip> <factor>` | `set_clip_speed_tool` | `2` twice as fast, `0.5` half, `-1` reversed. |
| `zenvi set <clip> <prop>=<value> [--at t]` | `set_clip_property_tool` | Any clip property (`alpha`, `scale_x`, `location_y`, `rotation`, `volume`, `gravity`, `title`…); `--at` writes a keyframe. |
| `zenvi volume <clip> <level> [--start t] [--end t]` | `set_clip_volume_tool` | `0.5`, `50%` or `-6dB`, optionally for a range. |
| `zenvi effect add <clip> <Effect>` | `add_effect_tool` | libopenshot class names: `Blur`, `Brightness`, `ChromaKey`, `Saturation`, … |
| `zenvi effect list [--audio\|--video]` | `list_effects_tool` | The effect catalog and parameters. |
| `zenvi effect rm <effect-id>` | `remove_effect_tool` | |
| `zenvi effect set <effect-id> <prop>=<value> [--at t]` | `set_effect_property_tool` | Keyframe at `--at`. |
| `zenvi transition <clip> [--to clip2] [--placement between\|start\|end] [--name fade] [--duration 1]` | `apply_transition_tool` | Between `<clip>` and `--to` (default: the next clip on its track, moved left to overlap by the duration), or a fade in/out of one clip. `zenvi call list_transitions_tool` lists names. |
| `zenvi title <text> [--template n] [--at t] [--duration t] [-t n]` | `add_title_tool` | SVG title templates. |
| `zenvi keyframe <clip> <property> <t=v…> [--clip-time]` | `set_keyframes_tool` | `volume`, `alpha`, `location_x/y`, `scale_x/y`, `rotation`; replaces the curve. Times are timeline times (`--clip-time`: seconds into the clip's source); `f120=v` addresses the clip's source frame. |
| `zenvi marker add <t> [label]` | `add_marker_tool` | (`marker rm` appears when the catalog has `remove_marker_tool`.) |
| `zenvi track add [label]` | `add_track_tool` | |

### Any tool

```bash
zenvi tools [--all] [--json] [--schema]     # the catalog (same as the MCP server's)
zenvi call <tool> key=value … [--args '{…}']
zenvi call get_timeline_state_tool
zenvi call set_keyframes_tool --args '{"timeline_clip_id":"K3J9X0Q2LM","property":"alpha","points":[{"seconds":0,"value":0},{"seconds":1,"value":1}]}'
```

Arguments arrive as strings and are coerced by each tool's schema, exactly
like the Zenvi Assistant's calls; values starting with `[` or `{` are parsed
as JSON.

### Rendering and previews

```bash
zenvi render [output] [-f mp4|webm|mov|mkv|gif|mp3|wav|png] [--quality low|medium|high|lossless]
             [--width px] [--height px] [--fps 30|30000/1001] [--start t] [--end t]
             [--video-bitrate 8M] [--audio-bitrate 192k] [--crf n] [--encoder-preset veryfast] [--open]
zenvi frame <t> [output.png|.jpg] [--width 1280] [--jpeg] [--grid]
```

`zenvi frame 5 check.png` writes the composited frame at 5 s. `--grid`
draws the same 0-1 coordinate grid and frame caption the desktop's inspect
tools show models.

### Desktop app, agents, account

| Command | What it does |
| --- | --- |
| `zenvi open [project] [--web]` | Show the project in the Zenvi desktop app (focus it, load it into the running app, or start the app); `--web` pushes and opens the web editor. |
| `zenvi mcp` | Run the local MCP server on stdio. |
| `zenvi mcp-config <claude-code\|claude-desktop\|codex\|cursor> [--install] [--scope user\|project] [--name zenvi] [--force]` | Print or install the MCP server config. |
| `zenvi login [--device] [--no-browser]` / `logout` / `whoami` | Sign in (browser handoff like the desktop, or a device code). |
| `zenvi push [--name n] [--force] [--no-open]` | Upload to Zenvi Cloud and open the web editor. |
| `zenvi pull <id\|editor URL> [dir]` | Download a cloud project and its media. |
| `zenvi cloud ls` | Your cloud projects. |
| `zenvi doctor` | Check the setup. |

## Rendering

`zenvi render` plans each frame with the engine (libopenshot 1.0
semantics), decodes the clips that are visible with one ffmpeg process per
clip (frame-accurate, at the size each clip is drawn, read ahead), composites
on the CPU, and streams the frames into one ffmpeg encoder that also mixes
the audio. Renders of 60 frames or more composite on up to 4 worker threads
(`ZENVI_RENDER_THREADS`, 0 = main thread only); frames with clip effects all
go to one worker in order, so the pixels are identical either way. Frames
with nothing on them are the background, composited once.

- Range: the whole timeline (frames 1 … the end of the last clip, like the
  desktop's export dialog), or `--start`/`--end`.
- Size and rate default to the project's.
- Formats and codecs:

  | Format | Video | Audio | Notes |
  | --- | --- | --- | --- |
  | `mp4` (default), `mov`, `mkv` | H.264 (libx264), yuv420p | AAC | `+faststart` for mp4/mov |
  | `webm` | VP9 (libvpx-vp9) | Opus | |
  | `gif` | palette-optimized GIF | — | |
  | `mp3`, `wav` | — | MP3 / PCM 16-bit | |
  | `png` | PNG frames `name_00001.png`… | — | keeps alpha |

- Quality → the desktop's preset ladders (the engine's `encoderRates`):
  H.264 CRF 30 / 23 / 20 (`low` / `medium` / `high`, the default), VP9 CRF
  for the same levels from its presets, AAC 96 / 128 / 160 kb/s;
  `lossless` is x264 `-qp 0` with 4:4:4 chroma. `--crf` sets the constant
  quality directly (0 is lossless on x264/x265/VP9); a bitrate flag replaces
  the CRF.
- Speed: `--encoder-preset` (x264/x265 preset names, VP9 maps them to
  `-cpu-used`). The default `veryfast` keeps renders quick; `medium` is what
  the desktop app encodes with (smaller files, slower).
- Colors are written as BT.709 (tagged), so players show what the preview
  showed.
- The output is written to a temporary file next to the destination and
  renamed when ffmpeg finishes; a failed or cancelled render leaves nothing
  behind (Ctrl-C stops ffmpeg).

## Working with the desktop app

`zenvi open` shows a project in the installed Zenvi app:

- If the app is running and already shows the project, it is brought to the
  front; if it shows another project, it opens this one (through the app's
  own `open_project_tool`); otherwise the app is started with the project.
- Where the app is found: macOS `Zenvi.app` (bundle id `org.zenvi.Zenvi`);
  Windows `zenvi.exe` from the installer's registry entry or
  `Program Files\Zenvi`; Linux `zenvi-desktop` on PATH, a `Zenvi*.AppImage`
  in `~/Applications`, `~/.local/bin` or `/opt`, or the `org.zenvi.Zenvi`
  desktop entry. For a development checkout set
  `ZENVI_DESKTOP_CMD="/path/to/zenvi/.venv/bin/python /path/to/zenvi/src/launch.py"`.

A running app is found through the discovery files it writes (zenvi-core
#233), `~/.openshot_qt/gui_mcp.json` (the window) and
`~/.openshot_qt/headless_mcp.json` (`launch.py --headless`; on Windows both
in `%USERPROFILE%\.openshot_qt`): exactly `{"url", "token_file", "pid",
"project", "version"}`, with the bearer token in `token_file` and `project`
null while untitled. A crashed app leaves its file behind, so `zenvi` trusts
a file only when its `pid` is alive, its URL is a loopback address, and that
URL answers one JSON-RPC `initialize` with the token; it contacts no other
address. For desktop builds without discovery files, `--desktop` (and
`zenvi doctor`) send a single `initialize` to `http://127.0.0.1:7434/mcp`
with the token in `~/.openshot_qt/mcp_token`; `zenvi` never scans ports.

Renders sent to the app (`zenvi render` while it has the project open) use
its `export_video_tool`. On macOS, when the app's export settings name
`h264_videotoolbox` (which aborts with libopenshot 1.0), `zenvi` first sets
the project's export codec to `libx264` with `set_export_setting_tool` (no
undo step).

## Signing in and Zenvi Cloud

- `zenvi login` opens `https://zenvi.pro/login?state=…` and waits for the
  website to complete the sign-in, exactly like the desktop app. The session
  (Supabase access and refresh tokens) is stored in
  `~/.config/zenvi/auth.json` (mode 0600) and refreshed automatically. It
  works for Zenvi Cloud and for the AI tools that use the Zenvi backend.
- `zenvi login --device` (SSH, servers): shows a short code to approve at
  zenvi.pro from any device and stores a Zenvi personal token
  (`zvn_pat_…`). It works for Zenvi Cloud only.
- `zenvi push` hashes each media file (SHA-256 of the whole file), uploads
  only the files Zenvi Cloud does not have yet, uploads the project with its
  history, and opens the web editor. Local folder names are not uploaded:
  media paths become file names, with a `cloud` reference per file. Later
  pushes of the same file update the same cloud project; if it was edited in
  the cloud since, `push` stops (use `zenvi pull`, or `push --force`).
- `zenvi pull <id or editor URL>` downloads the project and the media you do
  not already have into `./<name>/` (`<name>.zvn` and `<name>_assets/media/`).

## Environment variables and files

| Variable | Default | Purpose |
| --- | --- | --- |
| `ZENVI_PROJECT` | — | Project file when `-p` is not given. |
| `ZENVI_FFMPEG`, `ZENVI_FFPROBE` | PATH, then Homebrew/winget/… folders | ffmpeg binaries. |
| `ZENVI_DESKTOP_CMD` | — | Command that starts the desktop app (dev checkouts). |
| `ZENVI_CLOUD_URL` | `https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io` | Zenvi Cloud API. |
| `ZENVI_BACKEND_URL` | `https://api.zenvi.pro` | Zenvi backend (AI tools). |
| `ZENVI_WEBSITE`, `ZENVI_EDITOR_URL` | `https://zenvi.pro`, `https://zenvi.pro/editor` | Sign-in page and web editor. |
| `ZENVI_SUPABASE_URL`, `ZENVI_SUPABASE_ANON_KEY` | the Zenvi project's public values | Account service. |
| `ZENVI_CONFIG_DIR` | `~/.config/zenvi` (Windows `%APPDATA%\zenvi`) | `auth.json`, `cloud-links.json`. |
| `ZENVI_CACHE_DIR` | `~/Library/Caches/zenvi`, `%LOCALAPPDATA%\zenvi\Cache`, `~/.cache/zenvi` | Font index cache. |
| `ZENVI_NO_BROWSER=1` | — | Never open a browser (print links instead). |
| `ZENVI_MCP_ENGINE=portable` | — | The MCP server never forwards to the desktop app. |
| `ZENVI_MCP_COMMAND` | — | Command `mcp-config` writes instead of `node <bundle> mcp`. |
| `ZENVI_DEBUG=1` | — | Stack traces and host logs on stderr. |
| `ZENVI_RESOURCES_DIR`, `ZENVI_ASSETS_DIR` | next to the bundle | Where `resvg.wasm`, `fonts/` and engine assets are. |
| `ZENVI_RENDER_THREADS` | up to 4 (cores − 1) for renders of 60+ frames | Compositor worker threads; `0` composites on the main thread. |

Titles are rasterized with resvg. Fonts come from the system font folders;
a title asking for a font that is not installed (the desktop's templates use
DejaVu Sans) gets a close substitute, and the bundled Lato (SIL OFL) is the
last resort.
