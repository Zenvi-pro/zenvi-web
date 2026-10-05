---
name: zenvi-video-editing
description: Edit videos with the Zenvi MCP tools (mcp__zenvi__*) instead of raw ffmpeg whenever the result is an edit a person may want to review or keep changing - cutting and arranging clips, trims, splits, titles, transitions, effects, fades, speed, volume and keyframes, music beds, voice-overs, then rendering. Use it when the user asks to make, cut, assemble or polish a video, a trailer, a reel, a highlight or a slideshow from their footage, to show the edit in the Zenvi app or share it, or to move an edit between Zenvi, After Effects, Premiere Pro, Remotion or HyperFrames.
---

# Editing video with Zenvi

Zenvi is a non-destructive video editor. Its MCP tools edit a project file
(`.zvn`, the Zenvi desktop app's format) on this machine and render with
ffmpeg. The project stays editable: the person can open it in the Zenvi app
or the web editor and keep going.

## Hosts: where an edit happens

The `zenvi` server drives four hosts; `list_hosts` shows which are
connected and which is active (used most recently):

- **Zenvi desktop app**: while it has the session's project open, the Zenvi
  tools run there and the person watches the edit happen (receipts say
  `"engine": "desktop"`).
- **Portable Zenvi engine**: the server itself, editing the `.zvn` file with
  ffmpeg when the desktop app does not have it open.
- **After Effects** (`ae_*` tools) and **Premiere Pro** (`premiere_*` tools)
  through the Zenvi Link extension. Call `list_hosts` first whenever the
  user mentions either app; the `after-effects` and `premiere-pro` skills
  cover them, `/zenvi:adobe-setup` installs Zenvi Link.

Unprefixed tools edit the Zenvi project; `ae_*` / `premiere_*` edit the
project open in that app. Moving an edit between them is a handoff:
`/zenvi:send-to-after-effects`, `/zenvi:send-to-premiere`,
`bring_from_after_effects`, `bring_from_premiere`, and for Remotion or
HyperFrames code the `code-video-handoff` skill.

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
   transitions at the moments that matter (the first frame, every entrance
   end, mid-hold, the last frame; pass `grid: true` for a 0-1 coordinate
   grid when placing things) against the review checklist in
   `zenvi://taste`. If something is off, fix it or `undo_tool`, and look
   again. The `edit_review` prompt runs this loop.
5. **Render.** `render_video` (mp4 by default; webm, mov, gif, mp3, wav, png
   frames). It returns the output path, duration and size.
6. **Hand off.** `launch_editor` opens the project in the Zenvi desktop app
   for the person to watch and fine-tune (later edits then go through the
   app). `push_to_cloud` uploads it and returns a zenvi.pro web editor link
   (needs `zenvi login` once).

## Taste

Omitted arguments already follow the taste guide (`zenvi://taste`, also
the `taste_motion_design` prompt). When you choose values yourself: titles
enter in 0.6 s and leave in 0.4 s with eased (never linear) motion, hold at
least 1.5 s + 0.3 s per word, sit inside title-safe (10 % inset), and use
one accent colour; cross dissolves are 0.5 s within a scene, 1.0 s for a
change of time or place; cut on action or on the downbeat; music sits
18-24 dB under dialogue and fades out over 1.5 s.

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
`zenvi open`, `zenvi push`, `zenvi hosts`, `zenvi ae <tool>`,
`zenvi premiere <tool>`, `zenvi adobe doctor`. Add `--json` for
machine-readable receipts.
