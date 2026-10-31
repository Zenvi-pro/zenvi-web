---
id: cin-le-living-hold
kind: technique
summary: "When any end card must sit over 1.5 seconds: the lockup keeps pushing in or exhaling so the hold reads as intentional."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [alive, poised]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-le-mark-slide-name-follow, cin-le-seed-stroke-build, cin-le-macro-pullout-breathe, t061]
avoid_with: [blackout-and-dead-silence-pause]
needs: []
drawn: cinetic
---

# Lockup keeps building through the hold

cinetic `le-living-hold` · Logo and end card · workhorse · energy calm · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Once resolved, the lockup never freezes: the card slowly pushes in (or exhales back), the tracking tightens a touch and the stage dims, so the last 1.5-2 s read as intentional rather than stalled.

Use when: Every lockup and URL hold, and any card that must sit for more than 48 f.

## Build it in Zenvi

1. Push the whole end card about the lockup's optical centre (group the lockup layers on one top track, or keyframe each piece identically): `set_keyframes_tool {"timeline_clip_id": "<lockup>", "property": "scale_x", "ease": "ease_in_out_sine", "points": [{"seconds": 5.0, "value": 1.0}, {"seconds": 6.8, "value": 1.15}]}` and the same on `scale_y` (10-20 % over 90-120 f, 1.5-2 s).
2. Tighten the name's tracking +0.03-0.06 em over 46 f (0.77 s) from its resolve: a 0.5 % `scale_x` ease on the name title, `ease_out_expo`, 0.77 s.
3. Calm exhale instead: `scale_x/y` 1.0 to 0.9 over 120 f (2 s) `ease_out_expo` while a dark plate under the lockup goes `alpha` 0 to 0.65 over 36 f (0.6 s).
4. Never fade the lockup: the last frame is the poster. Keep a tail of at least 60 f (1 s) after the last event, inside the hold.
5. A designed freeze (at most 15 f) stops everything, the push included.

## Timing & taste rules

- cinetic's timing (60 fps): Hold 90-120 f (1.5-2.0 s, never more than ~150 f (2.50 s)). Push 10-20% over the hold on ease_in_out_sine. Tracking: 46 f (0.77 s) on ease_out_expo. Exhale: 10% over 120 f (2.00 s) on ease_out_expo, with a 36 f (0.60 s) stage dim. Tail of at least 60 f (1.00 s) after the last event, inside the hold.
- Hold 90-120 f (1.5-2.0 s), never more than about 150 f (2.5 s); anything static past 48 f (0.8 s) reads as a stalled player.
- Push 10-20 % over the hold on ease_in_out_sine; tracking tightens over 46 f (0.77 s).
- Exhale: 10 % over 120 f (2 s) with a 36 f (0.6 s) stage dim to 35 %.
- Loops: ease the push back down so the hold ends at the frame-0 scale.

## Sound for it

None of its own; the music is cut on the end-card frame, one hit on the name resolve, tail decays inside the hold.

## Common mistakes

- A static end card past 48 f.
- Fading the lockup to black at the end.
- Using the push during a deliberate freeze of up to 15 f on silence.
- Avoid when: A designed freeze of at most 15 f on a silence (then stop everything, the push included). Loops whose hold must end at the frame-0 scale (ease the push back down instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-living-hold`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
