---
id: cin-tr-band-wipe
kind: technique
summary: "When a tap must visibly cause the change: a light band sweeps a chart or card and the new state draws behind it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_transition_tool, add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [techy, responsive, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, shot-light-sweep, kinetic-counter]
avoid_with: [cin-tr-stepped-column-fill, cin-tr-cover-wipe]
needs: [keyframed-polygon-mask]
drawn: cinetic
---

# Band wipe

cinetic `tr-band-wipe` · Transition · accent · energy medium · formats feature, launch, walkthrough, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A band crosses a region (snapping up, lingering, then whipping off, or sweeping across a chart) and the content changes along its edge: the old state is erased under it and the new state draws in its wake.

Use when: Swapping a data series, a filter result or a big-type card in place, when a control's tap should visibly cause the change.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same two states and wipe as above (steps 1, 2) but the band is one flat accent bar (or ink on a paper stage) at full strength: `add_title_tool {"text": " ", "background_color": "#2a5bff", "position_seconds": <t>, "duration_seconds": 0.45, "track": 3}` scaled to a 22 % wide strip with `scale_x` 0.22.
2. The trailing side falls off by opacity of that same colour over 30-40 % of its width: stack a second narrower strip behind it at `alpha` 0.4.
3. No bloom, no screen blend, no second hue.

**Full look** (relies on glow, gradient, beige, orange: only when the person's brand supplies that look):

1. Two states as two clips on tracks 1 and 2 (old below, new above, same region), the new one revealed by a left-to-right wipe: `add_transition_tool {"track": 2, "position_seconds": <t>, "duration_seconds": 0.45, "transition": "wipe left to right"}` where `t` = the tab's click time + 2 f (0.03 s).
2. The band is a separate clip riding the wipe edge: `add_clip_to_timeline_tool {"file_id": "<band>", "position_seconds": <t>, "duration_seconds": 0.45, "track": 3}` (a soft bright vertical bar about 20-25 % of the frame wide, warm falloff), with `set_keyframes_tool {"timeline_clip_id": "<band>", "property": "location_x", "mode": "replace", "points": [{"seconds": <t>, "value": -0.62}, {"seconds": <t+0.45>, "value": 0.62}], "interpolation": "linear"}` (a constant 60-70 px/f, about 27 f for a 1400 px chart plus the band; never eased out).
3. Glow the band: `apply_fx_tool {"clip_id": "<band>", "effects": [{"effect": "bloom", "amount": 0.6}]}`; screen blend is not available, so keep the band a light core on black with `add_effect_tool` Brightness or put it over a dark chart.
4. Hang-time profile for a full-frame band behind giant type: `location_y` of the band from 0.31 to 0.16 over 6 f (0.1 s, `ease_out_expo`), 0.16 to 0.03 over 20 f (0.33 s, `linear`), then 0.03 to -0.5 over 16 f (0.27 s, `ease_in_cubic`).
5. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": <t>, "gain_db": -14}`.

Fallback: The wipe edge follows the band only approximately when the wipe is a stock luma transition; keep the two same length and shape. A band that clips the new state exactly along a moving edge needs a keyframed polygon mask.

## Timing & taste rules

- cinetic's timing (60 fps): Sweep: 368 px band at a constant 60-70 px/f (about 27 f (0.45 s) across a 1400 px chart), starting 2 f (0.03 s) after the cause. Hang-time: 6 f (0.10 s) (ease_out_expo) + 20 f (0.33 s) (constant speed) + 16 f (0.27 s) (ease_in_cubic) = 42 f (0.70 s). The new state draws in within 6-10 f (0.17 s) after the band passes.
- Sweep: a 368 px band at a constant 60-70 px/f (about 27 f / 0.45 s across a 1400 px chart), starting 2 f (0.03 s) after the cause lands.
- Hang-time: 6 f + 20 f at constant speed + 16 f = 42 f (0.7 s); edges there are flat mask edges and may pass 80 px/f.
- The new state draws in within 6-10 f (0.1-0.17 s) after the band passes.
- The line never eases out; the chart edge cuts the band off.
- Nothing textured rides on the band's edges.

## Sound for it

A soft `whoosh_medium` under the sweep, no hit; the cause (tap) has its own click 2 f earlier.

## Common mistakes

- Using it on whole scenes again and again: it becomes a preset wipe (avoid_when).
- Crossing text the viewer has not finished reading.
- Easing out: the band must keep moving until the edge cuts it off.
- Avoid when: Applied to whole scenes again and again (it becomes a preset wipe), or when the band would cross text the viewer has not finished reading.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-band-wipe`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
