---
id: cin-mi-drag-select-highlight
kind: technique
summary: "When the product acts on a picked passage, an I-beam drags across it and a highlight grows glyph by glyph."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool, add_clip_to_timeline_tool]
pace: calm
mood: [deliberate, human, product]
aspect: ["16:9", "1:1"]
pairs_with: [cin-mi-cursor-glyph-context, cin-mi-field-focus-caret, cin-pd-ghost-suggestion-accept]
avoid_with: [kinetic-beat-strobe, cin-ui-clutter-pileup-strip]
needs: []
drawn: cinetic
---

# Drag-select snaps glyph by glyph

cinetic `mi-drag-select-highlight` · Micro-interaction · accent · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An I-beam presses at the start of a phrase and drags across it, a tinted highlight grows behind the text one whole character at a time, and on release a small action bar grows out of the selection, ready for the product to act on it.

Use when: The product acts on a piece of text the user picks (rewrite, translate, comment, format, ask about a passage), and the pick should read as a human choice rather than a preset.

## Build it in Zenvi

1. The text line is a title or screenshot clip on track 2; the highlight is a clip on track 1 BEHIND it (field, highlight, text, cursor): `add_title_tool {"text": " ", "background_color": "<22 % accent tint>", "fit_text": false, "position_seconds": 0.0, "duration_seconds": 4.0, "track": "1"}` with `corner_radius` 3 px, set to the selection start with `origin_x` 0.
2. Grow it one whole glyph at a time, never tweened: `set_keyframes_tool {"timeline_clip_id": "<highlight>", "property": "scale_x", "interpolation": "constant", "points": [{"seconds": <DOWN+0.03>, "value": <w_1>}, {"seconds": <DOWN+0.07>, "value": <w_2>}, "..."]}` with one step per glyph, about 2 f (0.03 s) per glyph (24-40 f = 0.4-0.67 s for the phrase), and widths measured from the real text.
3. The I-beam (`add_title_tool {"text": "⌶"}`) presses at the start of the phrase and drags with `location_x` over D = max(24 f, 2 x glyph count) frames on `ease_in_out_sine`, at 12 px/f or less; text stays ink.
4. Release 6 f (0.1 s) after the last step. 4 f (0.07 s) later an action bar grows 12 px above the line from the selection's top centre: `scale_x`/`scale_y` 0.05 to 1 over 10 f (0.17 s) on `ease_out_expo` with `origin_x` 0.5, `origin_y` 1.0 (alpha in over the first 4 f / 0.07 s).
5. Follow-up: remove the range in one frame (highlight and text together) and type the replacement from the selection start with `add_motion_block_tool {"block": "prompt_bar", ...}`, or restyle in place. A whole word is a double click: two presses 8 f (0.13 s) apart select it on the second press.
6. Hold at least 36 f (0.6 s) before the edit. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": <DOWN>, "gain_db": -22}`.

## Timing & taste rules

- cinetic's timing (60 fps): Drag about 2 f (0.03 s) per glyph (24-40 f (0.67 s)) on ease_in_out_sine, cursor at 12 px/f or less; highlight steps per glyph on whole frames; release 6 f (0.10 s) after the last step; action bar 10 f (0.17 s) ease_out_expo from +4 f (0.07 s); hold at least 36 f (0.60 s) before the edit; replacement typed over about 26 f (0.43 s); double-click presses 8 f (0.13 s) apart.
- Drag about 2 f (0.03 s) per glyph (24-40 f = 0.4-0.67 s) on ease_in_out_sine, cursor at 12 px/f or less; highlight steps on whole frames.
- Release 6 f (0.1 s) after the last step; action bar 10 f (0.17 s) on ease_out_expo from +4 f (0.07 s).
- Hold at least 36 f (0.6 s) before the edit; replacement typed over about 26 f (0.43 s).
- Highlight is a pale accent tint (about 22 %) with ink text; use solid accent and white text only when the accent means chosen.

## Sound for it

A mouse_click at -22 dB on the press; the highlight stepping stays silent, and the action bar gets a faint pop at -26 dB.

## Common mistakes

- Text under about 40 px tall at the framing: push in first.
- A range spanning more than two lines.
- A smooth, tweened highlight: the glyph-by-glyph snap is what makes it read as a real selection.
- Avoid when: The text is under about 40 px tall at the shot's framing (push in first), the range spans more than two lines, or the cursor never touches text anywhere else in the film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-drag-select-highlight`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
