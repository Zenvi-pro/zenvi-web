---
id: 3d-product-cgi-ad
kind: style
summary: "For a CGI product spot (earbuds, device, bottle): one feature per 3-5 s, each with its own picture, clean white or black."
categories: [3d-product-cgi-ad]
tools: [set_project_setting_tool, add_3d_scene_tool, rerender_3d_scene_tool, generate_image_and_add_to_timeline_tool, add_motion_block_tool, add_kinetic_title_tool, add_title_tool, set_keyframes_tool, apply_motion_transition_tool, apply_fx_tool, subject_glow_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_sfx_tool, auto_sound_design_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: medium
mood: [clean, premium, playful, precise]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [T062, T001, T002, T023, T004, T006, T008, T027, T083, T089, T110, T069]
avoid_with: [T021, T045, T084, T118]
needs: [exploded-view-3d, cgi-aperture-flythrough, refraction-rings-tracked, mesh-anchored-callouts-3d]
---

# 3D product / CGI ad

A product spot made of rendered units: a title or spin at full energy from
frame 0, then 4-6 features, each one 3-5 s unit with one picture of the
claim and one short line beside the product, hard cuts on onsets, a closing
physical action and a held logo. The grade commits to one pole: blown
white or black void.

## When to use / not

Use for: earbuds, phones, bottles, cosmetics, sneakers, any product shown
as a render or a clean studio still; "3D ad", "CGI product video",
"spins in", "feature film for my product". Not for: real-footage launch
films with spec slams (`product-launch-film`), app UI (`saas-app-launch`),
lifestyle ads with people as the subject.

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Hook: title, product spin or ring graphic, full energy, no logo | 0-1.5 | 0-2.5 | 0-4 | 0-5 |
| Feature run: one feature per 3-5 s unit (T062) | 1.5-11 (2-3) | 2.5-23 (4-5) | 4-48 (6-9) | 5-75 (10-14) |
| Last feature: stamina / battery / the "always" claim | inside the run, last | 19-23 | 42-48 | 68-75 |
| Closing action: lid closes, buds dock, parts snap together | 11-12.5 | 23-25.5 | 48-52 | 75-80 |
| End card: logo on white or black, 1.5 % legal, held | 12.5-15 | 25.5-30 | 52-60 | 80-90 |

A feature never runs over ~5.5 s.

## Shot plan

- Per feature: one 2-5 s product shot (orbit, push-in, spin) plus its
  claim graphic (rings, pulse, bolt, bokeh, beam) and a 1-2 s macro insert.
  Alternate macro detail with a wider "stage" shot (silhouette, person).
- Shot median ~2.3 s (p10 0.75-1.9, p90 5-8); about 17 cuts per minute.
- Sources, in order: the user's renders or .glb (`add_3d_scene_tool`
  `model_showcase`), Zenvi 3D scenes (`device_mockup`, `glass_hero`,
  `title_3d`, `numerals_3d`, `particle_burst`), an AI product still
  (`generate_image_and_add_to_timeline_tool`) moved with keyframes. Keep the
  product moving the whole time; a held still is a slideshow.
- Draft every 3D scene first (`quality: "draft"`), look, then
  `rerender_3d_scene_tool` `quality: "final"`.

## Look & grade

- One pole per film: high-key white (luma > 200, saturation < 15: one
  white, `#F7F7F5`, everywhere) or black void (luma < 30). Or a deliberate
  hue per feature (blue, amber, violet, green) on silhouette stages (T023).
- No grain, no LUT on a white studio (`clean_&_denoise` at most). Bloom
  only on neon edges; chromatic aberration only on glass/refraction.

## Type system

- Product title 7-15 % of frame height, semibold, centre or on the ground
  plane; it can refract or distort in, then snaps.
- Feature line: 1-2 lines, sentence case, regular/medium, 3.5-4.5 %,
  **beside or below the product, never on it**, holds 1.5-4 s, fades or
  blurs out. `add_kinetic_title_tool` `style: "documentary"` (`animation:
  "fade"` or `"rise"`, `text_size` 0.04, `avoid` = the product box).
- Keyword pair or stat 5-10 % with a micro-overshoot (`numerals_3d` for a
  big figure). Legal 1.5 % on the end card. No captions.

## Motion & transitions

- Hard cut is the default (~68 %); match cuts on ring/shape (10 %),
  zoom-through into a port or screen (T001/T110), speed-ramp cuts and one
  morph at section changes and the end only.
- Camera: slow orbit (360° over 2-4.6 s) or push-in; zero shake.
- A pop-in with overshoot for still products: scale 0.6 → 1.04 → 1 and
  rotation -12 → 0 over 0.6 s (`set_keyframes_tool`, `ease_out_back`).

## Sound & music

- Music: electronic / bass-house / trap with vocal chops at ~130 bpm, full
  from 0 s, no intro build, hard stop or silence at the end card; or
  ambient piano for a slow design film.
- About 12 cues per minute (~0.7 per cut): sub drops on titles, risers
  into fly-throughs, product foley (click, magnetic snap, case lid), glints
  on specular passes, one final hit on the logo. Cartoon pops are out.
- Levels (CRAFT.md 3D palette): music minimal and spacious; the mix sits
  lower than a hype edit, so a mastered track goes in at
  `set_clip_volume_tool` `level_db` -8…-10; landing thump 1 frame late
  with sub + harmonic layer; space a clean dark hall 1.2-2 s.
- Master at -16 LUFS (`target_lufs: -16`, `genre: "product_3d"`), true
  peak ≤ -1.4 dBTP.
