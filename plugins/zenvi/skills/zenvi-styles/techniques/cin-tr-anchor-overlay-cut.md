---
id: cin-tr-anchor-overlay-cut
kind: technique
summary: "When one thing persists across contexts: a pill or word holds its screen spot while the world behind it hard-cuts."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [continuous, playful, clear]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cut-on-action, t082, shot-hidden-cut-masks]
avoid_with: [cin-tr-defocus-cut]
needs: []
drawn: cinetic
---

# Anchored overlay, background swap

cinetic `tr-anchor-overlay-cut` · Transition · workhorse · energy medium · formats launch, feature, walkthrough, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A foreground element (a pin, a status pill, a modal, a big word) keeps its exact screen position while the world behind it hard-cuts, so a total change of scene reads as a change of zoom or context.

Use when: Showing that one thing persists across contexts: a location going from 3D city to map, a request going from an empty void to the full app, a claim held over a run of photos.

## Build it in Zenvi

1. Backgrounds, 2-3 hard cuts in a row on track 1, each 10-22 f (0.17-0.37 s) in a montage: `add_clips_to_timeline_tool {"file_ids": ["<bgA>","<bgB>","<bgC>"], "track": 1, "start_seconds": 0, "items": [{"duration": 0.3}, {"duration": 0.3}, {"duration": 0.4}]}` (cuts on beats or 16ths).
2. The overlay is ONE clip on a higher track spanning all of them, so it cannot jump at a cut: `add_title_tool {"text": "Paris", "position_seconds": 0, "duration_seconds": 1.4, "screen_position": "center", "track": 3}` (or a pill/pin image via `add_clip_to_timeline_tool`).
3. Keep it alive with a drift or a breath: `set_keyframes_tool {"timeline_clip_id": "<overlay>", "property": "location_y", "mode": "replace", "points": [{"seconds": 0, "value": 0}, {"seconds": 1.0, "value": -0.01}]}` (0.5-1 px/f) plus `scale_x/scale_y` `[{"seconds": 0, "value": 1.0}, {"seconds": 1.0, "value": 1.04, "ease": "ease_in_out_sine"}]`.
4. After the last swap the overlay acts on the new world: `location_x/location_y` to its slot over 40 f (0.67 s) with `ease_in_out_sine` (up to 350 px of travel).
5. Keep backgrounds near 5 % mean luma under light overlays (`color_grade_clip_tool {"scope": "track", "track": 1, "exposure": -0.6}`) so the overlay never gets swallowed.

## Timing & taste rules

- cinetic's timing (60 fps): Background holds of 10-22 f (0.37 s) each in a montage (2-3 swaps), or a single swap. Overlay offset across the cut: 0 px ideally, 30 px at most. Overlay drift 0.5-1 px/f. Follow-up move 40 f (0.67 s) on ease_out_cubic. Cuts on beats or 16ths.
- Background holds 10-22 f (0.17-0.37 s) each, 2-3 swaps, cuts on beats or 16ths.
- Overlay offset across the cut 0 px ideally, 30 px at most; it keeps its own drift of 0.5-1 px/f so it is never static over 48 f (0.8 s).
- Follow-up move 40 f (0.67 s) on a smooth ease, up to 350 px.
- Backgrounds ~5 % mean luma under light overlays.
- The overlay is one clip, not one per scene.

## Sound for it

Optional soft `pop` per swap at -20 dB or none; the overlay itself is silent.

## Common mistakes

- The overlay is text that must be re-read after each swap, or busy bright backgrounds swallow it (avoid_when).
- Re-creating the overlay per scene: a 1-frame mismatch makes it jump.
- Making the overlay static for more than ~48 f (0.8 s).
- Avoid when: The overlay is text that must be reread after each swap, or the backgrounds are busy and bright enough to swallow it. Keep backgrounds near 5% mean luma under light overlays.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-anchor-overlay-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
