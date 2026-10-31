---
id: fashion-beauty-ad
kind: style
summary: "For fashion, beauty and jewellery films: restrained hard cuts, one hue world, sparse two-tier type, one pivot."
categories: [fashion-beauty-ad]
tools: [add_clip_to_timeline_tool, trim_clip_tool, gather_stock_footage_tool, unify_grade_tool, color_grade_clip_tool, add_title_tool, add_shape_mask_tool, add_kinetic_title_tool, add_motion_template_tool, add_sfx_tool, automate_volume_tool, master_audio_tool, review_render_tool, set_project_setting_tool, analyze_mix_tool]
pace: medium
mood: [elegant, editorial, sensual, confident]
aspect: ["9:16", "4:5", "16:9"]
pairs_with: [accelerating-cut-length-ramp, persistent-frame-mask-over-whole-video, letter-indexed-object-then-look-cycle, multi-panel-and-card-video-layout, vo-keyed-emphasis-stack, slow-motion-hero-passage, blackout-and-dead-silence-pause]
avoid_with: [karaoke-word-highlight-captions, sentence-split-rapid-hook, overhead-hands-only-recipe-overlays, documentary-register-parody-kit]
needs: [underlined-initial-type-on, caption-word-highlight-box, ab-compare-layout]
---

# Fashion / beauty ad

## When to use / not
Use: a collection, a look book, a beauty product film, jewellery, a designer
or brand spot, 15-60 s. Not for: a creator reviewing a product
(`ugc-ad-testimonial`), a runway hype edit to a drop (`sports-hype-edit` energy).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-3 world (2 shots) · 3-8 insert run shortening 1.1 → 0.7 s · 8-10 settle on a look · 10-13 pivot (headline) · 13-15 wordmark hold |
| 30 s | 0-5 cold open / title on black · 5-20 world montage, 1.7-2.5 s shots · 20-27 pivot (one register change) · 27-30 button |
| 60 s | 0-5 open · 5-21 world · ~21 pivot · 27-55 body: a repeating unit (object then 3 looks, ~7 s) or escalating layouts · last 2-6 s button |

One pivot around 35-45 % (eyeline to camera, a title drop, a layout change,
music cut dead). No CTA slate in the references; a wordmark or a line ends it.

## Shot plan
- Steady, not frantic: median shot 1.5-2.9 s, 24-27 cuts a minute.
- 90-100 % static shots: the subject, hands or fabric move, the camera does not
  (fewer than 15 % of shots carry a zoom).
- Insert runs of macro details (lip, brush, earring) 0.7-1.1 s, then settle on
  a 2.4 s medium.
- Credits on the wide look only.

## Look & grade
One hue world per piece or per chapter (a single backdrop colour, one temperature):
`unify_grade_tool {"look": "romantic_cinema", "look_intensity": 0.3}` across all,
or per chapter group; frames in a chapter within 20° of dominant hue. Check the
receipt: on mixed stock it may only move clips "closer" (1 of 12 in the
example); then cut the outliers. A paper-mat frame
(`persistent-frame-mask-over-whole-video`) unifies backdrops but can read as a
letterboxed wrong aspect on 9:16; keep the inset at 3 % or go full bleed.

## Type system
0-5 text events; two tiers only: a 9-12 % headline (editorial serif, one italic
accent word) and 2.5-4.5 % labels; the wordmark large (16 %) on the last hold.
Default sans in a lower third read as "generic" to the judge: use the editorial
style, centred.

## Motion & transitions
Hard cuts for 85-100 % of joins; layout changes on snares if panels are used;
text rises or types, never bounces.

## Sound & music
Music-led, -10.5 to -14 LUFS, ≤ -1 dBTP; or film-style near -19. 8-12
diegetic cues a minute on in-frame actions (shutter, fabric, a clasp) at or
under music level; at most half the cuts carry a cue. Use silence once (the
bed drops out at the pivot). No synthetic voice: a TTS line undermined the
aspirational tone in the first example; a real VO or type only.

