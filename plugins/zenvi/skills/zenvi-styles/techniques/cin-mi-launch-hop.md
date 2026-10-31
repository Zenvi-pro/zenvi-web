---
id: cin-mi-launch-hop
kind: technique
summary: "When opening an app should motivate a scene change, an icon hops up, hangs, starts to fall and the camera leaves first."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, add_emoji_tool, set_keyframes_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [playful, familiar, transitional]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [cin-ui-genie-launch-from-icon, shot-attention-bounce, cin-pd-mark-docks-into-app]
avoid_with: [cin-ui-discard-into-bin, shot-slam-entrance]
needs: []
drawn: cinetic
---

# Launch hop that never lands

cinetic `mi-launch-hop` · Micro-interaction · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A centred app icon hops up as if launching, hangs at the top for a beat and starts to fall, and the camera leaves before it lands, so the hop motivates the scene change.

Use when: Opening the app or launching a feature should motivate the move to the next scene with a familiar OS gesture.

## Build it in Zenvi

1. The icon, centred (the real app icon image: `add_clip_to_timeline_tool` or `add_emoji_tool {"emoji": "<icon>", "size": 0.22, "position_seconds": 0.0, "duration_seconds": 0.55}`).
2. Hop: `set_keyframes_tool {"timeline_clip_id": "<icon>", "property": "location_y", "points": [{"seconds": 0.0, "value": 0}, {"seconds": 0.17, "value": -0.071, "ease": "ease_out_cubic"}, {"seconds": 0.23, "value": -0.071}, {"seconds": 0.53, "value": 0.019, "ease": "ease_in_cubic"}]}` (rise 77 px = 0.071 of height in 10 f / 0.17 s, hold 4 f / 0.07 s, fall 18 f / 0.3 s to +20 px with no squash).
3. A soft contact shadow below (a dark oval clip): `scale_x`/`scale_y` 1.0 to 0.85 and `alpha` falling as the icon rises.
4. The scene change starts on frame 14 (0.23 s), the first frame of the fall, so the landing never resolves: `apply_motion_transition_tool {"preset": "tilt", "clip1_id": "<icon_scene>", "clip2_id": "<next_scene>", "time": 0.23, "duration": 0.3, "direction": "up"}` (or `whip`, or a hard cut).
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 0.23, "gain_db": -16}`.

## Timing & taste rules

- cinetic's timing (60 fps): Rise 77 px in 10 f (0.17 s) ease_out_cubic; hold 4 f (0.07 s) at the top; fall 18 f (0.30 s) ease_in_cubic; the camera leaves from frame 14; 32 f (0.53 s) in all.
- Rise 77 px (about 7 % of height) in 10 f (0.17 s) on ease_out_cubic, hold 4 f (0.07 s), fall 18 f (0.3 s) on ease_in_cubic; 32 f (0.53 s) in all.
- The scene change begins on frame 14 (0.23 s), the first frame of the fall.
- Contact shadow 1.0 to 0.85, fading as the icon rises; no squash on the fall.
- The icon never touches down on screen.

## Sound for it

A short whoosh_short at -16 dB peaking at the scene change (0.23 s); no landing sound because there is no landing.

## Common mistakes

- The icon must come to rest in the same shot: then it needs a real landing.
- Several icons hopping in turn.
- Letting the landing resolve before the cut: the whole point is that it never lands.
- Avoid when: The icon must come to rest in the same shot (then it needs a real landing), or several icons would hop in turn.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-launch-hop`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
