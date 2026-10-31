---
id: cin-ps-silence-first-sound
kind: technique
summary: "When a short premium spot should breathe: mostly silence, sound only on decisive events, one low pad for the reveal."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [spot_sound_tool, add_sfx_tool, master_audio_tool]
pace: calm
mood: [premium, quiet, intentional]
aspect: ["9:16", "16:9", "1:1", "4:5"]
pairs_with: [blackout-and-dead-silence-pause, t091, cinematic-silence-before-hit]
avoid_with: [cin-ps-score-mapped-to-acts, cin-ps-silent-ui-steady-bed]
needs: []
drawn: cinetic
---

# Silence as the default bed

cinetic `ps-silence-first-sound` · Pacing and structure · signature · energy calm · formats sting, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

There is no running music: most of the film is true silence, sound appears only on decisive events, one low swell carries the single reveal act, and the audio cuts dead on the frame a key value lands.

Use when: Short stings and feature spots under about 15 s, calm or premium tones, number and unlock reveals, and films with fewer than about one decisive event per second.

## Build it in Zenvi

1. List the hit points: `spot_sound_tool {"genre": "saas_ui", "include_dry": false}`. Place no music bed; at least half the runtime stays silent in gaps of 30-96 f (0.5-1.6 s) between sound clusters.
2. Opening cluster, five ticks over 14 f from frame 0 under the opening mechanic: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.0, "gain_db": -16}` and again at 0.067, 0.133, 0.183 and 0.233 s.
3. One centred tick 1-3 f after every appearance cut: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": "<cut+0.03>", "gain_db": -20, "pan": 0}`; across a run of removals raise each tick about 2 dB (weight x1.26): -22, -20, -18, -16.
4. The only sustained sound, a low pad under the reveal act: `add_sfx_tool {"recipe": "riser_tonal", "at_seconds": "<act start>", "duration": 3.5, "gain_db": -18, "pitch": -6}` peaking on the first reveal, about 42 f (0.7 s) of plateau, 84 f (1.4 s) ring-out; let `tail_bloom` carry the ring.
5. On each resolution frame nothing is scheduled after the last tick so the sound stops within a frame; add a faint shimmer: `add_sfx_tool {"recipe": "sparkle", "at_seconds": "<land>", "gain_db": -28, "pitch": 12}` fading over about 54 f (0.9 s).
6. Repeat the opening cluster under the stinger and let the lockup's single land ring into silence; `master_audio_tool {"target_lufs": -16}`.

## Timing & taste rules

- cinetic's timing (60 fps): At least 50% of the runtime silent, in gaps of 30-96 f (1.60 s) between sound clusters. Opening cluster: 5 ticks over 14 f (0.23 s) from frame 0. Reveal pad: on from the act's first frame, swell peak on the first reveal, about 42 f (0.70 s) of plateau, about 84 f (1.40 s) of ring-out. Sound stops within 1 f (0.02 s) of each resolution; the shimmer bell (weight 0.15) fades over about 54 f (0.90 s). Removal ticks rise about 2 dB each. Lockup hold 90-120 f (2.00 s) in silence after its single land, under a push of at least 10% across the hold.
- At least 50 % of the runtime silent, in gaps of 30-96 f (0.5-1.6 s); opening cluster: 5 ticks over 14 f (0.23 s) from frame 0.
- Reveal pad: on from the act's first frame, swell peak on the first reveal, about 42 f (0.7 s) of plateau, about 84 f (1.4 s) ring-out.
- Sound stops within 1 f of each resolution; shimmer at weight 0.15 fades over about 54 f (0.9 s).
- The picture never sits still longer than 48 f (0.8 s); a lockup hold of 90-120 f (1.5-2 s) in silence under a push of at least 10 %.
- Master at -16 LUFS.

## Sound for it

The silence is the sound; a few ticks on decisive events, one pad under the reveal, one faint shimmer on each resolution.

## Common mistakes

- Launch films and walkthroughs over about 20 s: silence reads as a missing track.
- Dense sequences with more than about 3 visible events per second: use a steady bed instead.
- Briefs that supply a music track or ask for high energy.
- Avoid when: Launch films and walkthroughs over about 20 s, dense sequences with more than about 3 visible events per second (use a steady bed instead), briefs that supply a music track, or feeds where the brief asks for high energy.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-silence-first-sound`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
