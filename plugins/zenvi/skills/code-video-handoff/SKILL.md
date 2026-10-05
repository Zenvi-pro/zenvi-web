---
name: code-video-handoff
description: Move video between code and the Zenvi editor - bring Remotion or HyperFrames compositions into a Zenvi project as linked clips that stay editable as code (change props, re-render after code edits, open the source), and export a Zenvi edit as a Remotion or HyperFrames project that comes back losslessly. Use when the user has a Remotion project or a HyperFrames (HTML) composition, wants to cut code-generated video together with footage, wants an edit "as code", or asks to update, re-render or open the code of a clip that came from code.
---

# Code video and Zenvi: Remotion, HyperFrames, linked clips

A **linked clip** is rendered media that keeps a live link to its source:
the composition, its props and its source files ("Dynamic Link, but for
code"). It plays like any clip in Zenvi; when the code or the props change,
Zenvi re-renders it with the project's own toolchain and swaps the media in
one undo step.

All of this runs in the Zenvi desktop app on a saved project: call
`open_project_file` first. The `zenvi` MCP server opens the app on the
project when a tool needs it. Renders take seconds to minutes.

## Into Zenvi

**Remotion.**
1. `list_remotion_compositions_tool {project_dir}`: ids, size, fps,
   duration, default props, source file.
2. `import_remotion_project_tool {project_dir, compositions, props, codec,
   position, track}`. `codec: "auto"` renders one still first and picks
   ProRes 4444 when any pixel is transparent (overlays), else H.264. Each
   composition lands as a linked clip.
3. A project Zenvi generated (it has `src/zenvi/timeline.json`) comes back
   as native, fully editable Zenvi clips (`restore_native`, default true).

**HyperFrames.** `import_hyperframes_project_tool {project_dir, mode}`:
`<video>`, `<img>` and `<audio>` primitives with `data-start` /
`data-duration` become native clips; compositions driven by scripts become
linked clips. `mode: "native"` imports primitives only, `"flatten"` renders
everything as one linked clip.

## Out of Zenvi

- `export_to_remotion_tool {output_dir, copy_media, install}`: a Remotion
  project with the composition `ZenviTimeline`, the timeline as
  `src/zenvi/timeline.json` (clips, keyframes with easing, titles,
  transitions) and a generic renderer. Preview with `npx remotion studio`.
- `export_to_hyperframes_tool {output_dir, copy_media}`: `index.html` with
  primitives and a GSAP timeline, plus an embedded `zenvi-timeline` JSON so
  the import restores it exactly. Preview with `npx hyperframes preview`.
- Both come back with the import tools above.

## Working with linked clips

| The user says | Do |
| --- | --- |
| "Is the intro up to date?" | `get_linked_clip_tool {clip_id}`: `fresh`, `stale` (code or props changed), `rendering`, `error` (detail says why), `missing_source` |
| "Change the title to Launch day" | `update_linked_clip_tool {clip_id, props: {"title": "Launch day"}}` (names from `editable_props`) |
| "I changed the code" / you edited it | `rerender_linked_clip_tool {clip_id}` |
| "Show me the code" / "open it in Studio" | `open_linked_source_tool {clip_id, target}` with target `code` (the file at its line in the user's editor) or `studio` |
| "Make it a normal clip" | `unlink_clip_tool {clip_id}` (keeps the rendered media) |

You are a coding agent: when the change belongs in the composition (layout,
animation, new props), edit its source files, then `rerender_linked_clip_tool`
and look at the result with `preview_frame`. Prefer props for content that
changes per video (titles, colours, numbers): it keeps the composition
reusable.

Never hand Zenvi a WebM for anything with transparency: Zenvi drops VP9
alpha. Linked renders use ProRes 4444 (alpha) or H.264.

## Taste in code (from zenvi://taste)

Write motion in the composition with the same defaults the Zenvi and Adobe
tools use:

| TASTE name | cubic-bezier | Remotion | GSAP (CustomEase) |
| --- | --- | --- | --- |
| `smooth` (default) | 0.33, 0, 0.20, 1 | `Easing.bezier(0.33, 0, 0.2, 1)` | `CustomEase.create("smooth", "0.33,0,0.2,1")` |
| `out` / entrance | 0.16, 1, 0.30, 1 | `Easing.bezier(0.16, 1, 0.3, 1)` | `"0.16,1,0.3,1"` |
| `in` / exit | 0.70, 0, 0.84, 0 | `Easing.bezier(0.7, 0, 0.84, 0)` | `"0.7,0,0.84,0"` |
| `in-out` | 0.65, 0, 0.35, 1 | `Easing.bezier(0.65, 0, 0.35, 1)` | `"0.65,0,0.35,1"` |
| `snap` | 0.20, 0, 0, 1 | `Easing.bezier(0.2, 0, 0, 1)` | `"0.2,0,0,1"` |

- Entrances 0.6 s (18 frames at 30 fps), exits 0.4 s (12 frames), big moves
  1.0 s; stagger 0.06 s per word, 0.12 s per line; text holds at least
  1.5 s + 0.3 s per word. Nothing that moves is linear; no springs with
  visible wobble unless the brand is playful (overshoot at most 6 %).
- Text inside title-safe (10 % inset; 9:16 also out of the top 12 % and the
  bottom 20 %), left edges on a 12-column grid, entrances travel 3-6 % of
  the width. Inter / SF Pro Display / Helvetica Neue / Arial; one accent
  colour (default #FF5A36 on ink #0B0B0F / paper #F7F7F5).

## Look before you say done

After an import, an export round trip or a re-render: `preview_frame` at
the first frame, each entrance end, mid-hold and the last frame (in Remotion
Studio or HyperFrames preview for the code side). Check them against the
review checklist (prompt `edit_review`), fix, look again, and report what
you checked. Read every tool's warnings to the user: anything that did not
survive a round trip is listed there. `zenvi://handoff` has the full table
of what survives each direction.
