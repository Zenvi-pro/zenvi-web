# Zenvi in Claude Code, Claude Desktop, Codex and Cursor

`zenvi mcp` is a local MCP server (stdio) that gives a coding agent the
Zenvi editing tools: the same catalog as the Zenvi Assistant and the desktop
app's MCP server, running on your machine with ffmpeg. The agent edits a
`.zvn` project, looks at frames, renders, and hands the result to you in the
Zenvi desktop app or the web editor. This is the "Zenvi as a tool" side of
zenvi-core [#130](https://github.com/Zenvi-pro/zenvi-core/issues/130)
(Claude Code [#133](https://github.com/Zenvi-pro/zenvi-core/issues/133),
Codex [#134](https://github.com/Zenvi-pro/zenvi-core/issues/134),
Cursor [#135](https://github.com/Zenvi-pro/zenvi-core/issues/135)).

You need Node.js 22+ and FFmpeg (see [CLI.md](CLI.md#install)). Check with
`zenvi doctor`.

## Claude Code

**Plugin (recommended).** In Claude Code:

```text
/plugin marketplace add Zenvi-pro/zenvi-web
/plugin install zenvi@zenvi
```

The plugin ships the bundled CLI (no build, no npm install) and Zenvi Link
(the After Effects / Premiere Pro extension), starts `zenvi mcp` for you,
and adds:

- skills: `zenvi-video-editing` (when to use Zenvi rather than raw ffmpeg,
  the workflow, the hosts, verifying edits with frames, the hand-off),
  `after-effects` and `premiere-pro` (driving the Adobe apps through Zenvi
  Link with the taste guide and the frame-review loop), and
  `code-video-handoff` (Remotion and HyperFrames in and out of Zenvi,
  linked clips);
- commands: `/zenvi:edit-video <what to make>`, `/zenvi:preview [time]`,
  `/zenvi:render [file]`, `/zenvi:open-in-zenvi`, `/zenvi:share`,
  `/zenvi:send-to-after-effects`, `/zenvi:send-to-premiere`,
  `/zenvi:open-code-video-in-zenvi <folder>`, `/zenvi:adobe-setup`.

**Without the plugin.** Register the server for your user:

```bash
zenvi mcp-config claude-code --install          # runs: claude mcp add-json zenvi '{…}' --scope user
# or by hand:
claude mcp add zenvi --scope user -- node /path/to/zenvi.mjs mcp
```

For one repository only, `zenvi mcp-config claude-code --scope project
--install` writes `.mcp.json` in the current folder (Claude Code asks you to
approve it).

The Zenvi desktop app's "Connect Claude Code" button registers its own HTTP
server under the name `zenvi`. `mcp-config` will not replace that entry
unless you pass `--force`; use `--name zenvi-cli` to keep both. You rarely
need both: the stdio server forwards edits to the running app when it has
the same project open.

## Claude Desktop

```bash
zenvi mcp-config claude-desktop --install
```

This adds a `zenvi` entry to `claude_desktop_config.json`
(macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`)
and keeps your other servers and settings (the previous file is saved as
`…json.zenvi-backup`). Restart Claude Desktop. The entry uses absolute paths
to `node` and the bundle, because Claude Desktop does not see your shell's
PATH. Tell Claude which folder to work in (for example "edit the project in
~/Movies/trip"); the server's working folder is wherever Claude Desktop
starts it.

## Codex

```bash
zenvi mcp-config codex --install
# or: codex mcp add zenvi -- node /path/to/zenvi.mjs mcp
```

`--install` writes a `[mcp_servers.zenvi]` table to `~/.codex/config.toml`
(`$CODEX_HOME` respected), leaving every other table untouched, with
`tool_timeout_sec = 1800` so renders are not cut off. Start a new `codex`
session.

## Cursor

```bash
zenvi mcp-config cursor --install                 # ~/.cursor/mcp.json
zenvi mcp-config cursor --install --scope project # .cursor/mcp.json in this folder
```

Reload MCP servers in Cursor's settings. For Cursor's own skills, the
plugin's `plugins/zenvi/skills/zenvi-video-editing/SKILL.md` can be copied
into the project.

Without `--install`, `mcp-config` only prints the snippet to paste. It never
rewrites a config file it cannot parse.

## What the agent gets

The catalog for the `mcp` surface (`zenvi tools` lists it), for example
`import_files_tool`, `add_clip_to_timeline_tool`, `delete_from_timeline_tool`,
`apply_transition_tool`, `add_title_tool`, `add_effect_tool`,
`set_clip_volume_tool`, `set_keyframes_tool`, `get_timeline_state_tool`,
`undo_tool`, plus the direct editing tools (`move_clip_tool`,
`trim_clip_tool`, `split_clip_tool`, …). Tools that use the Zenvi backend
(media search, AI generation, voice-over) need `zenvi login` first; until
then they return an error saying so. Tools this surface cannot run at all
(playback and timeline-zoom controls of an editor window) are not listed.
On top of the catalog:

| Tool | What it does |
| --- | --- |
| `open_project_file` | Choose the `.zvn` to edit; creates it if missing (or saves the edits made so far there). The only `.zvn` in the working folder is opened automatically. |
| `preview_frame` | The composited frame at a time, as an image (`grid: true` adds the 0-1 coordinate grid). |
| `render_video` | Render to mp4/webm/mov/mkv/gif/mp3/wav/png; returns the path, duration and size. Reports progress. |
| `launch_editor` | Show the project in the Zenvi desktop app. |
| `push_to_cloud` | Upload to Zenvi Cloud and return a web editor link (needs `zenvi login`). |
| `list_hosts` | The hosts (see below), which are connected, which is active, and how to connect or enable the others. |
| `ae_*`, `premiere_*` | After Effects and Premiere Pro tools through Zenvi Link (listed per `ZENVI_MCP_ADOBE`). |
| handoff tools | The desktop app's `export_to_*` / `send_to_*` / `import_*` tools for After Effects, Premiere Pro, Remotion and HyperFrames, and the linked-clip tools ([HANDOFF.md](HANDOFF.md)). |
| `bring_from_after_effects`, `bring_from_premiere` | An After Effects comp as a linked clip, or a Premiere sequence as native clips, into the Zenvi project in one call. |

Resources: `zenvi://hosts` (the `list_hosts` report), `zenvi://taste` (the
motion and editing defaults, [TASTE.md](TASTE.md)) and `zenvi://handoff`
(what survives each handoff). Prompts: `taste_motion_design {brief, host}`
and `edit_review {host, focus}`, which carry the taste guide and its review
checklist with the tool names of the host the work happens in.

Every result is a contract-3 receipt: JSON text content, the same object as
`structuredContent` (with `engine`), and image content for frames. Failures
have `isError: true` and a summary starting with `Error:`. Each call is one
undo step; the project autosaves after every edit, with its undo history,
so you can open it in the desktop app at any time.

## Hosts: the desktop app, the portable engine, After Effects, Premiere Pro

The server drives four hosts and tells the agent which one is **active**
(the connected one used most recently):

| Host | What it is | Tools |
| --- | --- | --- |
| `zenvi-desktop` | the Zenvi desktop app, while it has the session's project open | the Zenvi tools (forwarded), handoff tools |
| `zenvi-portable` | the server itself, editing the `.zvn` file with ffmpeg | the Zenvi tools |
| `after-effects` | After Effects with Zenvi Link | `ae_*` |
| `premiere-pro` | Premiere Pro with Zenvi Link | `premiere_*` |

The instructions the server sends tell the agent to call `list_hosts` first
whenever the user mentions an Adobe app, to use `ae_*` / `premiere_*` for
work inside those apps and the unprefixed tools for the Zenvi project, and
to look at frames before saying an edit is done.

The Adobe families are large (the 30 After Effects tools are about 72 KB of
definitions, roughly 18k tokens; the 25 Premiere Pro tools about 43 KB,
roughly 11k tokens), so by default (`ZENVI_MCP_ADOBE=auto`) a
family is listed only when Zenvi Link can run it on this machine: the app's
discovery file exists, or Zenvi Link is installed and the app is installed.
`ZENVI_MCP_ADOBE=on` lists both, `off` neither. When a family becomes
available during a session the server sends `tools/list_changed`. Set the
variable in the server's environment, e.g. for Claude Code:
`claude mcp add zenvi --env ZENVI_MCP_ADOBE=on -- node /path/to/zenvi.mjs mcp`.
Installing and checking Zenvi Link: [ADOBE.md](ADOBE.md) (`zenvi adobe
install`, `zenvi adobe doctor`, or `/zenvi:adobe-setup` in Claude Code).

## The desktop app and the agent together

- While the Zenvi desktop app has the same project open, the server sends
  the agent's edits to the app (over the app's own MCP server) instead of
  editing the file, so you watch them happen and nothing is overwritten.
  Receipts then say `"engine": "desktop"`.
- `launch_editor` opens the project in the app (or focuses it), so a
  typical session ends with "show me": the agent calls `launch_editor` and
  you review the cut on the real timeline.
- Handoff tools always run in the desktop app. When it does not have the
  project open, the server focuses it, loads the project into it, or starts
  it on the project, waits for it to show the project, and then forwards the
  call (an untitled session is refused: `open_project_file` first).
- The server finds the app only through `~/.openshot_qt/gui_mcp.json` /
  `headless_mcp.json` whose process is alive and whose URL answers; it
  never probes other ports. Adobe apps are found the same way, through
  `~/.openshot_qt/link/aftereffects.json` / `premiere.json`.

## Troubleshooting

- **"ffmpeg was not found"**: install FFmpeg, or set `ZENVI_FFMPEG` and
  `ZENVI_FFPROBE` in the server's environment (Claude Desktop: add an `env`
  block to the entry).
- **The server does not start from a GUI app**: re-run `zenvi mcp-config …
  --install` after moving or upgrading Node or the bundle; the entry holds
  absolute paths.
- **Logs**: the server writes diagnostics to stderr (Claude Code: `claude
  --debug`; Claude Desktop: `~/Library/Logs/Claude/mcp-server-zenvi.log`).
  `ZENVI_DEBUG=1` adds stack traces.
- **Several `.zvn` files in the folder**: the server starts without a
  project; the agent picks one with `open_project_file`.
- **No `ae_*` / `premiere_*` tools**: Zenvi Link is not installed (or the
  app not found) on this machine; `zenvi adobe doctor` says which, and
  `list_hosts` how to enable the family. After installing, reconnect the
  server (`/mcp` in Claude Code) if the tools do not appear.
- **"After Effects is not connected"**: open the app with a project; Zenvi
  Link starts with it (Window > Extensions > Zenvi Link).
- `zenvi doctor` shows what is missing.
