---
id: shot-dataviz-landscape-open
kind: technique
summary: "When a film opens as a data world: dark ground, flow lines merging into a trunk, floating IDs, slow fly-through."
categories: [brand-story-corporate, saas-app-launch, product-launch-film, map-data-explainer]
tools: [add_motion_block_tool, set_keyframes_tool, add_kinetic_title_tool, add_effect_tool, add_sfx_tool]
pace: calm
mood: [moody, technical, ambitious]
aspect: ["16:9", "9:16"]
pairs_with: [shot-brand-ink-open, kinetic-title-sequence]
avoid_with: [shot-crane-rise-reveal, shot-orbit-ring-title-open]
needs: [perspective-ground-flow]
---

# Data landscape open

## What it is
A 5-8 second atmosphere opener, once per film: on a dark ground 8-14 tributaries converge on one trunk toward a vanishing point on the right third,
IDs and names sit on the lines like pins, near lines are out of focus, far ones fog out, and the camera drifts low and steady. A line of headline closes it.
"Countless workflows flow into one product."

## Build it in Zenvi
No ground-plane projection block exists (`needs: perspective-ground-flow`); layer what is there:
```json
add_motion_block_tool {"block": "gradient_field", "params": {"style": "aurora", "colors": ["#0b1020", "#1b2a55", "#3b6cf6"], "speed": 0.4, "grain": true}, "position_seconds": 0, "duration_seconds": 6.0, "placement": "full_frame"}
add_motion_block_tool {"block": "line_trails", "params": {"pattern": "lissajous", "count": 11, "tail": 0.3, "trace": true, "heads": true, "width": 2, "size": 1.3, "colors": ["#9db8ff", "#ffffff"]}, "position_seconds": 0, "duration_seconds": 6.0, "placement": "over_video"}
add_motion_block_tool {"block": "hud_callouts", "params": {"title": "", "labels": ["TASK-014", "TASK-022", "TASK-031"], "values": ["", "", ""], "grid": "none", "points": [{"x": 0.30, "y": 0.62}, {"x": 0.55, "y": 0.5}, {"x": 0.72, "y": 0.42}]}, "position_seconds": 1.5, "duration_seconds": 3.5, "placement": "over_video"}
set_keyframes_tool {"timeline_clip_id": "<line_trails_clip>", "property": "scale_x", "ease": "ease_out", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 6.0, "value": 1.12}]}
add_kinetic_title_tool {"text": "Everything, one place.", "style": "editorial", "animation": "rise", "position_seconds": 3.6, "duration_seconds": 2.4, "y": 0.3}
```
`scale_y` as `scale_x`. A soft focus on the lines nearest the camera is not available per line; blur the whole trails clip lightly with `add_effect_tool` Blur only if the labels are on a separate clip.

## Timing & taste rules
- 8-14 tributaries, never over 16 (past that it is a screensaver); ONE trunk only, a vanishing point in the right third (centred is dead).
- Tributaries merge tangent to the trunk (a right-angle junction reads as a circuit board). Trunk draws in 30-40 frames (out-cubic) with a bright tip; tributaries stagger 3-6 frames.
- Labels: 5-9 in the mid layer, grown from 1.0 to a readable minimum of 18 px equivalent; stand them far lower than the camera height or they all sit on the horizon.
- Camera: ~950 world units over 180 frames, fast at the start, easing out; add a slow sideways drift (-140 -> +110) for parallax. Hold >= 1 s for the headline.
- Pulses travel along finished lines toward the junction in the mid/far layers; with no flow the second half becomes a route map.
- Stop adding labels 15 frames before the handoff; decelerate, do not brake.
- Do not play it next to another dark glowing-line shot; put two light shots in between.

## Sound for it
A `riser_noise` or low `room_tone` bed; no tick per label; one `impact_thud` (-14) or `whoosh_long` into the next shot.

## Common mistakes
- Pure white lines at full brightness (a cobweb); layer brightness by depth, give the mid layer the lead.
- Round line caps on semi-transparent lines (beads).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/dataviz-landscape-open.md` (Apache-2.0; see ../NOTICE).
