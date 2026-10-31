---
id: cin-oh-quiet-intro-drop
kind: technique
summary: "When type opens the film: a sparse, quiet first 2 s, then kick and sub land on the first hard cut."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [detect_beats_tool, automate_volume_tool, eq_tool, add_sfx_tool, add_kinetic_title_tool]
pace: medium
mood: [tense, releasing, clean]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cinematic-silence-before-hit, withheld-music-cold-drop, kinetic-keyword-slam]
avoid_with: [cin-oh-live-grid-cold-open, cin-oh-macro-scramble-snap-out]
needs: []
drawn: cinetic
---

# Sparse intro, drop on the first hard cut

cinetic `oh-quiet-intro-drop` · Opening hook · workhorse · energy any · formats launch, feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

(Sound and picture.) The first ~2 s carry only light plucks or a filtered, wide pad under the opening type; the low end and the kick land exactly on the frame where the punchline card or first product shot cuts in.

Use when: Almost any film that opens on type and then shows the product with a tension-and-release shape.

## Build it in Zenvi

1. Find the downbeat for the first hard cut: `detect_beats_tool {"file_id": "<music>"}`; place the picture cut (first product shot or punchline card) on that downbeat, e.g. 2.0 s at 120 BPM (frame 120).
2. Keep the intro ~14 dB under the body and jump to full on the cut: `automate_volume_tool {"clip_ids": ["<music>"], "shape": "dip", "start_seconds": 0, "end_seconds": 1.98, "db": -14, "fade_ms": 20}`. Pick a track whose first bar has no kick and sub (or start the file at a sparse bar); if the low end is still there, `eq_tool {"clip_ids": ["<intro-bar-copy>"], "preset": "muffle"}` on a copy of the first bar only.
3. Sub swell 8-12 f before the cut: `add_sfx_tool {"recipe": "sub_drop", "at_seconds": 1.82, "gain_db": -8}` (or `riser_tonal`).
4. Kick on the cut frame within 1 f: `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 2.0, "gain_db": -4}`.
5. Intro picture is one line or two short cards of at most 2 words each (`add_kinetic_title_tool {"text": "Meet speed", "position_seconds": 0.1, "duration_seconds": 1.8, "style": "documentary", "animation": "fade"}`).

Fallback: If the track has a kick from bar 1, high-pass it and duck it; otherwise start the music file at its quieter second bar.

## Timing & taste rules

- cinetic's timing (60 fps): Intro 117-156 f (1.95-2.6 s); about +14 dB from intro to body; sub 8-12 f (0.20 s) before the cut; kick on the cut frame (within 1 f (0.02 s)).
- Intro 117-156 f (1.95-2.6 s); about +14 dB from intro to body.
- Sub swell 8-12 f (0.13-0.20 s) before the cut; kick on the cut frame, within 1 f.
- Bar 1 sounds at intent from frame 0: no fade-in across the first bar.
- Keep the bed wide in the intro (side ~3 dB under mid) and narrow on the drop (side 16-19 dB under mid).
- Per-word ticks on the type, if any, at a constant level.

## Sound for it

This entry is the sound: sparse bed, sub 8-12 f before the cut, kick on the cut frame.

## Common mistakes

- Stings under 4 s or openers meant to be loud from frame 0 (avoid_when): there is no room to build and release.
- A drop that cannot land on a whole-frame cut: move the cut to the downbeat, not the sound.
- Fading the intro in across bar 1: the quiet should be intentional, not a fade.
- Avoid when: Stings under 4 s, openers designed to be loud from frame 0 (live grid, macro scramble), or a drop that cannot land on a whole-frame cut.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-quiet-intro-drop`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
