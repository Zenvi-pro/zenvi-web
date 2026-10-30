---
id: flash-cut-match-cut-edit
kind: style
summary: "For experimental music edits and trailer bursts: shape match chains, flash frames on hits, vacuums, a designed end."
categories: [flash-cut-match-cut-edit]
tools: [gather_stock_footage_tool, detect_beats_tool, detect_subject_tool, align_match_cut_tool, match_cut_montage_tool, add_clip_to_timeline_tool, color_grade_clip_tool, apply_look_tool, apply_fx_tool, apply_motion_transition_tool, add_kinetic_title_tool, add_track_tool, add_sfx_tool, automate_volume_tool, master_audio_tool, render_video, review_render_tool]
pace: frantic
mood: [hypnotic, intense, surreal, rhythmic]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [monochrome-to-colour-hit-flash, crt-scanline-and-schematic-inserts, beat-staggered-tile-and-slice-build, shape-registered-match-cut, motion-pose-or-position-match-cut, accelerating-cut-length-ramp, white-flash-or-light-leak-join, blackout-and-dead-silence-pause]
avoid_with: [tutorial-packaging-kit, commentary-hits-with-dense-designed-cues, karaoke-word-highlight-captions, stacked-word-flipper]
needs: [detect-pose-anchor, composition-match-search, rotation-phase-match, action-foley-spotter, datamosh-carry]
---

# Flash-cut / match-cut edit

