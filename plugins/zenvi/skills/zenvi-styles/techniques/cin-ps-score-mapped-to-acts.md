---
id: cin-ps-score-mapped-to-acts
kind: technique
summary: "When a launch needs an arranged score: sparse intro, a drop on the first product frame, a breakdown, a silent lockup."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [search_freesound_music_tool, detect_music_structure_tool, eq_tool, automate_volume_tool, snap_cuts_to_beats_tool, add_sfx_tool]
pace: medium
mood: [arranged, cinematic, confident]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [withheld-music-cold-drop, cin-ps-four-sequence-launch, cin-ps-silent-sign-off]
avoid_with: [cin-ps-silence-first-sound, cin-ps-silent-ui-steady-bed]
needs: []
drawn: cinetic
---

# Score arranged to the acts

cinetic `ps-score-mapped-to-acts` · Pacing and structure · signature · energy any · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The music's arrangement tells the story's structure: a sparse filtered intro, the drop on the first product frame, a breakdown for the calm act, a return for the proof, a final hit on the climax and the logo in silence.

Use when: 20-60 s launch films with clear acts, when the score is generated or its stems can be edited.

## Build it in Zenvi

1. Cut the picture first, then pick a track whose form fits the acts: `search_freesound_music_tool {"query": "product launch build drop breakdown", "energy_curve": "build", "licence": "cc0"}`, then `detect_music_structure_tool {"clip_id": "<music>", "add_markers": true}`.
2. Intro 120-160 f (2-2.7 s): sparse, no sub, no kick, filtered and wide: `eq_tool {"clip_ids": ["<music>"], "bands": [{"type": "lowshelf", "freq": 120, "gain_db": -18}], "preset": ""}` windowed to the intro with `automate_volume_tool {"clip_ids": ["<music>"], "shape": "ramp", "start_seconds": 0, "end_seconds": 2.5, "db": -10}`, building about 10 dB.
3. Drop on the first product shot: `snap_cuts_to_beats_tool {"clip_ids": ["<intro_shot>", "<product_shot>"], "music_clip_id": "<music>", "grid": "downbeats", "tolerance_frames": 4}`; `add_sfx_tool {"recipe": "sub_drop", "at_seconds": 2.52, "gain_db": -8}` 8-12 f (0.13-0.2 s) before the cut and `impact_thud` on the cut frame.
4. Breakdown (drums out) for the calmest act, 2-4 bars: choose the section of the track and `eq_tool` to carve the lows; a return on the next act's downbeat; a final `impact_boom` on the climax burst.
5. Lockup in silence: `automate_volume_tool {"role": "music", "shape": "fade_out", "length_ms": 600}` landing on the wordmark; `add_sfx_tool {"recipe": "tail_bloom", "gain_db": -12}`.

Fallback: Zenvi cannot rewrite a supplied track's arrangement stem by stem; choose a track whose structure already fits, snap the cuts to its sections, and filter the lows for the intro and breakdown.

## Timing & taste rules

- cinetic's timing (60 fps): Intro 120-160 f (2.67 s); the drop and its cut within 1 f (0.02 s) (or the picture leads by up to 8 f (0.13 s)); cuts within ±4 f (0.07 s) of onsets; breakdown 2-4 bars; the final hit's tail reaches -60 dB in about 35-55 f (0.92 s).
- Intro 120-160 f (2-2.7 s); the drop and its cut within 1 f (or the picture leads by up to 8 f, 0.13 s on a big drop).
- Cuts inside sections snap to onsets within +/-4 f (0.07 s); act seams fall within 4 f of a section change.
- Breakdown 2-4 bars; the final hit's tail reaches -60 dB in about 35-55 f (0.6-0.9 s).
- The intro builds about 10 dB.

## Sound for it

The score is the sound: sub 8-12 f before the cut, kick on the cut frame, a boom on the climax, silence under the lockup.

## Common mistakes

- A supplied track with a fixed structure: retime the picture to its bars instead.
- 3-6 s stings: not enough room for acts.
- A drop that lands on an empty or non-product frame.
- Avoid when: A supplied track with a fixed structure (retime the picture to its bars instead), and 3-6 s stings.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-score-mapped-to-acts`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
