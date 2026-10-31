---
id: cin-ui-progress-spine-steps
kind: technique
summary: "When a process works through steps, a line grows down a list with a dot at its head, each step ending in done."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_emoji_tool, apply_fx_tool, add_title_tool, add_motion_block_tool, add_sfx_tool, set_keyframes_tool]
pace: calm
mood: [steady, legible, progressing]
aspect: ["16:9", "9:16"]
pairs_with: [cin-pd-agent-status-then-answer, cin-ui-top-insert-push, cin-mi-spinner-to-check]
avoid_with: [kcut-hit-fx, cin-ui-clutter-pileup-strip]
needs: [path-follow-head-with-holds]
drawn: cinetic
---

# Progress spine leads the steps

cinetic `ui-progress-spine-steps` · UI choreography · workhorse · energy calm · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A thin line grows down the side of a step list with a dot at its head. Each step appears as the head reaches it, works with a spinner and a typed detail line, then flips to done, and the list scrolls to keep the head in view until the line turns a rounded corner toward the result.

Use when: An agent, build, deploy, import or onboarding process working through steps, where the point is visible progress toward one result.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same spine and rows, but the head is a flat dot: `add_emoji_tool {"emoji": "black circle", "size": 0.02}` with no `apply_fx_tool`, no bloom, no halo.
2. State by size only: scale 1.2 (12 px) while travelling, 1.0 (10 px) while waiting, via `set_keyframes_tool` on `scale_x`/`scale_y`.
3. The spine, step states, scroll follow and every timing are unchanged.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. Spine, one write-on segment per step so the line and the dot stay in step: `add_type_block_tool {"block": "write_on", "paths": ["M0 0 L0 1"], "x": 0.2, "y": <step_mid>, "width": 0.002, "stroke_width": 2, "position_seconds": <travel_start>, "duration_seconds": 0.67, "draw_seconds": 0.67}` (40 f = 0.67 s of travel per step pitch). Draw a 1.5 px hairline of the whole route first for the guide.
2. Head: `add_emoji_tool {"emoji": "black circle", "size": 0.02, "position_seconds": 0.0, "duration_seconds": 8.0}` with `location_y` keyframes moving down one pitch per step over 0.67 s on `ease_in_out_sine`, holding for each step's work time (24-60 f = 0.4-1.0 s). For a halo, `apply_fx_tool {"clip_id": "<head>", "effects": [{"effect": "bloom", "amount": 0.3}]}`.
3. Step row i appears when the head arrives: `add_title_tool {"text": "<step_i>", "position_seconds": <pass_i>, "duration_seconds": 8.0, "fade_in_seconds": 0.2}` with a 12 px (0.011) `location_y` rise over 12 f (0.2 s) `ease_out_expo`.
4. While waiting, a spinner: `add_type_block_tool {"block": "text_on_path", "text": "· · · · · · · ·", "shape": "ring", "radius": 0.012, "spin": 450, "position_seconds": <pass_i>, "duration_seconds": <work_time>}` (one turn per 48 f = 0.8 s); a detail line types at about 1.5 characters per frame via `add_motion_block_tool {"block": "text_scramble", ...}` or a typed title.
5. On the last frame of the wait the spinner clip ends and an accent check draws over 8 f (0.13 s) (`add_type_block_tool` `write_on` of a tick path); a "Done" tag fades in over 8 f; the head leaves on that frame. The list scrolls (`location_y` on every row clip) so the head sits near 40 % of height.
6. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <done_i>, "gain_db": -24}`.

Fallback: There is no head that follows a path with holds; draw the spine one segment per step and move the dot with matching location keyframes, which gives the same picture.

## Timing & taste rules

- cinetic's timing (60 fps): Head travel 40 f (0.67 s) per step (ease_out_cubic), about 10 px/f for a 120 px pitch; wait 24-60 f (1.00 s) per step, taken from the data. Row reveal 12 f (0.20 s) (ease_in_out_sine) with a 12 px rise. Spinner one turn per 48 f (0.80 s); detail line ~1.5 chars/f; check 8 f (0.13 s) (ease_out_expo); tag 8 f (0.13 s). Scroll lag 0.08 per frame plus a 2 px/f drift, peak about 12.5 px/f. Corner radius 40 px; horizontal run 10-14 px/f.
- Head travel 40 f (0.67 s) per step (about 10 px/f for a 120 px pitch); wait 24-60 f (0.4-1.0 s) per step, from the data.
- Row reveal 12 f (0.2 s) with a 12 px rise; spinner one turn per 48 f (0.8 s); detail line about 1.5 chars per frame; check 8 f (0.13 s); tag 8 f.
- Scroll follow lags (0.08 per frame) plus 2 px/f drift, peaking about 12.5 px/f; the head stays near 40 % of the frame height.
- Corner radius 40 px; the horizontal run to the result moves at a constant 10-14 px/f.

## Sound for it

A soft ui_tap at -24 dB on each step's done frame; no sound on the travel.

## Common mistakes

- Fewer than 3 steps: one status capsule says it better.
- Steps that finish too fast to read: show the result with a count instead.
- Head and line out of step: draw the line only as far as the head has travelled.
- Avoid when: There are fewer than 3 steps (one status capsule says it), or the steps finish too fast to read (show the result with a count instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ui-progress-spine-steps`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
