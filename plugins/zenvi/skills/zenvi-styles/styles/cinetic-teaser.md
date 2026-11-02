---
id: cinetic-teaser
kind: style
summary: "For a 15-20 s teaser or drop: the problem, the turn and the name, crisp at 120 BPM, one glimpse of proof, no logo first."
categories: [cinetic-teaser]
tools: [produce_video_tool, get_technique_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, export_video_tool, review_render_tool, watch_render_tool]
pace: fast
mood: [crisp, confident, tense, premium]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-oh-quiet-intro-drop, cin-tr-velocity-handoff-cut, cin-le-stage-clears-to-brand, cin-tx-speed-gated-motion-blur]
avoid_with: [kcut-strobe-cards, shot-glitch-cycle, shot-aurora-flip]
needs: []
---

# Cinetic teaser

The launch film cut to its bones and played crisp: a 15-20 s piece that opens inside the problem, turns on a
drop, gives the product one glimpse (or none) and lands the name. 120 BPM (a 2.0 s bar), 6-10 words, the
crisp text profile (fragments up to 5 words, up to 10 on screen, still never a sentence at once). Method:
`METHOD-cinetic.md`; full format: `cinetic-launch-film`. After cinetic (MIT, (c) 2026 Leonxlnx; see NOTICE).

## When to use / not

Use for "a teaser", "a drop", "a hype cut for the launch", a pre-launch social post, the first look before
the full film. A full story with two proofs: `cinetic-launch-film`. A footage trailer with braams:
`movie-game-trailer`. Never opens on the logo.

## Structure (beats with timings)

Crisp, 120 BPM; section changes on downbeats (every 2.0 s).

| beat | 15 s | 20 s |
| --- | --- | --- |
| Hook -> problem: frame 0 moving, felt by 0.5 s; the first 6 s twice as dense as the middle | 0-4 | 0-6 |
| Suck to silence, then the turn on drop 1: the device becomes the mark (1.5 s or less) | 4-6 | 6-8 |
| One glimpse of proof: the product acting once, cause -> result | 6-10 | 8-14 |
| Payoff: the loudest moment, the refrain resolves | 10-13 | 14-18 |
| Name / end card: the date or "out now", readable 1.7 s, tail to silence | 13-15 | 18-20 |

## Shot plan

- Shot median 1.0-1.5 s (60-90 f), maximum 3 s (180 f); 45-60 events per 30 s, a motion peak every bar
  with 0.5-1.2 s (30-70 f) of calm between peaks.
- The product appears once and is readable: one push-in 2-5x on the one interaction.

## Look & grade

As `cinetic-launch-film`: the brand's ink and paper, one accent with a meaning, no glow; a darker stage
suits crisp films but keep it tinted (pine-black, ink-navy), not #000.

## Type system

- One sans; crisp entries: words rise 0.32 em over 26 f (0.43 s) on `ease_out_expo`, 6 f (0.10 s) stagger,
  an entry blur of at most 8 px clear by 60 % of the move (`kinetic_headline` `style: "blur"`), exit per
  word over 16 f (0.27 s).
- Reading hold 36 f + 6 f per word (0.6 s + 0.1 s per word). Copy on at most 80 % of the runtime.

## Motion & transitions

- More fast moves allowed than calm (whips at 60-70 px/f), each next to real stillness and never while text
  is read; motion blur on every move over 12 px/f (`apply_fx_tool` `directional_blur` on its window).
- Velocity-matched cuts and whips on the kick (`apply_motion_transition_tool` `whip`, 2-3 a teaser at most);
  the signature move three times. No glitch, white flashes or spin.

## Sound & music

- Music drives it: `detect_beats_tool`, cuts on its 8ths, the turn on drop 1, a "suck" to true silence
  before it; the payoff is the loudest moment (limiter under 1.5 dB); master -14 LUFS.
- Effects on discrete state changes only, about 5 per 10 s, clustered where the music is sparse; the lockup
  gets one clean hit and a tail; nothing on top of it.

## Captions/VO

None.

## Tool sequence

The film is one scene (family `zenvi-scenes`, `get_technique_tool {"technique": "zenvi-scenes"}`):
`produce_video_tool` drafts it from `scenes-launch-teaser` with the request's name; rewrite it for this product.
No `build_product_launch_tool`, titles, blocks or 3D on top of it.

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-teaser", "length_seconds": 20, "output": "film.mp4"}
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

- [ ] Opens inside the problem, never on the logo; something changes every 0.5 s in the first 6 s.
- [ ] 6-10 words, fragments of 5 or fewer, at most 10 visible; no house-ban line in review_edit_tool.
- [ ] Two drops at most; the payoff loudest; the lockup one hit and a tail.
- [ ] Every fast move blurred; none over 80 px/f; nothing moves while text is read.
- [ ] The name on the end card with the brief's one fact; the final frame works as the poster.

## Mix-and-match

The brief's `draw` (energy high) gives the moves; a teaser carries 6-8 of them. Never `kcut-*` strobe
cards, glitch cycles, light leaks or glass, unless they are the person's brand.

## Reference moments

cinetic's gallery briefs (local only, `~/zenvi-motion/refs2/cinetic/`): the crisp profile's denser first
6 s and the suck to silence before the turn.
