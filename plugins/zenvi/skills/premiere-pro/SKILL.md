---
name: premiere-pro
description: Edit in Adobe Premiere Pro through Zenvi Link (the mcp__zenvi__premiere_* tools) with an editor's taste - sequences, placing and trimming clips, razor cuts, transitions, motion and opacity keyframes, audio levels, Lumetri looks, titles, captions, markers, auto reframe, scene detection and exports, checking frames before saying done. Use when the user mentions Premiere or Premiere Pro, a .prproj project or a Premiere sequence, or wants to send a Zenvi edit to Premiere or bring a sequence back into Zenvi.
---

# Premiere Pro with Zenvi Link

Zenvi Link is a small extension inside Premiere Pro. It gives the `zenvi`
MCP server `premiere_*` tools that act on the project open in Premiere,
with tasteful defaults.

## Connect first

1. Call `list_hosts`. The `premiere-pro` entry says whether Premiere is
   connected, which project it has open, and which host is active.
2. Not connected: Premiere is not running, or Zenvi Link is not installed.
   Run `/zenvi:adobe-setup`, then the user restarts Premiere Pro.
3. `premiere_*` tools missing from your tool list: Zenvi Link is not
   installed on this machine yet, or the server runs with
   `ZENVI_MCP_ADOBE=off`.

## Ground truth before every change

- `premiere_get_state` (sequences, the active one, playhead, selection)
  first, and again after the user edits by hand. `premiere_get_sequence`
  lists tracks and clips (`node_id`, start/end/in/out, media, speed);
  `premiere_list_items` the project bins.
- Sequences by `sequence_id` or exact name (default: the active one); clips
  and project items by `node_id`; tracks as `{"kind": "video" | "audio",
  "index": n}`, 0-based like Premiere's own scripting (V1 and A1 are index
  0). Times are seconds, snapped to the sequence's frame grid.
- **Premiere has no undo grouping.** Every DOM change is its own undo step,
  so a tool that changes three things may take three Cmd+Z. Plan the edit
  first, change things once, and say what you changed.

## Building blocks

| Intent | Tool |
| --- | --- |
| Media in | `premiere_import_files` (into the "Zenvi Imports" bin, deduped) |
| Sequence | `premiere_create_sequence` (`preset` 1080p30, 1080p25, 1080p24, 4k30, vertical, square, or `from_clips`), `premiere_open_sequence` |
| Cut | `premiere_place_clip` (`mode` overwrite / insert, `source_in`/`source_out`), `premiere_razor`, `premiere_edit_clip` (move, trim, enable, rename, speed, delete with `ripple`) |
| Motion, opacity, volume | `premiere_set_clip_properties` (static), `premiere_animate` (keyframes with a named easing) |
| Transitions | `premiere_add_transition` (Cross Dissolve by default, 0.5 s) |
| Effects and looks | `premiere_apply_effect`, `premiere_apply_look` (`clean`, `warm-film`, `teal-orange`, `moody`, `bw-contrast`, strength 0.6) |
| Text and captions | `premiere_add_text` (`style`, `placement`), `premiere_add_captions` (an SRT) |
| Markers | `premiere_add_marker` |
| Social versions | `premiere_auto_reframe` (9:16, 1:1, 4:5), `premiere_scene_detect` |
| Look at it | `premiere_capture_frame {time}` (an image of the sequence at that time) |
| Export / save | `premiere_export` (h264-high, h264-social-vertical, prores-422; `via` media_encoder queues, direct blocks), `premiere_save_project` |
| Last resort | `premiere_run_script` (ExtendScript + QE) |

## Taste (from zenvi://taste)

Read `zenvi://taste` for the full guide. For editing in Premiere:

- **Rhythm.** Cut on action or on the beat; with music, cut on downbeats
  (bars), not every beat. Shot lengths: talking head 4-8 s, b-roll
  1.5-3 s, social hooks 0.8-1.5 s in the first 3 s. On social, open on
  motion or a face, never a fade from black. End on a 0.5-1 s hold before
  the final fade.
- **Transitions.** Cross dissolve 0.5 s inside a scene, 1.0 s for a change
  of time or place; dips to black or white (0.6-1.2 s) only for chapter
  breaks. Most cuts are straight cuts. Lead cuts with sound (J/L cuts,
  0.25-0.75 s).
- **Motion.** Entrances 0.6 s, exits 0.4 s, `smooth` easing by default,
  never linear on Motion (keyframes are Bezier with ease in/out). Ken Burns
  3-6 % over the shot with `in-out`; slow pushes 100 % to 104 % on holds.
- **Text.** Inside title-safe (10 % inset; vertical: also out of the top 12 %
  and bottom 20 %). Lower thirds left-aligned at title-safe, 4-6 s. Inter /
  SF Pro Display / Helvetica Neue / Arial; at most 32 characters a line;
  holds at least 1.5 s + 0.3 s per word; a scrim or soft shadow over busy
  footage.
- **Audio.** Dialogue peaks -12 to -6 dBFS (about -16 LUFS integrated for
  social, -23 broadcast); music 18-24 dB under dialogue, ducked 6-10 dB
  with 0.3 s attack and 0.6 s release; fades 0.25 s in, 1.5 s at the music's
  end. No clipping.
- **Colour.** Looks at 60 % strength or less; skin stays natural.

## Look before you say done

1. Capture frames with `premiere_capture_frame` at the first frame, every
   transition, the middle of each title's hold and the last frame.
2. Check each against the review checklist: title-safe and readable at
   phone size; nothing linear or abrupt; durations and holds inside the
   timing table; alignment; one focal point; audio levels and fades.
3. Fix, capture the same moments again, and report what you checked and
   any deliberate exceptions. The `edit_review` prompt (host `premiere`)
   runs the same loop.

## Between Zenvi and Premiere Pro

- **Zenvi project to Premiere:** `send_to_premiere_tool` (the Zenvi desktop
  app writes FCP7 XML and Premiere imports it as a new sequence) or
  `export_to_premiere_tool` (writes the XML for File > Import). Clips,
  trims, tracks, Basic Motion / Opacity keyframes, audio levels, cross
  dissolves and markers survive; titles arrive as PNG stills.
- **Premiere sequence to Zenvi:** `bring_from_premiere {sequence,
  placement}` exports FCP XML from Premiere and imports it into the Zenvi
  project as native, editable clips, as one Zenvi undo step.
- Both need a saved Zenvi project (`open_project_file`); the desktop app is
  opened on it when needed. `zenvi://handoff` lists what survives each way.
