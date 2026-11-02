---
id: cinetic-logo-sting
kind: style
summary: "For a 3-8 s logo sting: the mark builds from its own primitives, one tuned hit on contact, a lockup held and building."
categories: [cinetic-logo-sting]
tools: [produce_video_tool, get_technique_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, export_video_tool, review_render_tool, watch_render_tool]
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

The film is one scene (family `zenvi-scenes`, `get_technique_tool {"technique": "zenvi-scenes"}`):
`produce_video_tool` drafts it from `scenes-logo-sting` with the request's name; rewrite it for this product.
No `build_product_launch_tool`, titles, blocks or 3D on top of it.

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-logo-sting", "length_seconds": 6, "output": "film.mp4"}
get_technique_tool {"technique": "scenes-logo-sting"}
update_scene_tool {"scene_id": "<data.scene.scene_id>", "code": "<the module rewritten: this product's device, copy and brand>"}
render_scene_tool {"scene_id": "<id>", "motion_blur": 4}
auto_sound_design_tool {"genre": "saas_ui", "intensity": "subtle"}
master_audio_tool {"preset": "social", "iterate": true}
export_video_tool {"output_path": "film.mp4"}
review_render_tool {"path": "film.mp4"}
watch_render_tool {"path": "film.mp4"}
```

The transparent version: `update_scene_tool` params `{"background": false}`, then `render_scene_tool`
`placement: "over_video"` (ProRes 4444 with alpha).

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
