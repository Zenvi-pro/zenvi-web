---
id: cin-pd-blur-resolve-load
kind: technique
summary: "When a result has just been generated, it arrives soft over a flat plate and snaps crisp in a third of a second."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_effect_tool, update_effect_tool, list_effects_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [fresh, generated, soft-to-sharp]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-pd-agent-status-then-answer, cin-ui-top-insert-push, cin-ui-shell-first-build]
avoid_with: [cin-pd-hard-swap-on-cause, shot-glitch-cycle]
needs: []
drawn: cinetic
---

# Generated view resolves from soft

cinetic `pd-blur-resolve-load` · Product demo · accent · energy medium · formats launch, feature, walkthrough, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A freshly generated window or row appears as a soft, out-of-focus shape over a flat placeholder plate and snaps into crisp UI in about a third of a second.

Use when: An AI or build step produces a result and it should read as just arrived, without a spinner.

## Build it in Zenvi

1. A flat placeholder plate, one hue only (the paper colour or the accent at 12 %): `add_clip_to_timeline_tool {"file_id": "<plate>", "position_seconds": 1.0, "duration_seconds": 1.0, "track": "2"}`.
2. The finished UI on the track above it: `add_clip_to_timeline_tool {"file_id": "<ui>", "position_seconds": 1.0, "duration_seconds": 3.0, "track": "3"}`, then `add_effect_tool {"timeline_clip_id": "<ui>", "effect": "Blur"}`.
3. Focus pull over 20 f (0.33 s): `update_effect_tool {"timeline_clip_id": "<ui>", "effect": "Blur", "properties": {"horizontal_radius": [{"time": 1.0, "value": <20 px equivalent>}, {"time": 1.33, "value": 0}], "vertical_radius": [{"time": 1.0, "value": <20 px equivalent>}, {"time": 1.33, "value": 0}]}}` (check the unit with `list_effects_tool`; it must reach exactly 0).
4. On the same 20 f: `set_keyframes_tool {"timeline_clip_id": "<ui>", "property": "alpha", "points": [{"seconds": 1.0, "value": 0.6}, {"seconds": 1.33, "value": 1, "ease": "ease_out_expo"}]}` and `scale_x`/`scale_y` 1.03 to 1; fade the plate out over the same 20 f on `ease_in_out_sine`.
5. For a list, rows insert one at a time: width 60 to 100 % (`scale_x` with `origin_x` 0) and blur 6 to 0 over 12 f (0.2 s), siblings pushed down one row over 10 f (0.17 s), rows 34-40 f (0.57-0.67 s) apart; inside an unfolding card a row starts its blur only once 60 % of its height is revealed.
6. `add_sfx_tool {"recipe": "pop", "at_seconds": 1.33, "gain_db": -24}`.

## Timing & taste rules

- cinetic's timing (60 fps): Window: 20 f (0.33 s) on ease_out_expo (blur 20 → 0 px, opacity 0.6 → 1, scale 1.03 → 1), plate fade 20 f (0.33 s) on ease_in_out_sine. Rows: 12 f (0.20 s) each, push-down 10 f (0.17 s) on ease_in_out_cubic, cadence 34-40 f (0.67 s). Card stats row: 12 f (0.20 s), starting once 60% of it is revealed.
- Window resolves in 20 f (0.33 s) on ease_out_expo: blur 20 px to 0, opacity 0.6 to 1, scale 1.03 to 1.
- Placeholder plate is one hue (paper colour, or accent at 12 % opacity) and fades out over the same 20 f.
- Rows: 12 f (0.2 s) each, push-down 10 f (0.17 s), cadence 34-40 f (0.57-0.67 s).
- Blur must reach exactly 0, so the text lands fully sharp.

## Sound for it

A soft pop at -24 dB at the end of the blur, or none; never a whoosh, the move is a focus pull.

## Common mistakes

- The UI was already on screen: use a state change instead.
- More than two resolves in one sequence: it becomes a fog filter.
- Type so small that 12 f (0.2 s) of softness hurts legibility.
- Avoid when: The UI was already on screen (use a state change); more than two resolves in one sequence (it becomes a fog filter); type so small that 12 f of softness hurts legibility.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-blur-resolve-load`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
