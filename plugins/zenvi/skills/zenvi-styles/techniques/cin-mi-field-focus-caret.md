---
id: cin-mi-field-focus-caret
kind: technique
summary: "When a shot opens on an empty field, the pointer becomes an I-beam, clicks, and the caret blinks at a human pace."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, copy_clip_keyframes_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [expectant, human, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, cin-pd-fast-prompt-true-scale, cin-mi-guide-cursor-hover-press]
avoid_with: [cin-pd-agent-status-then-answer, cin-mi-two-beat-confirm-cascade]
needs: []
drawn: cinetic
---

# Click to focus: I-beam, ring, caret

cinetic `mi-field-focus-caret` · Micro-interaction · workhorse · energy calm · formats walkthrough, feature, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An arrow cursor turns into an I-beam as it enters an empty field and clicks. The field's border sharpens, a caret appears and blinks twice at an uneven, human pace, and on the first key the placeholder vanishes and the pointer fades away.

Use when: A shot opens on an empty prompt, search or chat field and the first action is typing into it, so the click into the field becomes the cause of everything after.

## Build it in Zenvi

1. The empty field is a screenshot clip on track 1. The pointer travels on an arc over 24-36 f (0.4-0.6 s) on `ease_in_out_sine`, arriving 8-12 f (0.13-0.2 s) before the click: `add_motion_block_tool {"block": "cursor_path", "params": {"background": "<field>", "points": [[<x>, <y>]], "clicks": true}, "position_seconds": 0.0, "duration_seconds": 3.0}`.
2. When its tip enters the field's rect the arrow swaps to an I-beam in ONE frame: cut the arrow clip and start an I-beam clip (`add_title_tool {"text": "⌶", "font": "sans", "text_size": 0.03, "position_seconds": <enter>, "duration_seconds": 2.0}`) on the same location path (`copy_clip_keyframes_tool`). Use the I-beam on slow approaches only (15 px/f or less) and at least about 2.2 % of frame height.
3. On the click the field takes focus: its border goes from 1.5 px grey to 2 px ink over 5 f (0.08 s) starting 1 f before the click (an outline clip's `alpha`), no halo. On the same frame a caret appears at the start of the text: a thin title clip (`add_title_tool {"text": "|"}`); the placeholder stays.
4. Blink on a hard, uneven table: on 18 f / off 16 f / on 24 f / off 12 f (0.3 / 0.27 / 0.4 / 0.2 s), then the first key at click + 70 f (1.17 s) (or on 18, off 16 when the beat is tight) as separate caret clips; the pause should read as a person gathering a thought.
5. On the first key the placeholder disappears in one frame, typing takes over with a solid caret, and the I-beam fades over 8 f (0.13 s).
6. A slow push toward the field under the wait: `set_keyframes_tool {"property": "scale_x", "points": [{"seconds": 0.0, "value": 1.0}, {"seconds": 0.7, "value": 1.8, "ease": "ease_in_out_sine"}]}` (same for scale_y, 40-44 f). `add_sfx_tool {"recipe": "mouse_click", "at_seconds": <click>, "gain_db": -22}`; no sound on the blinks.

## Timing & taste rules

- cinetic's timing (60 fps): Arrive in 24-36 f (0.60 s) on ease_in_out_sine, 8-12 f (0.20 s) before the click; glyph swap 1 f (0.02 s); press 4 f (0.07 s) down, 8 f (0.13 s) recoil; focus border 5 f (0.08 s) ease_in_out_cubic from CLICK - 1; caret blink in hard steps of 18/16/24/12 f (70 f (1.17 s)) or 18/16 f (34 f (0.57 s)); placeholder gone in 1 f (0.02 s) on the first key; I-beam fade 8 f (0.13 s) ease_in_out_sine; push up to 1.8x over 40-44 f (0.73 s) ease_in_out_sine.
- Arrive in 24-36 f (0.4-0.6 s), 8-12 f (0.13-0.2 s) before the click; glyph swap 1 f; press 4 f (0.07 s) down, 8 f (0.13 s) recoil.
- Focus border 5 f (0.08 s) from CLICK - 1; caret table 18 / 16 / 24 / 12 f (70 f = 1.17 s) or 18 / 16 f (34 f = 0.57 s).
- I-beam fade 8 f (0.13 s); push up to 1.8x over 40-44 f (0.67-0.73 s).
- Never a metronome blink.

## Sound for it

One mouse_click at -22 dB (weight about 0.3) on the click frame; nothing on the blinks.

## Common mistakes

- The field is already focused or pre-filled, or the product acts alone with no cursor.
- Playing the full two-blink wait twice in one film: later prompts start at the first key.
- A symmetrical blink: it reads as a loader, not a person.
- Avoid when: The field is already focused or pre-filled, the product acts on its own with no cursor, or the film has already played the full two-blink wait once (later prompts start at the first key).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-field-focus-caret`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
