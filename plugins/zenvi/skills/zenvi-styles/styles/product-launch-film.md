---
id: product-launch-film
kind: style
summary: "For a hardware or device launch film: product named in 3 s, spec slams on black, proof shots, one lockup."
categories: [product-launch-film]
tools: [set_project_setting_tool, gather_stock_footage_tool, search_freesound_music_tool, import_stock_media_tool, detect_beats_tool, add_clip_to_timeline_tool, add_kinetic_title_tool, add_title_tool, add_motion_block_tool, add_3d_scene_tool, set_keyframes_tool, apply_motion_transition_tool, color_grade_clip_tool, unify_grade_tool, apply_fx_tool, add_sfx_tool, spot_sound_tool, master_audio_tool, review_edit_tool, review_render_tool]
pace: fast
mood: [bold, premium, precise, dark]
aspect: ["16:9", "9:16"]
pairs_with: [t048, t106, t110, t008, t002, t089, t027, t057, t062, t119]
avoid_with: [t021, t084, t124, t118]
needs: []
---

# Product launch film

The hardware spec film: the product alone on black in the first second,
its name by 3 s, then two or three proof blocks where a one-word spec slam
hard-cuts to the picture that proves it, a recap at full energy, and a
held lockup with a legal line. Hard cuts on transients, contact foley over
the bed, no captions.

## When to use / not

Use for: a phone, laptop, earbuds, camera, speaker, any physical device
launch ("launch film", "keynote video", "reveal our new device"). For a
software product use `saas-app-launch` (bright, UI-led); do not blend the
two in one film. For a pure CGI hero spot with feature metaphors use
`3d-product-cgi-ad`. Not for reviews, unboxings or tutorials.

## Structure (beats with timings)

| beat | 15 s | 30 s | 60 s | 90 s |
| --- | --- | --- | --- | --- |
| Hook: product alone, macro edge on black or a lid snap | 0-1.5 | 0-2 | 0-3.5 | 0-5.5 |
| Name card / 3D lockup (by 3 s) | 1.5-3 | 2-3.5 | 3.5-5.5 | 5.5-8 |
| Proof block 1: spec slam → proof (t048) | 3-7 | 3.5-11 | 5.5-22 | 8-30 |
| Proof block 2 (and 3), opened by a warp or zoom-through (t106/t110) | 7-11 | 11-21 | 22-45 | 30-68 |
| Recap / payoff: physical action or lockup at full energy (75-88 %) | 11-13 | 21-25.5 | 45-52 | 68-78 |
| End card: logo + 2 % legal line, reverb tail (t089) | 13-15 | 25.5-30 | 52-60 | 78-90 |

## Shot plan

- Shot length median ~1.9 s with a long tail: one 5-8 s opening macro or
  payoff orbit; 0.4-1.5 s spec cards; 1.5-2.5 s proof shots.
- Mix (hardware film): ~30-60 % graphic or type cards, 30-45 % product
  close and medium, the rest screens and people using it.
- Camera on hardware: slow orbit, push-in, single-axis tilt; 1-1.5 s per
  move in the fast films, never whip pans, almost never handheld.
- Product media: the user's renders or footage first; else
  `add_3d_scene_tool` `device_mockup` / `model_showcase` (draft first);
  else stock "laptop on black background", "phone macro edge studio".
  Never a generic phone standing in for a different product.

## Look & grade

- Pure black ground (luma 25-55), silver/aluminium neutrals, saturation
  ~25 and one accent hue (violet, blue) on die glows and type gradients.
  Software-launch variant only: high-key.
- No grain, no LUT film look: clean, crushed floor, specular highlights.
  `color_grade_clip_tool` shadows -0.4, contrast 0.2, saturation 0.6 on
  footage; bloom (`apply_fx_tool` `bloom`, CLI) on glowing edges only.
- `unify_grade_tool` across product shots so every black is the same black.

## Type system

- Spec slams: ultra-bold condensed caps (Anton / Bebas Neue via
  `add_kinetic_title_tool` style `stack`, `animation: "slam"`), 25-55 % of
  frame height, white on black, one word or phrase per card, 0.4-1.5 s,
  hard cut out; no easing drift.
