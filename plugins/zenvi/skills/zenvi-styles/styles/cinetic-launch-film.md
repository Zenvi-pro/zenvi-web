---
id: cinetic-launch-film
kind: style
summary: "For a software launch film watched twice: one idea told in pictures, copy in fragments, a device that becomes the mark."
categories: [cinetic-launch-film]
tools: [produce_video_tool, get_technique_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, export_video_tool, review_render_tool, watch_render_tool]
pace: medium
mood: [considered, precise, premium, calm]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-oh-pile-up-freeze-turn, cin-tr-shape-match-cut, cin-le-device-becomes-mark, cin-cl-accent-on-newest, cin-ps-breath-envelope]
avoid_with: [shot-aurora-flip, kcut-strobe-cards, kcut-hit-fx]
needs: []
---

# Cinetic launch film

A 20-45 s film that makes a viewer feel a problem, see the product answer it and remember the name. One idea
specific to this product, one story device that survives every cut and resolves into the mark, copy in
fragments of 1-4 words with picture between them, one accent with one meaning, sound caused by what you see.
The full method (brief, draw, brand from three words, grid, acts, sound, finish, review and ship gate) is
`METHOD-cinetic.md` (`get_technique_tool {"technique": "method-cinetic"}`); this file is the launch format.
After cinetic (MIT, (c) 2026 Leonxlnx; see NOTICE).

## When to use / not

Use for a software or service launch, an update film, "make a launch video for X" when the product's
behaviour is the story. Hardware with spec slams on black: `product-launch-film`. A bright UI-led SaaS promo
with glass cards: `saas-app-launch`. Wants energy, 15-20 s: `cinetic-teaser`. Not for footage montages,
talking heads or anything that needs serif/italic or glass looks the person did not bring.

## Structure (beats with timings)

Calm, 100 BPM (bar 2.4 s); every beat starts on a downbeat. The device is on screen in every row.

| beat | 20 s | 30 s | 45 s |
| --- | --- | --- | --- |
| Hook -> problem: frame 0 already moving, the problem felt by 1 s and stated by 2 s, piling up | 0-4 | 0-6 | 0-9 |
| Turn: the device meets or becomes the mark (1.5 s or less), opens into the product | 4-7 | 6-10 | 9-15 |
| Proof 1: one capability as cause -> action -> result; the person's one input first | 7-12 | 10-18 | 15-27 |
| Proof 2 / consequences: one fragment per bar, each paying off earlier copy | 12-15 | 18-24 | 27-36 |
| Promise: pull back to show scale; the refrain resolves; the loudest moment | 15-18 | 24-30 | 36-42 |
| Lockup / end card: name, the one practical fact (URL readable 1.7 s), tail to silence | 18-20 | 30-33 | 42-45 |

## Shot plan

- Shot median 1.7-2.7 s (100-160 f), maximum 4 s (240 f), minimum 0.4 s and only with no text; a
  continuous take may run 5-9 s when an in-shot beat lands at least every 1.2 s.
- 24-36 discrete events per 30 s (calm), about one visible change a second, slow life between.
- The product: the person's real recordings and screenshots, framed at 70-92 % of the width (overflowing
  an edge is good), pushed in 2-5x on every interaction that carries the story. Never a screenshot as the
  hero shot. The product is named on screen by about a quarter of the runtime.
- Energy builds to the promise: the biggest visual peak at 75-90 %; one designed lull of 1-4 s at 55-85 %;
  the last third keeps moving.

## Look & grade

- Ink and paper from the brand's three words (light or dark, neutral or cool, tinted toward the name's
  world) plus ONE accent from red, green, teal, blue or yellow, meaning one thing, about 8 % of the pixels.
- New things arrive in the accent and relax to ink over 10-30 f; the accent floods the frame at most once.
- No glow, bloom or halos; shadows soft (blur 60-120 px at 12-22 %); dark surfaces get a 1 px hairline at
  8-12 % white. Grain absent or global at 1.5-2 %. Gradients are dithered (the export does it).

## Type system

- One clean modern sans at two weights (`add_kinetic_title_tool` style `documentary`, motion blocks
  `display_font: "sans"`), plus a mono only for code or numbers. No serif, italic, condensed display.
