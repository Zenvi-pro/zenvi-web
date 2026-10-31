---
id: cin-oh-cursor-search-push
kind: technique
summary: "When the hook is a question: a cursor drifts to a search pill, the camera pushes in twice, the query types."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [curious, tech, provocative]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [prompt-bar-typing-hero, shot-type-and-filter, cin-cam-isolating-push]
avoid_with: [cin-oh-live-grid-cold-open, cin-oh-oversize-fly-then-small]
needs: []
drawn: cinetic
---

# Cursor into a field, two-stage push, typed provocation

cinetic `oh-cursor-search-push` · Opening hook · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A small search pill sits still on a dark stage; a text cursor drifts in, the camera pushes in twice to a macro framing, and a provocative query types into the field before any brand appears.

Use when: AI, search or command products, or any opener whose hook is a question the product answers.

## Build it in Zenvi

1. The pill and the typing: `add_motion_block_tool {"block": "prompt_bar", "position_seconds": 0, "duration_seconds": 4.5, "placement": "full_frame", "params": {"prompt": "Why is my deploy slower than yesterday?", "cursor": true, "position": "center", "palette": "ink"}}` (keep the query under ~40 characters).
2. Two-stage push on that clip: `set_keyframes_tool {"timeline_clip_id": "<bar>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 0.4, "value": 1.0}, {"seconds": 1.1, "value": 2.16, "ease": "ease_in_out_sine"}, {"seconds": 1.83, "value": 3.4, "ease": "ease_in_out_cubic"}]}`; same on `scale_y`. Push 1 f24-f66 (0.4-1.1 s), push 2 f66-f110 (1.1-1.83 s).
3. Keep the caret in frame: `location_x` from 0 to -0.35 and `location_y` to 0 over the second push (the caret sits left of centre), same eases.
4. Typing starts at about 60 % of push 2, ~f92 (1.5 s); the block's own typing speed should be ~30 characters a second.
5. Ticks only: `add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 1.55, "gain_db": -26}` at most one per word, with a few ms of jitter; mute once drums enter.

Fallback: The prompt_bar clip is a raster at project size, so 7.2x gets soft: stop push 2 near 3-3.5x, or make the project 4K for this shot. A caret-tracking camera is done by hand with location keyframes.

## Timing & taste rules

- cinetic's timing (60 fps): Camera still for 24 f (0.40 s) while the cursor flies in from frame 0 (30 f (0.50 s) on ease_out_cubic); push 1 42 f (0.70 s) (f24 (0.40 s)-66, peak 0.077 ln k per frame); push 2 44 f (0.73 s) (f66 (1.10 s)-110, peak 0.082 ln k per frame); 7.2x in total over 88 f (1.47 s); typing from about f92 (1.53 s) at 30 characters/s, each character at most 40 px wide on screen.
- Camera still for 24 f (0.4 s) while the cursor is already travelling from f0 (30 f, 0.5 s, a soft arc).
- Push 1: k 1 to 2.16 over 42 f (0.70 s) on ease_in_out_sine; push 2: 2.16 to 7.2 over 44 f (0.73 s) on a gentle ease-in-out; 7.2x total over 88 f (1.47 s).
- Typing at ~30 characters/s, each character at most 40 px wide on screen.
- Ticks 18-24 dB under the bed, at most one per word, 20 % jitter in time and gain.
- No halo around the pill.

## Sound for it

Micro keyboard ticks only (very quiet, one per word); nothing on the pushes.

## Common mistakes

- A product with no input field, or a query beyond ~40 characters that the macro framing cannot hold (avoid_when).
- A flat camera grammar later in the film: this opener promises camera work.
- Stopping the camera dead before typing: it should still be easing as the first letter lands.
- Avoid when: The product has no input field, the film's camera grammar is flat, or the query runs past about 40 characters (the macro framing cannot hold it).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-cursor-search-push`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