## When to use / not
Use: an "evolution of" or "everything is circles" reel, a music edit of a
theme, the escalation burst at the end of a trailer, a brand teaser built on
matched shapes, 10-30 s (reels) or the last 25 % of a 60-90 s trailer. The
material is chosen to match: same shape, same pose, same motion. Not for: a
story with dialogue (`movie-game-trailer`), a sports film (`sports-hype-edit`),
a type-only piece (`kinetic-type-motion-design`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-1.5 one held image (the first of the chain) · 1.5-9 match chain, one object per beat · 9-12 colour/flash pairs · 12-14 escalation (0.3-0.2 s) · 14-15 designed last frame, 0.5-1 s tail |
| 20 s | 0-3 quiet open (macro push-in, drone) · 3 a 0.2 s vacuum then the drop on a flash · 3-7 shape chain · 7-10 mono → colour pair · 10-15 escalation with schematic inserts · 15-20 the last image, title, one big hit |
| 60-90 s (trailer) | quiet cold open to 33 % · first drop at ~27 s on a picture event · title card at 40-52 % · a 0.5-1 s vacuum at 69-77 % · escalation montage to the end · last-second stinger |

The unit is the beat: at 123 bpm one object per 0.49 s; a matched shot must
stay up at least 0.4 s to read. Trailer bursts run 0.2-0.5 s.

## Shot plan
- Build chains, not shots: 6-12 round things (pupil, vinyl, clock face, ball,
  headlight, moon), or one pose across places, or one rotation direction.
- Each join passes a position/scale test (centres within 3 % of frame width)
  or is a deliberate contrast cut.
- Mostly static or slow push-in shots; the cut carries the motion.
- Close and extreme close shots dominate the chains; a wide resets between
  chains.

## Look & grade
No single look; one grade per world or section, and the grade change is the
cut's second signal (grey → colour on the beat, amber → cold). Do NOT
`unify_grade_tool` across a chain. Texture: light `chromatic_aberration`
(0.3) on live shots, grain or bloom if the whole piece gets it, one-beat
duotone/dither inserts (`crt-scanline-and-schematic-inserts`).

## Type system
Rare: at most 5 type moments, hard-snapped on a beat, 6-15 % height, a title
or a one-word hook. `add_kinetic_title_tool {"style": "creator", "animation":
"slam", "emphasis": [<word>]}`. No captions, no lower thirds.

## Motion & transitions
85 %+ hard cuts. White flash frames tied to a sound hit (1-3 frames;
`apply_motion_transition_tool flash_white` between clips, or a decaying white
plate over a title). One zoom-through or whip per section at most. Dissolves
almost never.

## Sound & music
- Phonk, trap or chopped-vocal electronic (reels); orchestral hybrid or a
  needle drop (trailers). Cut on onsets (hits, syllables, snares).
- The flash-montage palette: a ping or pop per match, pitched up the chain; a
  glitch burst on each schematic insert; ticks grouped every 2-4 cuts in fast
  runs (never a machine gun); one hero hit + long tail at the end.
- At least one sound vacuum: the whole mix out for 0.2-1 s before the biggest
  image (a short black plate + no clips on any audio track).
- Stems -14 to -18 LUFS; master -14, true peak ≤ -1 dBTP.

## Captions/VO
None, or one whispered line on a still before the burst ("Bang") with the
mix dropped out. A line start lands on a cut.

## Tool sequence
1. `gather_stock_footage_tool {"queries": ["eye close up iris", "spinning vinyl
   record", "clock face macro", "car headlights night", "basketball close up",
   "full moon"], "orientation": "portrait", "count": 16}` — one query per
   shape in the chain.
2. `detect_beats_tool` on the track; note the drop.
3. Quiet open: one macro with a `set_keyframes_tool` push-in (1.0 → 1.15),
   a drone bed (`add_track_tool {"name": "Music"}` first).
4. Vacuum: a 0.2 s black plate; the drone ends before it.
5. Chain: one clip per beat; `detect_subject_tool` per file at its in-point,
   keep boxes with `w ≥ 0.2`, then `align_match_cut_tool {"clips": [...],
   "fit": "position", "cover": "zoom"}`. Or `match_cut_montage_tool` with
   `min_frames` 10-12 and `max_frames` 14-16 for a whole chain in one call (its
   default 3-8 frames is faster than the reference rhythm; `min_frames` caps at
   12 and above `max_frames` is refused).
6. A white flash on the drop; pings per match.
7. `monochrome-to-colour-hit-flash` pair (one bar grey, flash, colour).
8. Escalation: lengths 2, 2, 1.5, 1, 1, 0.75, 0.75, 0.5, 0.5 beats; two
   duotone/dither inserts inside it.
9. Second short vacuum, then the last image held 2-3 s with the title slam,
   boom + sub + tail.
10. `master_audio_tool {"preset": "social", "genre": "flash_montage"}`, render,
    `review_render_tool`.

## Finish checklist
- [ ] Every chain join lines up (centres within 3 %), each shot ≥ 0.4 s.
- [ ] The grade changes between worlds; no unify across a chain.
- [ ] At least one 0.2-1 s sound vacuum before the biggest image, never a dead hold over 0.5 s.
- [ ] Most cuts on onsets.
- [ ] Last-quarter median shot ≤ 60 % of the first quarter's.
- [ ] Cues 0.2-0.5 per cut, grouped, one big final hit.
- [ ] ≤ 5 type moments, each hard-snapped, ≥ 6 % height.
- [ ] A designed last frame with a 0.3-1 s tail.

## Mix-and-match
Borrow: `monochrome-to-colour-hit-flash`, `crt-scanline-and-schematic-inserts`,
`beat-staggered-tile-and-slice-build`, `shape-registered-match-cut`,
`motion-pose-or-position-match-cut`, `accelerating-cut-length-ramp`,
`blackout-and-dead-silence-pause`. Never: captions, UI furniture, unified
grades on chains, a whoosh on every cut.

## Reference moments
Local only, `~/zenvi-motion/refs2/flash-cut-match-cut-edit/`: `x9wt8yc@46.5`
vacuum, `x9wt8yc@47.3` "Bang" white frame into the burst; `x9b3tjc@69.2` mix
drop-out then the dive; `1470506655871811585@28.5` rotation match;
`1470506655871811585@52.3` fall across four universes; `1612505281749217280@63.8`
escalation 1.2 → 0.3 s; `1612505281749217280@29.5` needle drop on a cut.

## Example (verified)
2026-10-29, 16.8 s, 720x1280, CLI only (`.../styles/flash-cut-match-cut-edit/`):
a 3.4 s eye macro push-in and a hand over a drone, a 0.2 s vacuum, a white
frame on the drop into a one-beat circle chain (vinyl, clock, eye) aligned
with `align_match_cut_tool`, a one-bar grey → colour dancer pair, an
escalation of 2 → 0.5 beats with two duotone/dither inserts, a second 0.2 s
vacuum, the last image with "everything MOVES" and a boom, sub and tail.
Pairwise judge vs `x9wt8yc@38-62` (Chainsaw Man trailer): v1 5.05 vs 8.09
(the chain zoomed into flat colour because `detect_subject_tool` found tiny
highlights; 0.4-0.5 s black vacuums read as dead), v2 5.77 vs 7.32, tie
(boxes filtered to `w ≥ 0.2`, `fit: position`, `cover: zoom`, 0.2 s vacuums,
a slammed creator title). Absolute 4.64: the last title is static; stock from
eight shoots does not make true shape pairs (`composition-match-search` gap).
