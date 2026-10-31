---
id: cin-cam-z-field-flythrough
kind: technique
summary: "When breadth is the claim: dozens of screens float at different depths, the camera flies through to land on one."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_3d_scene_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [expansive, immersive, platform]
aspect: ["16:9", "9:16"]
pairs_with: [shot-station-flythrough, t012, cin-tr-velocity-handoff-cut]
avoid_with: [shot-card-flock-tumble]
needs: [exploded-view-3d]
drawn: cinetic
---

# Fly-through of a depth field

cinetic `cam-z-field-flythrough` · Camera · signature · energy high · formats launch, sting, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Dozens of flat screens or tokens float at different depths and the camera travels forward through them: near ones swell and slide off the frame edges, far ones barely drift, until the move lands square on one hero screen.

Use when: Proving breadth (a whole platform, hundreds of templates, every integration) in 3-4 s without explaining any single screen; opening into a layered world; arriving on the one screen the next act is about.

## Build it in Zenvi

1. The field: `add_3d_scene_tool {"scene": "floating_cards", "params": {"file_ids": ["<screen1>","<screen2>","<screen3>","<screen4>","<screen5>","<screen6>"], "count": 28, "motion": "fly_through", "depth_of_field": true}, "position_seconds": 0, "duration_seconds": 3.0, "quality": "final"}` (24-36 items spread x +/-2200 px, y +/-1300 px, z 800-6000 px, a 420x260 px corridor kept empty so nothing hits the lens; about 12-16 on screen at once).
2. Dive: the camera moves 4,000 px of depth over 150-180 f (2.5-3.0 s) on a long ease, landing the hero at scale 1, sharp; far items fade in over 1,200 px of depth, items rushing past the lens dissolve once they move above 50-70 px/f.
3. Drift version (ends in a cut): pull back 1,200 px on an ease-out over 40 f (0.67 s), cruise 90-120 f (1.5-2.0 s) forward at 4 px/f with the camera sinking 1.5 px/f, ramp out over the last 18-24 f (0.3-0.4 s) on an ease-in and hard-cut on the fastest frame.
4. Blur: `apply_fx_tool {"clip_id": "<scene>", "effects": [{"effect": "radial_blur", "amount": 0.4, "start": 1.5, "end": 2.5}]}`.
5. The hero's copy starts once it moves under 20 px/f: `add_kinetic_title_tool {"text": "Every integration", "position_seconds": 2.5, "duration_seconds": 2, "animation": "rise"}`. `add_sfx_tool {"recipe": "whoosh_long", "at_seconds": 0.2, "gain_db": -12}`.

Fallback: The 3D scene limits the item count and per-item turn; for a quick version stack 12-16 `floating_cards` items, or layer 3 planes of keyframed clips at 0.3 / 1.0 / 1.6 depth factors.

## Timing & taste rules

- cinetic's timing (60 fps): Dive: 150-180 f (3.00 s) on ease_in_out_sine through 4,000 px of depth (Zh = 5200, F = 1200), landing the hero at scale 1 on the long settle. Drift: pull-back 40 f (0.67 s) on ease_out_expo, cruise 90-120 f (2.00 s), exit ramp 18-24 f (0.40 s). Speed gate between 50 and 70 px/f; far fade over 1,200 px of depth; about 12-16 items on screen at once. The hero's copy starts once it moves under 20 px/f.
- Dive 150-180 f (2.5-3.0 s) on a long ease through 4,000 px of depth, landing the hero at scale 1.
- Drift: pull-back 40 f (0.67 s) ease-out, cruise 90-120 f (1.5-2.0 s), exit ramp 18-24 f (0.3-0.4 s).
- Speed gate between 50 and 70 px/f; far fade over 1,200 px of depth; about 12-16 items on screen at once.
- Items may turn slowly (up to 10 degrees a second); render with motion blur.
- The hero's copy starts once it moves under 20 px/f.

## Sound for it

A long rising whoosh across the dive and a low `sub_drop` on the hero landing.

## Common mistakes

- Items must be read in flight, fewer than ~15 items (sparse field), a flat film with no depth language, or the breadth crescendo already spent elsewhere (avoid_when).
- Items hitting the lens head-on: keep the corridor empty.
- Showing text on far items: nothing needs to be readable until the hero.
- Avoid when: Items must be read in flight, there are fewer than about 15 of them (the field looks sparse), the film is flat with no depth language, or lc-swarm-cluster-burst already spends the film's breadth crescendo.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cam-z-field-flythrough`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
