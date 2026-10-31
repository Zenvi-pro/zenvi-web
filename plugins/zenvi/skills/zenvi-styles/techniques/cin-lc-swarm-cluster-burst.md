---
id: cin-lc-swarm-cluster-burst
kind: technique
summary: "When the finale must prove breadth and clear the stage: ~16 cards swirl into a cluster, then blow past the camera."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-logo-sting]
tools: [add_title_tool, add_clip_to_timeline_tool, set_clip_property_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [crescendo, abundant, kinetic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, shot-slam-entrance, t061]
avoid_with: [cin-ps-silence-first-sound, cinematic-push-in]
needs: [card-swarm-radial-rig, true-motion-blur-native]
drawn: cinetic
---

# Swarm, cluster and burst reveal

cinetic `lc-swarm-cluster-burst` · Layout and composition · signature · energy high · formats launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

About twenty cards or screenshots fly in from every edge, swirl, pack into a dense overlapping cluster that slowly swells, then blow outward past the camera to uncover a hero object that was waiting behind them.

Use when: A crescendo near the end that proves breadth (many apps, templates, outputs) and clears the stage for the lockup or a hero stat; the film's single biggest motion spike.

## Build it in Zenvi

1. Hero on the bottom track, already at final size, under everything: `add_title_tool {"template": "Standard_1", "text": "<hero stat or lockup>", "position_seconds": 0, "duration_seconds": 4.4, "track": 1}` (or the product shot via `add_clip_to_timeline_tool`).
2. Place 16-20 card stills (screenshots or outputs, distinct) on tracks 2-5, all starting at the same time, each 4.0 s: `add_clip_to_timeline_tool {"file_id": "<card_i>", "position_seconds": 0.4, "duration_seconds": 4.0, "track": 2}`. Scale each card to 0.25-0.35 with `set_clip_property_tool`, larger cards on higher tracks.
3. Fly-in, per card i: `set_keyframes_tool {"timeline_clip_id": "<card_i>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0.4 + i*0.02, "value": "<ux_i * 0.57>"}, {"seconds": 1.0 + i*0.02, "value": "<slot_x_i>", "ease": "ease_out_expo"}]}`, same for `location_y`. ux/uy is the unit vector from the centre through the card's slot, 0.57 = about 1090 px at 1080p. Spread starts over 24 f (0.4 s), each card travels 28-40 f (0.47-0.67 s). Slots are a grid jittered by up to 40 px (0.02) and 6 deg (`rotation`).
4. Swirl and build: `location_x/y` rotate the slots about the centre by 24 deg decaying to 0 over 60 f (1.0 s, `ease_out_expo`), pull to 73 % spread over 32 f (0.53 s), then `scale_x/y` on every card +0.2 %/f (about +12 %/s) for 104 f (1.73 s), `interpolation: "linear"`.
5. Burst at about 3.7 s: every card travels out along its vector, 24 f (0.4 s), `ease_in_cubic`, `scale_x/y` 1.0 to 3.0, `location` to 1.5x the frame; bake a streak first with `apply_fx_tool {"clip_id": "<card_i>", "effects": [{"effect": "directional_blur", "amount": 0.7, "start": 3.7, "end": 4.1}]}`. The hero is uncovered by 4.1 s (18 f); hold it 1.5-2 s.
6. `add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 3.2}` then `{"recipe": "impact_boom", "at_seconds": 3.7, "gain_db": -6}`.

Fallback: Without the radial rig, use `add_motion_template_tool` template `card_cascade` (9 cards drop in) for the cluster and a `particle_burst` 3D scene or motion block on the burst frame; say the swirl is missing.

## Timing & taste rules

- cinetic's timing (60 fps): Fly-in 28-40 f (0.67 s), entering at 56 px/f and decaying. Swirl 60 f (1.00 s). Converge 32 f (0.53 s) (cluster width 1474 to 1076 px at 1080p). Build 104 f (1.73 s) at +0.2%/f, linear. Burst 24 f (0.40 s), peaking at 72 px/f with motion blur; the last cards clear by f24 (0.40 s), then hold the hero. Shorter scatter-only version: cards leave on ease_in_cubic over 22 f (0.37 s), with travel scaled by (1 + 0.1 * index).
- Fly-in 28-40 f (0.47-0.67 s), starts spread over 24 f (0.4 s); swirl 60 f (1.0 s); converge 32 f (0.53 s); build 104 f (1.73 s) at +0.2 %/f.
- Burst 24 f (0.4 s), cards peak near 72 px/f (0.037 of the frame width per frame); last card clears at f24; hero visible by f18.
- 16-24 cards, each overlapping its neighbours and jittered up to 40 px and 6 deg; cluster width 1474 to 1076 px at 1080p (77 % to 56 % of the frame width).
- Scatter-only version: cards leave on ease_in_cubic over 22 f (0.37 s), travel scaled by (1 + 0.1 x index).
- Nothing in the swarm is legible by design; the hero holds 1.5-2.0 s after the clear.

## Sound for it

A rising whoosh into the burst and one boom on the frame the first cards leave; no sound per card; the cluster build stays under the bed.

## Common mistakes

- Using it twice or in a calm film: it is the film's single biggest motion spike.
- Putting readable text on the cards: nothing in the swarm is read.
- Letting the lockup hold longer than 2 s after the reveal or skipping the blur on the burst.
- Avoid when: Calm or minimal films, more than once per film, or when the cards' content has to be read (nothing in the swarm is legible). If it reveals the lockup, the lockup still holds only 1.5-2.0 s.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-swarm-cluster-burst`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