- Statements 88-128 px at 1080p, leading 0.95-1.05; one giant keyword (14-48 % of the height) once a film.
- 15-25 words in the whole 30 s film (30 at most); fragments 1-4 words, at most 8 on screen; a thought of
  more than 4 words is a chain with 0.5-1.5 s of picture between fragments. No eyebrow labels, no stacked
  taglines, no "Introducing", never the feature name as a headline.

## Motion & transitions

- Three eases: `ease_out_expo` arrivals, `ease_in_out_sine` camera and drifts, `ease_in_cubic` exits.
  Overshoot (`ease_out_back`) only on a true landing, at most twice; never on copy.
- Ordinary moves 25 px/f or less (1080p60); text being read 3 px/f or less but never frozen (1-3 % creep).
- 6-8 transition types, each at most twice, plus one signature move from the mark three times (open,
  middle, close): match cuts on the device, mask wipes, relays, container morphs. No crossfade by default,
  no glitch, flash-through-white or spin.

## Sound & music

- Calm and text-led: effects only, mastered at -18 LUFS. A groove only when the brief wants one: then the
  drop on the hero reveal 30-60 % in, the loudest moment on the promise, -14 LUFS.
- One sound per visible event class (press, landing, a fragment resolving, the two camera-scale whooshes);
  cuts, scrolls and counters get nothing. The lockup: nothing in the 0.2-0.7 s before it, ONE clean hit on
  the frame the wordmark becomes readable, a 0.5-2.5 s tail to digital silence.

## Captions/VO

None. The film reads muted; the words confirm what the picture already said. A VO variant ducks effects
under the voice and keeps the same fragment grammar on screen.

## Tool sequence

The film is one scene (family `zenvi-scenes`, `get_technique_tool {"technique": "zenvi-scenes"}`):
`produce_video_tool` drafts it from `scenes-launch-teaser` with the request's name; rewrite it for this product.
No `build_product_launch_tool`, titles, blocks or 3D on top of it.

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-launch-film", "length_seconds": 30, "output": "film.mp4"}
get_technique_tool {"technique": "scenes-launch-teaser"}
update_scene_tool {"scene_id": "<data.scene.scene_id>", "code": "<the module rewritten: this product's device, copy and brand>"}
render_scene_tool {"scene_id": "<id>", "motion_blur": 4}
auto_sound_design_tool {"genre": "saas_ui", "intensity": "subtle"}
master_audio_tool {"preset": "social", "iterate": true}
export_video_tool {"output_path": "film.mp4"}
review_render_tool {"path": "film.mp4"}
watch_render_tool {"path": "film.mp4"}
```

## Finish checklist

- [ ] Frame 0 composed and moving; the problem felt by 1 s, stated by 2 s.
- [ ] One idea a stranger could say in one sentence; the specificity test answered in the brief.
- [ ] The device in every beat, resolving into the mark; the signature move three times.
- [ ] 15-25 words; one fragment at a time; review_edit_tool shows no copy-* or house-ban-* line.
- [ ] One accent, one meaning, about 8 % of pixels; no banned look unless it is the person's brand.
- [ ] Every sound has a visible cause within a frame (no sound-without-cause line); the lockup's one hit.
- [ ] No move over 80 px/f; text never over 20 px/f; motion blur on moves over 12 px/f.
- [ ] End card: mark and name, the one practical fact readable 1.7 s, lockup held 1.5-2.5 s and building.
- [ ] Rubric: every dimension 3+, finish and sound/sync 5, mean 4.2+; two review rounds.

## Mix-and-match

Borrow only what the brief's `draw` gives (`get_brief_tool`), at most two signature moves. Never combine with
`kcut-*` slams and strobes, flash frames, glitch, `shot-aurora-flip` gradients or glass blocks
(`glass_cards`, `liquid_glass`) unless they are the person's brand.

## Reference moments

cinetic's own launch films (Kiln, Quire Streaks, Ledgerly, Halden; local only under
`~/zenvi-motion/refs2/cinetic/`, never committed): the device carried through every cut and resolving into
the mark; copy in two- and three-word fragments with the picture acting between them.
