---
id: cin-tx-speed-gated-motion-blur
kind: technique
summary: "When a film has whips, flings or fast scrolls: only the fast middle of each move streaks, every hold stays sharp."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, apply_motion_transition_tool, set_keyframes_tool, apply_fx_tool]
pace: medium
mood: [physical, crisp, cinematic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [whip-transition-motion-blur-smear, shot-brake-scroll]
avoid_with: [cin-tx-on-twos-cadence]
needs: [true-motion-blur-native]
drawn: cinetic
---

# Speed-gated motion blur

cinetic `tx-speed-gated-motion-blur` · Texture and finish · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Fast whips, flings and flicked scrolls streak like a real shutter while holds and slow drifts stay pin-sharp, so the eye rests on the readable frames.

Use when: Any film with whips, flings, drops or flicked scrolls; walkthroughs that travel fast between setups and need every hold razor-sharp.

## Build it in Zenvi

1. Fast moves inside a motion block: `add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 1.0, "duration_seconds": 3, "params": {"text": "Whip *through* it", "style": "wipe"}, "motion_blur": 8}` (4-8 sub-frames is filmic; the blur only shows while a layer is moving fast, holds render pin-sharp).
2. Footage whips: `apply_motion_transition_tool {"preset": "whip", "clip1_id": "<a>", "clip2_id": "<b>", "duration": 0.27, "direction": "left", "intensity": 1}` (12-20 f = 0.2-0.33 s; the smear is built in).
3. Your own keyframed moves: shape them so the speed peaks mid-move and both ends are almost still: `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "location_x", "points": [{"seconds": 2.0, "value": 0.6}, {"seconds": 2.27, "value": 0, "ease": "ease_in_out_expo"}]}`.
4. Footage that moves fast on its own clip: bake a directional streak only over the fast window: `apply_fx_tool {"clip_id": "<clip>", "effects": [{"effect": "directional_blur", "amount": 0.6, "params": {"angle": 0}, "start": 2.05, "end": 2.22}]}`.
5. Put every hard cut on an act boundary so the blur never smears across it.

Fallback: A title or clip moved by plain keyframes gets no motion blur (only motion blocks, motion transitions and baked FX do). Stay with a block (`motion_blur` 6-8) or a whip transition for the fast move, and keep keyframed moves under about 20 px per frame so they read sharp.

## Timing & taste rules

- cinetic's timing (60 fps): Whip 12-20 f (0.33 s) on ease_in_out_expo with a 40-70 px/f peak, the shots either side at 0.3-1.5 px/f; streak length is about 2/3 of the per-frame travel (a 60 px/f card smears ~40 px); a flick is inertia(f, start, 50-70, 0.89), coasting ~8.6 x v0 px and under 0.5 px/f after its `settle` frames; nothing above 80 px/f.
- Whip 12-20 f (0.2-0.33 s, ease_in_out_expo) with a 40-70 px per frame peak; the shots either side move 0.3-1.5 px per frame.
- Streak length is about two thirds of the per-frame travel (a 60 px per frame card smears about 40 px); nothing above 80 px per frame.
- Both ends of every move sit under 2 px per frame so the streak exists only mid-move.
- A flicked scroll coasts about 8.6x its start speed in pixels and settles under 0.5 px per frame (50-70 f, 0.83-1.17 s).
- Readable text never moves above 20 px per frame.

## Sound for it

Whips and flings get a `whoosh_short` that peaks at the move's fastest frame; a drop gets an `impact_thud` on the landing. Holds are silent.

## Common mistakes

- Moves needing more than 80 px per frame: redesign as a cut on the beat, a match cut or a mask wipe.
- Readable text moving above 20 px per frame.
- Blurring a deliberately stepped (on twos) section; the two looks fight.
- Avoid when: Moves that would need more than 80 px/f (redesign as a cut on the beat, a match cut or a mask wipe); readable text moving above 20 px/f; a deliberately stepped on-twos section.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-speed-gated-motion-blur`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
