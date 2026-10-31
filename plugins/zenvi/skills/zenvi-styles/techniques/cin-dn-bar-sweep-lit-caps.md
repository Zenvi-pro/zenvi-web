---
id: cin-dn-bar-sweep-lit-caps
kind: technique
summary: "When data streams in: a row of bars grows in a constant-speed wave, each with a lit cap that relaxes."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [lively, rhythmic]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [t052, kinetic-counter]
avoid_with: [cin-dn-hero-bar-pullback, shot-stagger-wave-grid]
needs: [lit-cap-bars]
drawn: cinetic
---

# Constant-speed bar sweep with lit caps

cinetic `dn-bar-sweep-lit-caps` · Data and numbers · workhorse · energy medium · formats launch, feature, loop, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A row of bars grows in a wave that travels at constant speed; each bar eases up on its own and flashes a bright cap that relaxes to the resting tone.

Use when: Volume, activity or histogram data streaming in; an opening equaliser or skyline that hints at growth.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same chart_build with solid single-tone bars (or a single-hue tonal ramp), `"colors"` not set to any gradient.
2. The cap uses the film's one accent and relaxes to the bar tone over 20 f (0.33 s): never a multi-hue gradient and never a warm amber cap.

**Full look** (relies on orange, gradient: only when the person's brand supplies that look):

1. `add_motion_block_tool {"block": "chart_build", "position_seconds": 1.0, "duration_seconds": 4.0, "placement": "full_frame", "params": {"kind": "bar", "values": ["22","30","41","52","61","74","81","96"], "labels": ["","","","","","","",""], "highlight": 7, "plate": "none"}}` (12 bars; fewer than 6 reads as ordinary bars).
2. The wave: bars appear 1.6 f (0.027 s) apart, about 25 px/f across a 1080p frame; each grows 12 f (0.2 s) ease_out_expo, and at least 0.09 x its height in px so the top edge never passes 70 px/f.
3. The lit cap is not a block option: lay a thin accent title bar above each bar? Too many clips. Use the block's `highlight` bar as the one lit cap and accept a single accent that lands on the last bar.
4. `add_sfx_tool {"recipe": "sparkle", "at_seconds": 1.0, "gain_db": -22}` and one `hit_transient` at -16 dB on the last bar.

Fallback: Individually lit caps need a per-bar accent flash that the chart block does not expose; the single accent bar is the stand-in.

## Timing & taste rules

- cinetic's timing (60 fps): 1.6 f (0.03 s) per bar (~25 px/f wave). Each bar 12 f (0.20 s) on ease_out_expo (at least 0.09 x its height in px). Cap relaxes over 20 f (0.33 s).
- Wave of 1.6 f (0.027 s) per bar, about 25 px/f at 1080p; each bar 12 f (0.2 s) ease_out_expo.
- Cap 3 px, accent on arrival, relaxing to the resting tone over 20 f (0.33 s) because the accent means just landed.
- Use at least 6 bars; bars that must be compared precisely do not suit a wave.
- Centre-out symmetric walls are a different move.

## Sound for it

A soft sparkle at the start of the wave; no tick per bar.

## Common mistakes

- Bars that must be compared precisely: the wave delays reading.
- Fewer than 6 bars.
- A multi-hue gradient or warm amber cap when the film bans them.
- Avoid when: Bars that must be compared precisely, since the wave delays reading; fewer than 6 bars.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-bar-sweep-lit-caps`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