- Name: medium title case 8-15 % (`kinetic_headline` `style: "pop"` or
  `add_3d_scene_tool` `title_3d`).
- Stats pinned to the scene where possible (t008); a lower third only for
  a person credit (2.8-4 %).
- 1-3 words per card; a full sentence on screen is the average film.
- Legal line 1.5-2 % on the end card. No captions.

## Motion & transitions

- Hard cuts 57-68 %, on kick/snare transients inside spec runs.
- At section changes only: zoom-through into a screen or port (t110),
  1-1.5 s warp tunnel (`hyperspace` block, t106), a match cut on edge or
  lid, an angled matte wipe (t027, rectangular approximation).
- No white flashes, no glitch, no slides between spec cards.

## Sound & music

- Music: electronic hip-hop / UK bass / trap with vocal chops, or ambient
  pulse for the calm design film; full energy from frame 0 in fast films.
  Cuts on onsets (~45 %), not the beat grid (~10 %).
- Every hero event gets a cue (t086-like): sub drop or hit on each slam,
  riser into a reveal, whooshes only on real movement (warp, zoom, matte),
  contact foley (lid snap, plug, key click) **above** the bed.
- Levels: bed -15…-17 LUFS short-term; contact foley and subs 0-3 LU over
  it; whooshes 4 dB under the hero. Keep crest 12-17 dB: master at -16
  LUFS for a premium film (`target_lufs: -16`), -14 for social.
- End: snap, then the music stops; a reverb tail under the logo.

## Captions/VO

None in the spec film. A designer-VO variant (calm, ~95-120 wpm) ducks the
music ~4 dB and cuts on breaths; still no captions.

## Tool sequence

```json
set_project_setting_tool {"width": 1920, "height": 1080, "fps": 30}
search_freesound_music_tool {"query": "dark bass electronic hip hop beat", "min_seconds": 35}
import_stock_media_tool {"source": "freesound", "sound_id": "<id>", "preview_url": "<url>", "position_seconds": 0, "start_seconds": 0, "duration_seconds": 30, "track": "5"}
detect_beats_tool {"file_id": "<music file>"}
gather_stock_footage_tool {"queries": ["laptop on black background studio", "laptop keyboard macro light", "code on screen dark", "video editing timeline screen", "hands typing laptop dark"], "count": 8, "orientation": "landscape", "min_seconds": 4}
```

Hook and name, then spec slam → proof pairs on onsets (times from the
beats receipt):

```json
add_clip_to_timeline_tool {"file_id": "<macro product>", "position_seconds": 0, "start_seconds": 1, "end_seconds": 3, "track": "1"}
add_motion_block_tool {"block": "kinetic_headline", "position_seconds": 2, "duration_seconds": 1.5, "track": 2, "placement": "full_frame",
  "params": {"text": "<Product Name>", "style": "pop", "palette": "dark", "max_size": 160}}
add_kinetic_title_tool {"text": "CODE", "position_seconds": 3.6, "duration_seconds": 0.5, "style": "stack", "animation": "slam", "text_size": 0.3, "background": "#000000"}
add_clip_to_timeline_tool {"file_id": "<code on screen>", "position_seconds": 4.1, "start_seconds": 0, "end_seconds": 2, "track": "1"}
add_kinetic_title_tool {"text": "RENDER", "position_seconds": 6.1, "duration_seconds": 0.5, "style": "stack", "animation": "slam", "text_size": 0.3, "background": "#000000"}
add_clip_to_timeline_tool {"file_id": "<timeline screen>", "position_seconds": 6.6, "start_seconds": 0, "end_seconds": 2, "track": "1"}
set_keyframes_tool {"timeline_clip_id": "<timeline screen>", "property": "scale_x", "points": [{"timeline_seconds": 6.6, "value": 1.35}, {"timeline_seconds": 8.0, "value": 1.0, "ease": "ease_out"}]}
add_motion_block_tool {"block": "hyperspace", "position_seconds": 10, "duration_seconds": 1.5, "track": 2, "params": {"palette": "night", "colors": ["#8B5CF6", "#22D3EE"], "flash": "none"}}
add_motion_block_tool {"block": "counter", "position_seconds": 15, "duration_seconds": 2.5, "params": {"values": ["0", "24"], "suffix": " h", "label": "battery life", "palette": "dark", "accent": "#8B5CF6"}}
apply_motion_transition_tool {"track": "1", "time": 11.2, "preset": "zoom_through"}
```

