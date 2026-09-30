---
name: zenvi-video-editing
description: Edit videos with the Zenvi MCP tools (mcp__zenvi__*) instead of raw ffmpeg whenever the result is an edit a person may want to review or keep changing - cutting and arranging clips, trims, splits, titles, transitions, effects, fades, speed, volume and keyframes, music beds, voice-overs, then rendering. Use it when the user asks to make, cut, assemble or polish a video, a trailer, a reel, a highlight or a slideshow from their footage, or to show the edit in the Zenvi app or share it.
---

# Editing video with Zenvi

Zenvi is a non-destructive video editor. Its MCP tools edit a project file
(`.zvn`, the Zenvi desktop app's format) on this machine and render with
ffmpeg. The project stays editable: the person can open it in the Zenvi app
or the web editor and keep going.

## Zenvi or plain ffmpeg?

- Use Zenvi for anything that is an *edit*: several clips on a timeline,
  titles, transitions, music under dialogue, keyframed motion, anything the
  person may want to review, tweak or undo.
- Plain ffmpeg is fine for one-shot conversions of a single file (transcode,
  extract audio, make a GIF of an existing clip) where no project is needed.

## Workflow

1. **Project.** `open_project_file` with a `.zvn` path (it is created if it
   does not exist). A `.zvn` in the working folder is opened automatically.
   Edits autosave to the file with their undo history.
2. **Media.** `import_files_tool` with file paths, folders or globs
   (`paths` accepts a JSON list). `list_files_tool` shows file ids, durations
   and sizes; `get_file_info_tool` gives details of one file.
3. **Timeline.** `add_clip_to_timeline_tool` (file id, `position_seconds`,
   `track`, source `start_seconds`/`end_seconds`), then trim, split, move and
   delete clips; `apply_transition_tool` between clips; `add_title_tool` for
   text; `add_effect_tool` for looks; `set_clip_volume_tool` and
   `set_keyframes_tool` for levels and motion; `add_marker_tool` for notes.
   `get_timeline_state_tool` / `list_clips_tool` describe the timeline.
4. **Look before you claim it is done.** `preview_frame` returns the
   composited frame at a time as an image. Check positions, titles and
   transitions at the moments that matter (pass `grid: true` for a 0-1
   coordinate grid when placing things). If something is off, fix it or
   `undo_tool`.
5. **Render.** `render_video` (mp4 by default; webm, mov, gif, mp3, wav, png
   frames). It returns the output path, duration and size.
6. **Hand off.** `launch_editor` opens the project in the Zenvi desktop app
   for the person to watch and fine-tune (later edits then go through the
   app). `push_to_cloud` uploads it and returns a zenvi.pro web editor link
   (needs `zenvi login` once).

## Conventions

- Every tool returns a JSON receipt (`contract: 3`): `status` is `applied`,
  `unchanged`, `refused` or `error`; `summary` says what happened; `clips`,
  `shifted`, `removedClipIds` and `createdTracks` list what changed. Update
  your picture of the timeline from receipts instead of re-listing
  everything. Failures start with `Error:`; read the message and adjust.
- Each call is one undo step. `undo_tool` / `redo_tool` take `steps`.
- Times are seconds on the timeline (`position_seconds`), source times are
  `start_seconds` / `end_seconds` within the media. Tracks count from the
  bottom (track 1 is the lowest); higher tracks draw on top.
- Clip and file ids are 10-character codes from the receipts and listings.
- Do not edit the `.zvn` JSON by hand; use the tools so history and the
  desktop format stay consistent.

## Terminal equivalents

The same engine is available as the `zenvi` CLI (`node
${CLAUDE_PLUGIN_ROOT}/dist/zenvi.mjs`): `zenvi new`, `zenvi import`,
`zenvi add`, `zenvi split`, `zenvi frame 5 check.png`, `zenvi render`,
`zenvi open`, `zenvi push`. Add `--json` for machine-readable receipts.
