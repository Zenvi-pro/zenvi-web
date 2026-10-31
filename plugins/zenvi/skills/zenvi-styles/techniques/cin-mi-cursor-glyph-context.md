---
id: cin-mi-cursor-glyph-context
kind: technique
summary: "When a pointer both types and drags, its shape follows context: I-beam on text, open hand on items, fist while dragging."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, add_emoji_tool, copy_clip_keyframes_tool, add_sfx_tool, set_keyframes_tool]
pace: medium
mood: [authentic, detailed, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-mi-drag-lift-seat, cin-mi-field-focus-caret, cin-mi-drag-select-highlight]
avoid_with: [cin-mi-velocity-stretch-dot]
needs: [cursor-glyph-set]
drawn: cinetic
---

# Cursor glyph follows context

cinetic `mi-cursor-glyph-context` · Micro-interaction · workhorse · energy any · formats walkthrough, feature, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The pointer changes shape with what it is over, as a real system pointer does: an I-beam over text, an open hand over something draggable, a closed fist while dragging, and the arrow everywhere else. Each change is a one-frame swap.

Use when: A cursor drives a walkthrough that both types and drags, and the pointer must behave like the real system's rather than an arrow stamped on everything.

## Build it in Zenvi

1. One pointer path, four glyph clips butted on separate tracks, only one visible at a time: arrow (`add_motion_block_tool {"block": "cursor_path", ...}` or a title "↖"), I-beam (`add_title_tool {"text": "⌶"}`), open hand (`add_emoji_tool {"emoji": "raised hand", "size": 0.05}`), fist (`add_emoji_tool {"emoji": "raised fist", "size": 0.05}`).
2. Give every glyph the same path: write `location_x`/`location_y` once, then `copy_clip_keyframes_tool {"source_clip_id": "<arrow>", "timeline_clip_ids": ["<ibeam>", "<hand>", "<fist>"]}`. Align each glyph so its hotspot (arrow tip; I-beam centre; hand centre) sits at the path point, so a swap never moves the point the cursor acts on.
3. Swap kinds with hard cuts, one frame, no crossfade or scale blend: I-beam while the hotspot is inside a text field or selectable text, open hand over a draggable item (6-10 f / 0.1-0.17 s after release until it leaves the item), fist from the press frame until release, arrow elsewhere.
4. The press scale is 1 - 0.12 x press (4 f / 0.07 s down, 8 f / 0.13 s recoil) on every glyph alike; the fist appears on the press frame, so closing the hand is the press. While dragging, the item rides 2 f (0.03 s) behind the fist.
5. I-beam only on slow approaches (15 px/f or less) and at least 2.2 % of frame height, because its thin stem flickers in fast motion.
6. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": <press>, "gain_db": -22}`.

Fallback: Zenvi's cursor_path block draws one arrow; swapping glyphs means separate clips sharing copied keyframes, as above.

## Timing & taste rules

- cinetic's timing (60 fps): Swap in 1 f (0.02 s) on the frame the hotspot crosses a rect edge; fist on the pressAt down stroke (4 f (0.07 s) down, 8 f (0.13 s) recoil); open hand for 6-10 f (0.17 s) after the release; item trails the fist by 1-3 f (0.05 s); I-beam approaches at 15 px/f or less.
- Swap in 1 f on the frame the hotspot crosses a rect edge; fist on the press down stroke (4 f / 0.07 s down, 8 f / 0.13 s recoil).
- Open hand for 6-10 f (0.1-0.17 s) after release; dragged item trails the fist by 1-3 f (0.02-0.05 s).
- I-beam approaches at 15 px/f or less, at least 2.2 % of frame height.
- Every glyph has the same fill, outline and shadow.

## Sound for it

One mouse_click at -22 dB on the press; the glyph swaps are silent.

## Common mistakes

- The cursor only clicks buttons: the arrow is correct there.
- A snappy vertical edit where the glyph changes flash past before they read.
- Different hotspots per glyph: a swap then shifts the point being acted on.
- Avoid when: The cursor only clicks buttons (the arrow is correct there), or a snappy vertical edit would flash the glyph changes past before they read.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-cursor-glyph-context`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
