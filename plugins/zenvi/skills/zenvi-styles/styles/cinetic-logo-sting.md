---
id: cinetic-logo-sting
kind: style
summary: "For a 3-8 s logo sting: the mark builds from its own primitives, one tuned hit on contact, a lockup held and building."
categories: [cinetic-logo-sting]
tools: [produce_video_tool, save_brief_tool, get_brief_tool, get_technique_tool, set_project_setting_tool, add_motion_block_tool, add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool, master_audio_tool, review_edit_tool, export_video_tool, review_render_tool, save_frame_image_tool]
pace: medium
mood: [confident, crafted, clean, resolved]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [cin-le-seed-stroke-build, cin-le-mark-slide-name-follow, cin-le-living-hold]
avoid_with: [shot-aurora-flip, kcut-assemble]
needs: []
---

# Cinetic logo sting

The mark arrives with intent, makes one sound and holds long enough to be read and remembered: 3-8 s at
100-120 BPM, the name plus at most 3 words. The sting teaches the mark's construction, so it is built from
2-4 primitives; a fade or scale-up of a flat logo teaches nothing. Method: `METHOD-cinetic.md` (scaled-down
path). After cinetic (MIT, (c) 2026 Leonxlnx; see NOTICE).

## When to use / not

Use for "a logo animation", "an intro sting", "a logo reveal for the channel", the opener of other videos.
A film that ends on a logo: the lockup act of `cinetic-launch-film`. A 3D extruded logo: `3d-product-ad`.

## Structure (beats with timings)

| beat | 4 s | 6 s | 8 s |
| --- | --- | --- | --- |
| Gather: frame 0 moving; one primitive (the device) enters with anticipation | 0-1.2 | 0-2 | 0-2.4 |
| Assembly hit: the primitives accelerate into contact, squash, ONE tuned hit on the contact frame | 1.2 | 2 | 2.4 |
| The wordmark reveals from behind the mark's live edge; words lock without overshoot | 1.2-2.2 | 2-3.5 | 2.4-4.2 |
| Lockup holds and builds (a 10-20 % push), the tail decays to digital silence | 2.2-4 | 3.5-6 | 4.2-8 |

## Shot plan

One shot. The resolved lockup spans 28-45 % of the frame's width (540-860 px at 1920); the lockup cue sits
1.5 s or more before the end and scale changes 3-20 % over the last 1.5 s.

## Look & grade

The brand's colours; with none, ink, paper and one accent that floods the frame at most once, on the hit.
The mark must read on light and dark plates when an alpha version ships.

## Type system

The name in the brand's sans (motion blocks `display_font: "sans"`), set like a typographer: mark-to-cap
ratio, gap and tracking chosen from three settings side by side.

## Motion & transitions

- Contact on an accelerating ease (`ease_in_cubic` into the frame of contact), then a squash: scale_x 1.08
  -> 1, scale_y 0.9 -> 1 over 8 f (0.13 s), anchored at the contact edge.
- Clamp every overshoot that could push one piece into another (interpenetration is the classic sting bug).
- The hold: a linear push of 10-20 % (`set_keyframes_tool` scale), one +1.5 % beat
  punch.

## Sound & music

One hit tuned to the root of the key on the contact frame (`add_sfx_tool` `hit_transient` or `swoosh_hit`),
an optional pre-hit tick or riser landing on it, no music bed unless asked, the last 10 ms silent. Master
-16 LUFS (it plays at the head of other videos).

## Captions/VO

None.

## Tool sequence

```json
produce_video_tool {"request": "<the brief>", "style": "cinetic-logo-sting", "length_seconds": 6, "skip": ["music"]}
get_brief_tool {}
get_technique_tool {"technique": "<each drawn pick>"}
set_project_setting_tool {"fps": 60}
add_motion_block_tool {"block": "logo_build", "position_seconds": 0, "duration_seconds": 6, "params": {"name": "<Name>", "tagline": "", "mark": "<petals|pinwheel|stack|kit, from the mark sheet>", "colors": ["<ink>", "<accent>"], "display_font": "sans", "exit": false}}
set_keyframes_tool {"timeline_clip_id": "<the block>", "property": "scale_x", "points": [{"seconds": 3.5, "value": 1.0}, {"seconds": 6, "value": 1.12}]}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 2.0, "gain_db": -6}
add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 2.0, "gain_db": -16}
master_audio_tool {"target_lufs": -16}
review_edit_tool {}
export_video_tool {}
review_render_tool {"path": "<render>", "loudness_target_lufs": -16}
save_frame_image_tool {"time": 5.9}
```

With the person's own logo: `logo_reveal_end` with `params.logo` = their file, `glow: false`. An alpha
version for editors: `export_video_tool` with a ProRes 4444 preset over no background.

## Finish checklist

- [ ] Frame 0 already moving; the mark assembled from its own primitives, not faded in.
- [ ] One hit within a frame of the contact (no sound-without-cause line); the tail falls to silence.
- [ ] The lockup 28-45 % of the width, readable 1.5 s or more, held and building, never a slow fade away.
- [ ] The mark reads at 16 px and at 512 px (`save_frame_image_tool` stills).
- [ ] The accent 8 % of pixels or less on the final frame (unless the brand is the accent).

## Mix-and-match

The draw (format sting) gives the logo-and-end-card move first, then a hook. Never particles assembling the
word (`kcut-assemble`), glows or gradients unless they are the brand.

## Reference moments

cinetic's gallery stings (local only, `~/zenvi-motion/refs2/cinetic/`): the contact squash on the hit and the
wordmark sliding out from behind the mark's moving edge.
