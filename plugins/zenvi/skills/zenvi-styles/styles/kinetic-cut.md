---
id: kinetic-cut
kind: style
summary: "When a launch, intro, brand or data piece must hit hard in 10-30 s: one full-frame type shot a beat, every cut a hit."
categories: [kinetic-type-motion-design, product-launch-film, saas-app-launch, brand-story-corporate, map-data-explainer, tech-review, sports-hype-edit]
tools: [add_motion_block_tool, update_motion_block_tool, detect_beats_tool, add_sfx_tool, auto_sound_design_tool, master_audio_tool, review_render_tool, save_brief_tool]
pace: fast
mood: [energetic, bold, confident, rhythmic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kcut-hit-fx, kcut-slam-word, kcut-strobe-cards, kcut-assemble, kcut-draw-on, kcut-collapse-cut, kcut-flood-climax, kcut-count-up, kcut-marquee-bands, kinetic-beat-strobe, kinetic-keyword-slam, kinetic-counter]
avoid_with: [kinetic-vo-captions, kinetic-karaoke, kinetic-quote-card, cinematic-silence-before-hit]
needs: []
---

# Kinetic cut (卡点快剪)

A beat-synced quick-cut motion piece: one full-frame shot a beat or two, hard cuts with a flash, a camera punch and a
chromatic kick on every cut, motion blur, glow, huge minimal copy, a held lockup at the end. Built in one block,
`kinetic_cut_scene`, from a storyboard the motif method grows out of the subject. After Tweenkit's kinetic-cut-video
skill (MIT; see `../NOTICE`).

## When to use / not

Use for openers and title sequences, product / app / event launches, school, studio or brand intros, personal or
project intros, "year in numbers" data highlights, conference warm-ups. 10-30 s; 60 s at most (it tires).
Not for anything that must be read slowly (a tutorial, a quote, legal copy), talking-head captions, or calm brands
(spa, luxury, documentary) — use their styles. Never with VO competing for the same words.

## Structure

Shot lengths in beats on the music's grid (`detect_beats_tool`; 100-140 BPM). A rhythm curve: set-up → speed-up →
breath → climax → hold. First impact inside 0.5 s.

| Length | Set-up | Speed-up | Breath | Climax | Hold (end card) |
|---|---|---|---|---|---|
| 15 s | 0-3 s: 2 shots (2 + 4 beats) | 3-7 s: 4 shots of 1-2 beats | 7-8 s: one 2-beat shot | 8-11 s: 0.5-beat run → the climax shot (4 beats) | 11-15 s (8 beats) |
| 30 s | 0-5 s: 3 shots | 5-15 s: 8-10 shots, 1-2 beats | 15-17 s: 4 beats | 17-25 s: strobe run + climax | 25-30 s |
| 60 s | two 25 s acts, each set-up / speed-up / climax, a 4-8 beat breath between | | | | last 4-5 s |
| 90 s | too long for one block: three blocks (acts) with a breath shot of footage between | | | | |

## Shot plan

Plan with `METHOD-motif.md` (motifs, through-line, storyboard, reskin test) and save it with `save_brief_tool`. Then
write the storyboard as the block's `shots`, one line each:
`<beats> <entrance> <TEXT> [| sub] [@layout] [#ground] [+layer…] [!]`.

- Entrances (≥ 3 kinds): `slam` (stamp + echo outlines), `type` (typed with a caret), `assemble` (particles build the
  word), `mask` (accent bar wipes it on), `flip`, `stretch` (flung in, sheared, speed lines), `drop` (letters fall on
  springs), `count` (rolls the first number), `strobe` (a word per half beat), `none` (picture only).
- Layouts (none more than twice): `@center @left @right @top @bottom @bleed` (type cropped by the frame) `@diagonal
  @space` (small type, empty frame) `@split` (two grounds, the type inverted across them).
- Grounds: `#dark #light #accent #secondary` — one light or accent flood at least; the climax `!` on a ground no other
  shot uses.
- Layers = the motifs: `+scope` (signal trace), `+routes` (converging traces), `+rings` (shockwave), `+rays` (speed
  lines), `+grid` (dot grid lit by a wave), `+orbit`, `+bars` (data), `+tunnel`, `+blobs` (light), `+marquee`
  (outlined word rows), `+dial` (tick ring), `+collapse` (squash to a line before the next cut). Pick the ones that
  ARE the subject; a layer that would fit any subject fails the reskin test.

Every shot drifts (the second layer of motion) and draws an accent rule in its second half; you add the third thing
(a layer) on most shots.

## Look & grade

`look`: `clean` (no resting aberration, soft flash — premium, education, corporate), `punchy` (default), `wild`
(gaming, sports, music). Palette from the subject's materials (`palette` + `accent` / `paper` / `ink` with the brand's
exact colours); dark grounds bloom, light ones barely. Grain or LUTs only on footage around the block, never on it.

## Type system