- Optional "sound demonstration" (T083): the bed low-passes while a mode
  is shown, then opens.

## Captions/VO

None in the spot. A designer-VO long form (~95 wpm) lets VO set the cuts
and ducks music ~4 dB (`duck_tool`).

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 30}
search_freesound_music_tool {"query": "bass house groove vocal chop", "min_seconds": 35}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>", "position_seconds": 0, "start_seconds": 0, "duration_seconds": 30, "track": "5"}
detect_beats_tool {"file_id": "<music file>"}
add_3d_scene_tool {"scene": "title_3d", "quality": "draft", "position_seconds": 0, "duration_seconds": 2.5, "params": {"text": "<Name>", "background": "light"}}
add_3d_scene_tool {"scene": "model_showcase", "quality": "draft", "position_seconds": 2.5, "duration_seconds": 4.5, "params": {"background": "light"}}
add_kinetic_title_tool {"text": "Noise, gone in a tap.", "position_seconds": 3.2, "duration_seconds": 3.2, "style": "documentary", "animation": "rise", "text_size": 0.04, "ink": "#111111", "y": 0.82}
add_motion_block_tool {"block": "particle_burst", "position_seconds": 3, "duration_seconds": 1.5, "params": {"shape": "rings", "origin": [{"x": 0.5, "y": 0.5}]}}
add_3d_scene_tool {"scene": "glass_hero", "quality": "draft", "position_seconds": 7, "duration_seconds": 4, "params": {"background": "light"}}
add_3d_scene_tool {"scene": "numerals_3d", "quality": "draft", "position_seconds": 19, "duration_seconds": 4, "params": {"values": [0, 30], "suffix": "h", "background": "light"}}
add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 25.5, "duration_seconds": 4.5, "params": {"brand": "<Brand>", "cta": "", "url": "", "palette": "light"}}
```

Look at every draft (`preview_frame` mid-shot), then `rerender_3d_scene_tool`
`quality: "final"` on each. Read the parameter names from `list_3d_scenes_tool`
(they differ per scene; `numerals_3d` `values` are numbers). Keep
`title_3d` to 1.5-2 s, and put the landing thump on the frame the product
touches down (a `land: true` showcase lands in its first ~0.4 s). Sound:

```json
auto_sound_design_tool {"genre": "product_3d", "intensity": "normal"}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": 0.2, "gain_db": -8}
add_sfx_tool {"recipe": "whoosh_rise", "at_seconds": 2.5, "gain_db": -12}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 2.53, "gain_db": -9}
add_sfx_tool {"recipe": "sparkle", "at_seconds": 8.0, "gain_db": -18}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 25.4, "pitch": -4, "gain_db": -8}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 25.5, "gain_db": -8}
master_audio_tool {"preset": "social", "target_lufs": -16, "genre": "3d_product", "iterate": true}
review_edit_tool {}
```

Render, `review_render_tool` (`loudness_target_lufs: -16`), one fix pass.
Without Blender: the AI product still with the pop-in keyframes above and a
3-5 % push per shot; `gradient_field` / `particle_burst` blocks as the
claim pictures.

## Finish checklist

- [ ] One claim per 3-5 s unit, 1-2 lines at 3.5-4.5 %, sentence case.
- [ ] Text never overlaps the product (check each text frame).
- [ ] Every feature owns a picture of the claim; no unillustrated text card.
- [ ] ~12 cues/min: every title, fly-through and product action has a sound; a distinct final hit.
- [ ] One grade pole (white > 200 luma or void < 30) or a deliberate hue per feature.
- [ ] Hard cuts by default; effects at section turns only.
- [ ] Ends on a physical action, then a held logo 2.6-11 s; last sound is a hit, drop or silence.
- [ ] Draft and final 3D framings match; no black edges.
- [ ] ~-16 LUFS, true peak ≤ -1.4 dBTP.

## Mix-and-match

Borrow: T062 (the unit), T001 aperture fly-through, T002 exploded
levitation, T023 one-hue silhouette stage, T006 refraction rings, T004
mesh-pinned HUD (technical product), T008 surface-locked type, T027 angled
matte, T083 low-pass then open, T089 closing action to black, T069 spring
lockup. Never: T021 dark tease, T045 strobe bursts, T084 dead stop gag,
captions (T118), grain, a transition on every cut.

## Reference moments

Local only, in `~/zenvi-motion/refs2/3d-product-cgi-ad/`:
`airpods-pro-product-tpl-us-2025_16x9` (refraction rings 2.2 s, port
fly-through 7.8 s, feature units 11.2 s, step-fan clones 18.8 s, battery
bolt 35.8 s, logo 40.5 s); `airpods-5-product-tpl-us-2026_16x9`
(hue-per-feature silhouette stages 11.8 s, low-passed bed with a PA
announcement 15.6 s, hard stop 40.7 s); `macbook-pro-product-tpl-us-2026_16x9`
(light-cone matte 1.7 s, chassis-plane type 5.1 s, lid snap to black
36.5 s); `C9Mh5ukKt3e` (an 8 s render loop with no foley: the weak example).

## Example (verified 2026-10-28)

18 s of draft Blender scenes (glass title, generic speaker, glass rings,
battery figure, landing) and a light logo card, CC0 groove
(`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/3d-product-cgi-ad.*`). Watch judge 3.9/10: the landing had no impact on
its frame and the title held static 2 s (rules added above); the first
`numerals_3d` call was refused for string values and master for the genre
spelling, both fixed in the sequence above. Draft quality only.
