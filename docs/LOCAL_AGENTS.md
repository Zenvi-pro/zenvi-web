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

The plugin ships the bundled CLI (no build, no npm install), starts
`zenvi mcp` for you, and adds:

- the `zenvi-video-editing` skill (when to use Zenvi rather than raw
  ffmpeg, the workflow, verifying edits with frames, the hand-off);
- commands: `/zenvi:edit-video <what to make>`, `/zenvi:preview [time]`,
  `/zenvi:render [file]`, `/zenvi:open-in-zenvi`, `/zenvi:share`.

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

Every result is a contract-3 receipt: JSON text content, the same object as
`structuredContent` (with `engine`), and image content for frames. Failures
have `isError: true` and a summary starting with `Error:`. Each call is one
undo step; the project autosaves after every edit, with its undo history,
so you can open it in the desktop app at any time.

## The desktop app and the agent together

- While the Zenvi desktop app has the same project open, the server sends
  the agent's edits to the app (over the app's own MCP server) instead of
  editing the file, so you watch them happen and nothing is overwritten.
  Receipts then say `"engine": "desktop"`.
- `launch_editor` opens the project in the app (or focuses it), so a
  typical session ends with "show me": the agent calls `launch_editor` and
  you review the cut on the real timeline.
- The server finds the app only through `~/.openshot_qt/gui_mcp.json` /
  `headless_mcp.json` with a live process id; it never probes ports.

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
- `zenvi doctor` shows what is missing.