One display face (`display_font`: `display` = condensed Anton for impact, `sans` Inter 900, `serif` Instrument Serif
for editorial or education) plus the mono sub line. The main word fills 60-95 % of the width (or is cropped on purpose
with `@bleed`); a sub line ≥ 40 px at 1080, one per shot at most. Caps for short words, sentence case for typed lines.
Copy in the subject's own words — verbs first, numbers as numbers, punctuation as design ("CUT.").

## Motion & transitions

Hard cuts only, on the beat; the block's hits do the punch-in (3.5-8 %), the shake (climax 20 px at 1080), the
aberration and the flash. Motif match cuts first (`+collapse` then a `+rings` burst; a `+scope` trace into a `+routes`
shot); a flash is the fallback. One camera grammar for the piece, three moves at least (the drift alternates direction;
`stretch` flings; `+tunnel` pushes through).

## Sound & music

Music at the block's `bpm`; the block reports a picture event on every cut (impact / whoosh), typing runs, count
ticks, the assembly's reveal and the strobe swaps, so `auto_sound_design_tool {"genre": "hype", "intensity": "hype",
"density": "every_cut", "beats": [...]}` lands a sound on each. Levels (`~/zenvi-motion/sound/CRAFT.md`): hero hits
0 to +3 LU over the bed (momentary -9…-11 LUFS), whooshes 3-6 dB under the hero, ticks and typing 12-20 dB under it, a
sub drop on the climax only, a riser or a 1-beat gap before it. Master to -14 LUFS / -1 dBTP (`master_audio_tool
{"preset": "social"}`).

## Captions/VO

None: the type is the message. A VO, if any, sits in the breath and the end card only.

## Tool sequence

```json
detect_beats_tool {"file_id": "<music>"}
save_brief_tool {"...": "the brief with motifs, through_line, storyboard, reskin, direction"}
add_motion_block_tool {"block": "kinetic_cut_scene", "placement": "full_frame", "position_seconds": 0, "duration_seconds": 15,
  "params": {"bpm": 120, "palette": "ember", "display_font": "display", "look": "punchy", "shots": [
    "2 slam ZERO / TO 25 | in 2.1 seconds @bleed +rays",
    "4 type quiet torque, all the way up | 85 Nm @left +scope",
    "2 strobe NO GAS NO NOISE NO WAIT",
    "4 count 120 KM | on one charge @right #accent +bars",
    "1 stretch LIGHTER. #secondary",
    "2 flip CITY / MODE @top +grid",
    "2 mask 21 KG | carbon frame @diagonal +routes",
    "1 none +tunnel +collapse",
    "4 assemble VOLTA 2 | the charge, made visible #light +rings !",
    "8 drop RIDE IT | preorder · spring 2027 @bottom +dial +scope"]}}
add_clip_to_timeline_tool {"file_id": "<music>", "position": 0, "track": "Music"}
auto_sound_design_tool {"genre": "hype", "intensity": "hype", "density": "every_cut", "beats": [0, 0.5, 1, "…"]}
master_audio_tool {"preset": "social"}
export_video_tool {"...": "…"}
review_render_tool {"path": "<the render>"}
```

Change one shot with `update_motion_block_tool` (one undo step, re-renders the block). The beat sum × 60 / bpm is the
natural length; the last shot holds to `duration_seconds`.

## Finish checklist

- First impact inside 0.5 s; a new shot or event every 1-2 s; any paused frame reads as a poster.
- Shot lengths vary (1 / 2 / 4 / 8 beats); `review_render_tool` shows no `uniform_shot_lengths`.
- ≥ 3 entrances, no layout more than twice, ≥ 1 light / accent / inverted flood, one climax that breaks the system.
- Half the shots carry a layer that IS the subject; reskin test ≤ 1/3 generic; open and close on the through-line.
- No `static_shot` warning (or a reason); `flat_brightness` / `flat_hue` fixed or a stated palette choice.
- A sound on every cut (`cut_without_sound` clear); climax has the sub, the end lands on the music's last hit.
- Strobe: ground flips ≤ 3 a second (the block enforces it); words held ≥ 7 frames unless repeated.
- Ends on a held lockup ≥ 1.5 s with only facts the person gave.

## Mix-and-match

Borrow: `kinetic-beat-strobe` / `kinetic-keyword-slam` (native titles when one block is too much), `kinetic-counter`,
a footage hero shot between blocks (`cinematic-push-in`, `cinematic-speed-ramp`), `3d` product turn for the climax
(`add_3d_scene_tool`), the `shot-*` openers and outros. Never combine with VO captions, karaoke, quote cards, a slow
documentary grade, or a whoosh on every word (one sound per cut, not per letter).

## Reference moments

Local only (`~/zenvi-motion/refs2/`): kinetic-type-motion-design DTUxRQ1kg-V (0.5 s median change, every change on a
hit; pattern break at 5.4 s), Student_Design_Awards (pattern break @14.2), product-launch-film mac-studio (1-3 word
spec cards, black ground, one accent), brand-story-corporate education film (warm, clean look). The method and engine
come from Tweenkit's kinetic-cut-video showreel (its demo order is not to be copied).
