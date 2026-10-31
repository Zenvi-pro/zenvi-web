---
id: cin-ps-silent-ui-steady-bed
kind: technique
summary: "When many events pack the frame: the interface makes no sound of its own and one steady groove carries the energy."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [spot_sound_tool, auto_sound_design_tool, delete_from_timeline_tool, snap_cuts_to_beats_tool, add_sfx_tool, eq_tool]
pace: fast
mood: [driving, clean, dense]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-hit-fx, shot-bento-light-up, t086]
avoid_with: [t086, action-per-cut-micro-demo-with-live-foley]
needs: []
drawn: cinetic
---

# Silent UI over a steady bed

cinetic `ps-silent-ui-steady-bed` · Pacing and structure · workhorse · energy high · formats loop, feature, vertical, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In dense, fast-changing sequences the interface makes no sound of its own, with no per-key or per-event effects, and a steady groove carries all the energy.

Use when: Loops, grids, speed-typed prompts, counters, and any sequence with more than 3 events per second.

## Build it in Zenvi

1. Count visible events with `spot_sound_tool {"genre": "launch"}`; where there are more than about 3 per second (multi-cell loops, speed-typed prompts, counters), do not run `auto_sound_design_tool` over that stretch and delete any per-key, per-tick sound already placed (`delete_from_timeline_tool` on the SFX clips).
2. Let the bed carry the rhythm: `snap_cuts_to_beats_tool {"music_clip_id": "<music>", "grid": "half_beats", "tolerance_frames": 3}` so cuts sit on the 8th grid where the hats already sound; low end in mono.
3. Allow at most one soft tick per word or label: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 4.2, "gain_db": -22, "brightness": 0.8, "seed": 3}` high-passed above 2-3 kHz with `eq_tool {"clip_ids": ["<tick>"], "preset": "air"}`; 18-24 dB under the bed, 40-80 ms decay, vary gain by +/-2 dB and pitch by +/-80 cents (`pitch` +/-0.8) from clip to clip.
4. Save 6-8 accent ticks per 45 s for real clicks (a press, a toggle) at -18 dB.

## Timing & taste rules

- cinetic's timing (60 fps): No per-character sounds; at most 1 tick per word; 6-8 accent ticks per 45 s; ticks 5-15 ms attack, 40-80 ms decay, 18-24 dB under the bed.
- No per-character sounds; at most 1 tick per word; 6-8 accent ticks per 45 s.
- Ticks 5-15 ms attack, 40-80 ms decay, 18-24 dB under the bed, high-passed at 2-3 kHz.
- Vary gain +/-2 dB and pitch +/-80 cents so no two ticks are identical.
- Cuts on the 8th grid, where the hats already sound.

## Sound for it

Almost none by design: one soft tick per word at most, 6-8 real clicks per 45 s.

## Common mistakes

- Sparse, calm films where each event deserves its own tuned sound.
- The payoff moment: let it have a proper hit.
- Leaving per-key typing foley on under a groove: it clutters the bed.
- Avoid when: Sparse, calm films where each event deserves its own tuned sound, and the payoff moment.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-silent-ui-steady-bed`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
