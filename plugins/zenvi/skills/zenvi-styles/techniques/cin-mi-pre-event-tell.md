---
id: cin-mi-pre-event-tell
kind: technique
summary: "When a result cut needs anticipation, exactly one small thing turns just before it while everything else holds."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [anticipatory, subtle, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-mi-anticipation-dip-unlock, cin-pd-hard-swap-on-cause, cin-mi-send-ghost-handoff]
avoid_with: [cin-ui-clutter-pileup-strip, kcut-hit-fx]
needs: []
drawn: cinetic
---

# One-element tell before the event

cinetic `mi-pre-event-tell` · Micro-interaction · accent · energy calm · formats feature, walkthrough, launch, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Just before a state change or a cut, exactly one small thing moves, such as a plus glyph turning 45 degrees into an x or an object slowly turning toward its target, while everything else holds.

Use when: A repeated result cut, or a sudden 2-4 f event, needs anticipation so it reads as caused rather than random.

## Build it in Zenvi

1. Plus mode: the plus glyph is a clip: `add_title_tool {"text": "+", "screen_position": "center", "position_seconds": 0.0, "duration_seconds": 3.0}`. It rotates 0 to 45 degrees (becoming an x) so it finishes 6 f (0.1 s) before the cut at <cut>: `set_keyframes_tool {"timeline_clip_id": "<plus>", "property": "rotation", "points": [{"seconds": <cut-0.27>, "value": 0}, {"seconds": <cut-0.1>, "value": 45, "ease": "ease_in_out_sine"}]}` (starts 16 f / 0.27 s before the cut, 10 f / 0.17 s long). Repeat before every result cut so the viewer learns the tell.
2. Yaw mode (an object slowly turns toward its target): a true Y-axis turn is not available, so fake it: `scale_x` 1.0 to 0.82 (cos 35 degrees) with `shear_y` a few degrees over 40 f (0.67 s) `linear`, on the object clip. Fire the event (a 2-4 f impact or a hard state change) on the frame the yaw ends.
3. The camera tail creeps at most 0.1 % scale per frame (about 4 % over the 40 f) and nothing else changes: `set_keyframes_tool {"property": "scale_x", "points": [{"seconds": <t>, "value": 1.0}, {"seconds": <t+0.67>, "value": 1.04}]}`.
4. One element only, and no cursor. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <cut-0.1>, "gain_db": -26}` is optional.

Fallback: The yaw is faked with a horizontal squash (scale_x) and a little shear; it reads as a turn for about 35 degrees.

## Timing & taste rules

- cinetic's timing (60 fps): Plus: 10 f (0.17 s) ease_in_out_sine, finishing 6 f (0.10 s) before the cut. Yaw: 40 f (0.67 s) linear to 35 degrees, with the event on the next frame; camera creep at most 0.1% per frame.
- Plus: 10 f (0.17 s) ease_in_out_sine, finishing 6 f (0.1 s) before the cut; use it before every result cut.
- Yaw: 40 f (0.67 s) linear to 35 degrees, event on the next frame.
- Camera creep at most 0.1 % per frame.
- Only one element moves; the rest of the frame holds.

## Sound for it

Optionally one faint ui_tap at -26 dB as the tell completes; the event itself carries the sound.

## Common mistakes

- Several things already move in the frame: the tell is lost.
- Leaving the rest of the frame static for more than 48 f (0.8 s) during the yaw.
- Using the tell once only: it teaches nothing unless repeated.
- Avoid when: Several things already move in the frame (the tell gets lost), or the yaw would leave the rest of the frame static for more than 48 f.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-pre-event-tell`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
