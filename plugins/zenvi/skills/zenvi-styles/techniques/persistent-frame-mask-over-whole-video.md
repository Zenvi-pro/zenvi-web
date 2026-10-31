---
id: persistent-frame-mask-over-whole-video
kind: technique
summary: "When changing backdrops need one frame: the whole piece inside a rounded inset on a paper mat (or a viewfinder)."
categories: [fashion-beauty-ad, music-lyric-video, travel-cinematic-montage]
tools: [add_title_tool, add_shape_mask_tool, add_vignette_tool, apply_look_preset_tool, generate_image_and_add_to_timeline_tool]
pace: medium
mood: [editorial, crafted, retro]
aspect: ["9:16", "4:5", "1:1", "16:9"]
pairs_with: [letter-indexed-object-then-look-cycle, multi-panel-and-card-video-layout, accelerating-cut-length-ramp]
avoid_with: [overhead-hands-only-recipe-overlays, slide-in-pill-badge-and-name-cards]
needs: [crt-scanline-fx]
---

# Persistent frame mask over whole video

## What it is
Every shot is seen through the same window for the whole piece: an inset
about 4 % from the edges on an off-white paper mat, a viewfinder, or a 4:3
CRT bezel. It unifies wildly different backdrops and makes cuts feel like
pages.

## Build it in Zenvi
1. The mat on track 1 for the whole length:
   `add_title_tool {"text": " ", "template": "Standard_1", "background_color": "#efe8dc",
   "position_seconds": 0, "duration_seconds": <length>, "track": "1"}`
   (or a generated paper texture via `generate_image_and_add_to_timeline_tool`).
2. All footage on track 2, then one call:
   ```json
   add_shape_mask_tool {"clip_ids": [<every footage clip>], "shape": "rectangle",
     "width": 0.92, "height": 0.95, "feather": 0.004}
   ```
   Re-run it for clips added later (the mask is per clip).
3. Viewfinder variant: `add_vignette_tool` heavy + a thin title frame; the CRT
   bezel with scan lines needs `crt-scanline-fx`.

## Timing & taste rules
- Inset 3-5 % of the short side, equal on all edges; hard edge (feather ≤ 0.005).
- The mat colour from the palette (cream, bone, black); never pure white.
- Hold it 100 % of the runtime; no transitions needed between shots.
- Hard rounded corners are not available (`add_shape_mask_tool` rounds only by
  feather); the square inset reads fine.

## Sound for it
Nothing specific; it suits paper and print foley (page turns) at -24 dB.

## Common mistakes
- Masking some clips and not others (the window jumps).
- A mat that clashes with the grade.

## Verified
2026-10-28: 6 s test, three beauty clips (portrait, lipstick, brushes) on a
cream mat, 0.92 x 0.95 rectangle. Contact sheet: steady cream border on every
shot. Watch judge overall 3.64; it reported the clip as silent twice although the
render has a bed at -13.5 dB mean (judge error) and asked for an ending card.
