---
id: cin-dn-hero-bar-pullback
kind: technique
summary: "When the product wins a benchmark: the hero bar grows in a tight frame, then the camera eases back to the whole chart."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [confident, revealing]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [shot-crane-rise-reveal, kinetic-counter]
avoid_with: [shot-multiplane-slider]
needs: []
drawn: cinetic
---

# Hero bar in close-up, then pull back

cinetic `dn-hero-bar-pullback` · Data and numbers · signature · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The winning bar (or the hero chart) grows across a tight frame, then the camera eases back to show the whole chart, with the grey comparison bars and their values.

Use when: Benchmarks and comparisons the product wins; any chart whose hero value should be felt before it is compared.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same chart_build and camera moves.
2. No bloom: the hero bar stands apart from the grey bars by colour and 4-6 px of extra thickness only (set `"rest"` grey and `"highlight": 0`); skip the bloom FX.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. `add_motion_block_tool {"block": "chart_build", "position_seconds": 1.0, "duration_seconds": 6.0, "placement": "full_frame", "params": {"kind": "bar", "title": "Render time", "values": ["12", "31", "34", "39"], "labels": ["Zenvi", "A", "B", "C"], "highlight": 0, "suffix": "s", "rest": "#8a8f98", "plate": "none"}}`.
2. Close-up first, then pull back on the block clip: `set_keyframes_tool {"timeline_clip_id": "<chart>", "property": "scale_x", "points": [{"seconds": 1.0, "value": 1.4}, {"seconds": 2.0, "value": 1.46}, {"seconds": 3.3, "value": 1.0, "ease": "ease_in_out_sine"}]}` (same on `scale_y`; push 4 % while the bar fills for 50 f, 0.83 s; pull back over 52-80 f, 0.87-1.33 s), plus `location_x/y` that keep the hero bar tip at about 60 % of frame width.
3. Values and labels type in during the pull-back: they are part of the block; start the pull-back 12 f (0.2 s) before they count.
4. Hero bar glow for the full look: `apply_fx_tool {"clip_id": "<chart>", "effects": [{"effect": "bloom", "amount": 0.35, "start": 2.0, "end": 3.5}]}`.
5. `add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 1.0, "gain_db": -20}` and `{"recipe": "hit_transient", "at_seconds": 2.0, "gain_db": -14}` on the landing.

## Timing & taste rules

- cinetic's timing (60 fps): Bar fill 50 f (0.83 s) on ease_in_out_sine (no overshoot) with a 4% push. Pull-back 52-80 f (1.33 s) on ease_in_out_sine to 0.65-0.75 of the close scale. Values count over 28 f (0.47 s) on ease_out_cubic at a 4 f (0.07 s) stagger. Hold the full chart at least 36 f (0.60 s) under a breath.
- Close frame at 1.33-1.5x; bar fill 50 f (0.83 s) ease_in_out_sine with no overshoot and a 4 % push; keep the tip at or under 70 px/f.
- Pull-back 52-80 f (0.87-1.33 s) to 0.65-0.75 of the close scale.
- Values count over 28 f (0.47 s) at a 4 f (0.07 s) stagger, top to bottom, starting 12 f into the pull-back.
- Hold the full chart at least 36 f (0.6 s) under a breath; no more than about 6 bars.

## Sound for it

Soft rising tone under the fill and one hit_transient at -14 dB on the bar landing; no sound on the pull-back.

## Common mistakes

- Narrow wins, which the close-up oversells.
- More than about 6 bars: the labels go unreadable after the pull-back.
- A glow on the hero bar when the film bans glow.
- Avoid when: Narrow wins, which the close-up would oversell; more than ~6 bars, whose labels go unreadable after the pull-back.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-hero-bar-pullback`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
