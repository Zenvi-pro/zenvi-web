---
id: cin-tx-mosaic-resolve
kind: technique
summary: "When a picture is revealed on a beat: it arrives as coarse grey blocks that halve every two frames until it snaps clean."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [split_clip_tool, apply_fx_tool, color_grade_clip_tool, add_sfx_tool]
pace: medium
mood: [digital, snappy, revealing]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-tx-locked-mosaic, shot-grain-dissolve, crt-scanline-and-schematic-inserts]
avoid_with: [cin-tx-scanline-transmute]
needs: [pixelate-mosaic-fx]
drawn: cinetic
---

# Stepped mosaic resolve

cinetic `tx-mosaic-resolve` · Texture and finish · accent · energy medium · formats feature, launch, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An image or screen arrives as coarse grey blocks that halve in size every two frames until the real picture snaps in, sharp and in full colour.

Use when: Revealing an image, avatar, map or screen in a digital or tech brand; the resolve after a locked state; a beat-synced reveal.

## Build it in Zenvi

1. Place the image or screen clip at 4.0 s and cut it into six slices of 2 f (0.033 s) each, then the rest: `split_clip_tool {"clip_id": "<img>", "at_seconds": 4.033}`, then again at 4.067, 4.1, 4.133, 4.167, 4.2.
2. Coarse to fine, one dither FX per slice (pixel sizes at 1080p, the nearest the FX allows to 48/24/12/6/3/1 px blocks): `apply_fx_tool {"clip_id": "<slice_1>", "effects": [{"effect": "dither", "amount": 1, "params": {"colors": 32, "pixel": 12, "pattern": "bayer"}}]}`, slice 2 `"pixel": 8`, slice 3 `"pixel": 5`, slice 4 `"pixel": 3`, slice 5 `"pixel": 2`, slice 6 untouched.
3. Saturation and brightness rise across the same 12 f: `color_grade_clip_tool {"timeline_clip_id": "<slice_1>", "saturation": -1, "exposure": -0.5}`, then -0.7, -0.4, -0.2, -0.1 on slices 2-5, none on slice 6.
4. Optional 4-6 f (0.07-0.1 s) hold on slice 1 so the resolve starts on a beat.
5. `add_sfx_tool {"recipe": "glitch_burst", "at_seconds": 4.0, "gain_db": -16}` and `{"recipe": "hit_transient", "at_seconds": 4.2, "gain_db": -12}` on the snap.

Fallback: The dither FX gives chunky pixels but tops out at 12 px, so the first steps are finer than the 48 px of cinetic; for a coarser start, place a very low-resolution still of the picture (from `save_frame_image_tool`) as the first slice.

## Timing & taste rules

- cinetic's timing (60 fps): 48, 24, 12, 6, 3, then 1 px over 10-12 f (2 f (0.03 s) per size); saturation and brightness over 12 f (0.20 s) on ease_in_out_sine; an optional 4-6 f (0.10 s) hold at 48 px so the resolve starts on a beat.
- Six sizes, each held 2 f: the whole resolve is 10-12 f (0.17-0.2 s).
- Saturation 0 to 1 and brightness 0.7 to 1 across the same 12 f on an ease_in_out_sine curve.
- Optional 4-6 f hold at the coarsest block so the resolve starts on a beat.
- At most twice per film.

## Sound for it

A tiny glitch at the first frame and one soft hit on the snap; nothing between.

## Common mistakes

- Text-heavy screens: half-resolved text looks broken.
- Calm, quiet brands.
- More than twice per film.
- Avoid when: Text-heavy screens (half-resolved text looks broken); calm, quiet brands; more than twice per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-mosaic-resolve`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
