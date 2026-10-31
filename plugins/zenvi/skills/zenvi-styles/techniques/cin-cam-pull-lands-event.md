---
id: cin-cam-pull-lands-event
kind: technique
summary: "When a long pull-back ends in a payoff: the modal or caption starts as the camera decelerates and lands with its settle."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_motion_block_tool, add_kinetic_title_tool, add_sfx_tool]
pace: calm
mood: [graceful, revealing, timed]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-cam-breathing-zoom, shot-crane-rise-reveal, cinematic-push-in]
avoid_with: [cin-cam-crash-zoom-through, shot-crash-zoom-punch]
needs: []
drawn: cinetic
---

# Pull-back that lands an event

cinetic `cam-pull-lands-event` · Camera · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A long, gentle pull-back runs from a close-up to the full view, and as it decelerates the next UI event (a modal, labels, a caption) starts, so it lands together with the camera's settle.

Use when: Walkthroughs and single-take films that move pose to pose, and any long move whose ending would otherwise be a dead beat.

## Build it in Zenvi

1. The pull: `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <a>, "value": 1.78}, {"seconds": <a+1.8>, "value": 1.0, "ease": "ease_in_out_sine"}]}` (and `scale_y`), 108 f (1.8 s), the wide framing about 0.56x the close.
2. The event at 72 % of the move, f78 (1.3 s): a modal via `add_motion_block_tool {"block": "toggle_panel", "position_seconds": <a+1.3>, "duration_seconds": 3, "params": {"title": "Done", "rows": ["Backup", "Sync"]}}` scaling 0.92 to 1 with opacity over 8 f (0.13 s) (`set_keyframes_tool` `scale_x/scale_y` `[{"seconds": <a+1.3>, "value": 0.92}, {"seconds": <a+1.8>, "value": 1.0, "ease": "ease_out_back"}]`), landing within 4 f (0.07 s) of the camera's settle.
3. Captions no earlier than f81 (1.35 s) and no later than f114 (1.9 s): `add_kinetic_title_tool {"text": "Everything synced", "position_seconds": <a+1.45>, "duration_seconds": 2.2, "animation": "rise"}`; labels and values can type in through the whole pull.
4. After the settle, hand over to a breath creep: `{"seconds": <a+1.8>, "value": 1.0}, {"seconds": <a+3.0>, "value": 1.03}`.
5. `add_sfx_tool {"recipe": "toggle", "at_seconds": <a+1.75>, "gain_db": -14}`.

## Timing & taste rules

- cinetic's timing (60 fps): 108 f (1.80 s) on ease_in_out_sine, zoom x0.56, peak about 1.5%/f (about 24 px/f) mid-move. Event starts at 72% of the move; the ease_out_quart modal settles within 4 f (0.07 s) of the camera. Captions start in the last 25% of the move or up to 6 f (0.10 s) after it.
- Pull 108 f (1.8 s) on a smooth ease, zoom x0.56, peak about 1.5 %/f (~24 px/f) mid-move.
- Event starts at 72 % of the move (f78 / 1.3 s); modal settles within 4 f (0.07 s) of the camera.
- Captions start in the last 25 % of the move (>= f81 / 1.35 s) and at most 6 f after it.
- After the settle, a breath creep, not a dead lock.
- Not for the finale, where the lockup wants a clean frame.

## Sound for it

A soft `toggle` or `ui_tap` as the modal lands; the pull itself is silent.

## Common mistakes

- Short or fast moves under 50 f, or the finale, where the lockup needs a clean frame (avoid_when).
- Starting the event at the start of the pull: it then competes with the motion.
- Letting the caption start before 75 % of the move.
- Avoid when: Short or fast moves under 50 f, where an event in the tail just competes with the motion, and the finale, where the lockup needs a clean frame.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-pull-lands-event`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