(`scale_y` gets the same points as `scale_x`.) End on the closing action
and the card (t089):

```json
add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 25.5, "duration_seconds": 4.5, "params": {"brand": "<Brand>", "cta": "", "url": "", "palette": "dark"}}
add_title_tool {"text": "<legal line>", "position_seconds": 25.5, "duration_seconds": 4.5}
add_sfx_tool {"recipe": "impact_slam", "at_seconds": 3.6, "gain_db": -8}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": 6.1, "gain_db": -8}
add_sfx_tool {"recipe": "whoosh_long", "at_seconds": 11.2, "gain_db": -12}
add_sfx_tool {"recipe": "hit_transient", "at_seconds": 25.5, "gain_db": -6}
master_audio_tool {"preset": "social", "target_lufs": -16, "genre": "product_3d", "iterate": true}
review_edit_tool {}
```

Blocks have minimum lengths (`kinetic_headline`, `hyperspace` 1.5 s,
`lower_third` 2.5 s): put a short block on track 2 over the cut instead of
shortening it. `master_audio_tool` spells the genre `3d_product`
(`auto_sound_design_tool` says `product_3d`). `spot_sound_tool` first if unsure which slams and moves still lack a cue.
Render, `review_render_tool` (`loudness_target_lufs: -16`), one fix pass.

## Finish checklist

- [ ] Product on screen at 0 s; product named by 3 s.
- [ ] Spec cards 1-3 words, 0.4-1.5 s, each followed by its picture proof.
- [ ] Cuts on transients; designed transitions only at section changes.
- [ ] Shot lengths vary: an opening or payoff shot ≥ 5 s amid a ~1.9 s median.
- [ ] Pure black ground, one accent hue; same black on every shot.
- [ ] Contact foley and subs above the bed; whooshes under it.
- [ ] No captions, no full sentences on screen.
- [ ] Ends on an action, then one lockup with a 2 % legal line and a tail.
- [ ] ~-16 LUFS (crest kept), true peak ≤ -1 dBTP.

## Mix-and-match

Borrow: t048 verb card then proof, t106 warp tunnel, t110 zoom-through,
t008 surface-locked stat, t002 exploded levitation, t027 angled matte, t089
closing action to black, t119 keyword slam, t057 glass UI for a software
section. Never: captions (t118/t124), t021 slow dark tease (too slow for
the name-by-3 s rule), t084 music stops for a gag, grain, flashes.

## Reference moments

Local only, in `~/zenvi-motion/refs2/product-launch-film/`:
`mac-studio-product-tpl-us-2026_16x9` (spec slams 3.5-5.0 s, verb card
then proof 17.9-25 s, warp tunnels 13.0 and 34.5 s, lockup 68.8 s);
`macbook-pro-product-tpl-us-2026_16x9` (lid snap hook 0-1.8 s, wedge
matte 10.7 s, floor-plane stat 5.4 s, lid close to packshot 35.8 s);
`iphone-air-product-tpl-us-2025_16x9` (8 s macro opening, designer lower
third 4.0 s, exploded glass layers 54.2 s, portal push 42.1 s).

## Example (verified 2026-10-28)

20 s: keyboard macro hook, three verb slams each followed by a screen
proof, counter, lid close, dark lockup, Pexels stock and a CC0 trap beat
(`~/zenvi-motion/fleet/artifacts/sk2-product-brand/styles/product-launch-film.*`). Watch judge 3.6/10. The run hit three
refusals that are now rules above (headline and warp under 1.5 s, the
genre spelling), so the name card and warp tunnel were missing from the
judged render and the mix was unmastered; the judge also flagged a bright
desk lid-close shot against the black film. Not re-rendered (budget).