- SFX gains are absolute, not relative to the bed: under a bed at -4 to -6 dB
  the cues vanish (the judge heard "no sound design" on examples whose cues
  were there). Bed -12 to -14, hero cues -6 to -8, then check `analyze_mix_tool`.

## Captions/VO
Usually none; one spoken line at the pivot at most, or the letter calls of
an index structure.

## Tool sequence
1. `set_project_setting_tool` 1080 x 1920 30 fps.
2. Optional mat: `add_title_tool {"text": " ", "background_color": "#efe8dc", "track": "1",
   "duration_seconds": <length>}`; footage on track 2.
3. World → insert run → settle → pivot → body → button with
   `add_clip_to_timeline_tool` per shot (lengths above).
4. `unify_grade_tool` over all footage; `add_shape_mask_tool {"width": 0.92,
   "height": 0.95, "feather": 0.004}` on every footage clip when using the mat.
5. Pivot headline: `add_kinetic_title_tool {"text": "wear it like you mean it", "style":
   "editorial", "animation": "rise", "emphasis": ["mean"], "accent": "#b0002a",
   "text_size": 0.12}`.
6. Wordmark: `add_kinetic_title_tool {"text": <brand>, "style": "editorial",
   "animation": "rise", "text_size": 0.16, "y": 0.5, "duration_seconds": 2}` on the last shot.
7. Sound: `add_sfx_tool camera_shutter -24` on 3-4 insert cuts; bed with
   `automate_volume_tool` dip or cut at the pivot and a fade on the end;
   `master_audio_tool {"preset": "social", "iterate": true}`; render; review; fix.

## Finish checklist
- [ ] Median shot ≥ 1.4 s; < 15 % of shots zoom; ≤ 15 % of joins with an effect.
- [ ] One identifiable pivot.
- [ ] Type: one headline tier + one label tier, ≤ 5 events.
- [ ] Hue: one world per chapter (dominant hue within 20°).
- [ ] Cues tied to actions, under the music, ≤ half the cuts.
- [ ] One passage with the bed ducked or removed.
- [ ] Picture covers every frame to the end (no empty mat).
- [ ] ≤ -1 dBTP.

## Mix-and-match
Borrow: `accelerating-cut-length-ramp` (insert runs), `letter-indexed-object-then-look-cycle`
(collections), `multi-panel-and-card-video-layout` (one 15-27 s layout phase),
`vo-keyed-emphasis-stack` for a beauty claim with a real VO.
Never: `karaoke-word-highlight-captions`, `sentence-split-rapid-hook`, whips
on every cut, push-ins on every shot.

## Reference moments
Local only, `~/zenvi-motion/refs2/fashion-beauty-ad/`: `601252574@11.2` insert run
that shortens then settles; `601252574@22.8` stagger headline on the VO;
`601252574@46.2` foley on hand actions; `514009432@20.8` fourth-wall puncture,
music stops; `514009432@37.3` muffled-to-open reveal; `77800806@1.9` letter
cycle and `@0-60` rounded paper-mat frame; `1090797153@15.2` split collage on
snares, `@7.0` one hue per chapter.

## Example (verified)
2026-10-29, 20-21 s, 720x1280, CLI only: twelve stock beauty and fashion shots
(world, an insert run 1.4 → 0.7 s, a settle, a pivot headline, the street, a
wordmark hold), groove bed. Pairwise watch judge against the best watched
reference window (`601252574@0-30`): v1 2.82 vs 8.0 (synthetic VO undermined the
tone; the mat ran past the last shot as an empty frame), v2 3.09 (no VO), v3 3.27
(duotone look, stack headline; the inset mat read to the judge as a wrong
aspect ratio), v4 3.27 vs 8.45 (full bleed, elegant_dark_cinema 0.6). The
blocker is the footage: twelve unrelated stock sources. `unify_grade_tool`
reported "1 of 12 within the band, 10 closer but not within it"; a fashion
piece needs one shoot or one backdrop colour, which is what the hue rule above
asks for. Also seen: `sparkle` resolved to a notification ping from the kit.
