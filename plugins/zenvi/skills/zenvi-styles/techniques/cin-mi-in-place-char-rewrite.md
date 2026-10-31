---
id: cin-mi-in-place-char-rewrite
kind: technique
summary: "When a status or secret changes, its text is overwritten left to right in the same slot, or turns to dots and deletes."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_title_tool, add_sfx_tool]
pace: medium
mood: [machine, precise, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-guide-cursor-hover-press, cin-mi-spinner-to-check, kinetic-scramble-decode]
avoid_with: [kinetic-typewriter, kinetic-letter-cascade]
needs: [per-character-overwrite]
drawn: cinetic
---

# In-place character rewrite

cinetic `mi-in-place-char-rewrite` · Micro-interaction · accent · energy medium · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small monospace status field is overwritten left to right by its new state, or a sensitive value turns to dots and deletes from the right, all inside the same fixed slot with no layout change.

Use when: The product's own status (sending, receiving, connected) or a privacy claim should change in place and read as the machine's voice.

## Build it in Zenvi

1. Overwrite (old status replaced by the new one in a fixed monospace slot): `add_motion_block_tool {"block": "text_scramble", "params": {"text": "<NEW STATUS>", "glyphs": "letters", "align": "left", "highlight": false}, "position_seconds": <press + 0.13>, "duration_seconds": 2.5}` over the old text's last frames, in the same mono face and slot, so no layout changes. About 1 character per frame (13 characters in 12 f = 0.2 s), left to right, starting 8 f (0.13 s) into the press release.
2. Optional companion icon: `set_keyframes_tool {"timeline_clip_id": "<icon>", "property": "location_y", "points": [{"seconds": <press>, "value": 0}, {"seconds": <press+0.07>, "value": -0.009, "ease": "ease_out_expo"}, {"seconds": <press+0.2>, "value": 0}]}` (10 px up over 4 f, back over 8 f).
3. Redact: on the click frame swap the value to dots in one frame, then one dot is deleted every 2 f (0.03 s): place n titles, each one dot shorter, each 2 f long: `add_title_tool {"text": "••••••••", "font": "mono", "position_seconds": <click>, "duration_seconds": 0.033}` then `"•••••••"` at <click+0.033>, and so on.
4. An anchor-camera pan over 40 f (0.67 s) on `ease_in_out_sine` (scale/location keyframes) keeps the toggle icon centred; put the click on a downbeat.
5. `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": <press>, "gain_db": -22}`.

Fallback: The block decodes from random glyphs, not from the old text; the picture is close. For a true overwrite, stack one title per frame with the new text revealed one character further each (13 short clips).

## Timing & taste rules

- cinetic's timing (60 fps): Overwrite at about 1 character per frame (13 characters in 12 f (0.20 s)), linear, starting 8 f (0.13 s) after the press peak. Redact: 1 f (0.02 s) swap, then 1 dot deleted every 2 f (0.03 s); camera pan 40 f (0.67 s) ease_in_out_expo.
- Overwrite about 1 character per frame (13 in 12 f = 0.2 s), linear, starting 8 f (0.13 s) after the press peak.
- Redact: 1 f swap to dots, then 1 dot deleted every 2 f (0.03 s); pan 40 f (0.67 s) on ease_in_out_sine.
- Monospace only, whitespace preserved, so every character keeps its column.
- The slot never changes size.

## Sound for it

A keyboard_key at -22 dB on the press frame; nothing on the characters themselves.

## Common mistakes

- The text is decorative rather than real UI status: it becomes filler.
- A proportional face: the columns jump as the characters change.
- Letting the slot reflow when the length changes.
- Avoid when: The text is decorative rather than real UI status (it becomes filler text), or the field uses a proportional face, so the columns jump.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-in-place-char-rewrite`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
