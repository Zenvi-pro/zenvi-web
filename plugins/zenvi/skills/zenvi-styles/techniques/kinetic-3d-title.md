---
id: kinetic-3d-title
kind: technique
summary: "When the title is the hero object (launch, trailer, car): an extruded chrome/glass word tumbles in and glints."
categories: [product-launch-film, 3d-product-cgi-ad, movie-game-trailer, automotive-ad, gaming-montage, tech-review]
tools: [add_3d_scene_tool, rerender_3d_scene_tool, list_3d_scenes_tool, add_sfx_tool]
pace: medium
mood: [premium, epic, glossy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-mask-reveal, kinetic-letter-cascade, kinetic-counter, kinetic-title-sequence]
avoid_with: [kinetic-echo-stack, kinetic-beat-strobe, kinetic-write-on]
needs: []
---

# 3D extruded title

## What it is
A word extruded and bevelled in chrome, glass, plastic, iridescent or clay, tumbling in letter by letter (or rising,
spinning), a light sweeping across it, depth of field on arriving letters; transparent over footage or on a backdrop.
Rendered by Blender (Zenvi 3D) as a linked clip.

## Build it in Zenvi
```json
add_3d_scene_tool {"scene": "title_3d", "position_seconds": 0.2, "duration_seconds": 3, "quality": "draft",
  "params": {"text": "NIGHTSHIFT", "style": "chrome", "animation": "tumble", "size": 0.7}}
rerender_3d_scene_tool {"timeline_clip_id": "<the scene clip>", "quality": "final"}
add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 0.7}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": 1.3, "gain_db": -12}
```
Draft first (half size, ~13 s here), check one frame, then final. Big rolling numbers: `scene: "numerals_3d"`;
a user's SVG logo: `scene: "logo_extrude"`. CLI/desktop with Blender 4.2+ only (not the browser editor or Cloud).

## Timing & taste rules
- 2.5-4 s: tumble ≈ 1 s, then a slow glide and the light sweep; hold ≥ 1 s settled.
- One word ≤ 12 letters, `size` 0.6-0.75 of safe width.
- Chrome over dark footage, glass over a bright backdrop or footage, clay/plastic for playful brands.
- Once per edit (the title or the end lockup), never for body copy.

## Sound for it
A whoosh into the landing, a boom/impact on the settle (-10 to -12 dB), maybe a sparkle on the glint (-24 dB).

## Common mistakes
- Glass over black (invisible); chrome over white (no reflections to read).
- Final quality before checking the draft (minutes of render for a typo).

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-3d-title.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-3d-title.mp4` and its contact sheet. Checked on the sheet: chrome NIGHTSHIFT tumbles in letter by letter over the night street, settles and glides with the light sweep; final quality render, transparent over footage. Watch judge (absolute, isolated 3-5 s test): **6.4/10** overall, typography 7; its main note: "The extruded bevels look flat and matte rather than chrome because they lack street and headlight reflections.".
