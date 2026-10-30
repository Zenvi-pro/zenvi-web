---
id: gaming-montage
kind: style
summary: "For game trailers, teasers and community hype reels: a type or world hook, a slam on the drop, onset cuts, lockup."
categories: [gaming-montage]
tools: [gather_stock_footage_tool, add_clip_to_timeline_tool, detect_beats_tool, set_keyframes_tool, color_grade_clip_tool, add_kinetic_title_tool, add_motion_block_tool, add_motion_template_tool, unify_grade_tool, add_track_tool, add_sfx_tool, automate_volume_tool, master_audio_tool, render_video, review_render_tool]
pace: fast
mood: [epic, hype, dark, triumphant]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [scale-jump-cut-on-sub-bass-hit, beat-locked-kinetic-type-cuts, big-number-lockup-and-counter, occluder-plate-wipe, tiled-video-wall, bar-phrase-and-lyric-locked-cutting, blackout-and-dead-silence-pause]
avoid_with: [tutorial-packaging-kit, tactile-plate-animation, karaoke-word-highlight-captions]
needs: [music-structure-detect, shot-length-ramp, type-strobe-sequencer, mosaic-text-reveal, occluder-plate-wipe]
---

# Gaming montage

## When to use / not
Use: a game trailer or teaser, a season/patch launch, a community milestone
reel (players, kills, hours), an esports hype cut, 15-90 s. Footage is
gameplay capture, cinematics, or (from stock) players, setups and neon
worlds. Not for: a tutorial about a game (`vfx-tutorial-breakdown` /
`talking-head-captions`), a type-only teaser with no footage
(`kinetic-type-motion-design`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-3 world (one composed wide, riser) · 3 slam on the drop (ECU on a sub) · 3-11 onset cuts, 0.4-1.6 s · 11-12 blackout · 12-15 lockup |
| 25 s | 0-3.6 world · 3.6 drop + scale jump · 4-6 beat-locked words · 6-12 montage with a stat counter · 12-16 occluder wipe into a video wall · 16-17 blackout + silence · 17-20 lockup held 3 s |
| 60 s | 0-7 cold open (atmosphere, one gag) · 7-13 drop + title slam · 13-35 development, section cards on downbeats · 35-44 escalation ladder (4 s → 0.9 s shots) · 44-46 blackout · 46-52 lockup · 52-60 stinger scene |
| 90 s | as 60 s with dialogue in the first third (score ducked hard under lines) |

The first hard change at a median 6.8 s in trailers; in a 15-25 s reel by
3-4 s. Lockup no earlier than 59 % of runtime, held 2.6-6 s.

## Shot plan
- Shot lengths form a ladder, not a constant (p90/p10 ≥ 5): long world shots,
  then 0.4-1 s inserts in the action.
- Inserts of the contact point (hands on controller, keys, a blade, boots) on
  impacts, 0.5-1.0 s each.
- A recurring motif shot (one player, a mask) returns in the escalation.
- A 9-tile wall or a counter makes the community/scale point once.

## Look & grade
Two families: dark cinematic (luma 29-57: crushed blacks, one or two story
accents such as magic blue or fire) or bright game-native (luma ~90). Two
neutrals + one or two accents; never mid-grey.
`unify_grade_tool {"look": "city_neon_cinema", "look_intensity": 0.5}` for
neon stock; lift dark close-ups 0.3 stops so they read.

## Type system
One display face, caps. Titles 15-22 % of height, numerals up to 28 %, legal
2 %. Beat-locked words: `add_kinetic_title_tool {"style": "creator",
"emphasis": [<word>], "background": <ground>}` (one centred word filling the
width), grounds inverting each beat. No type during cinematic action, no
captions. Lockup with its own sound.

## Motion & transitions
Hard cuts by default (90 %+ in cinematics). Effects only at world changes: one
occluder wipe (`occluder-plate-wipe`), one zoom-through, white/invert flash
frames on the drop and the lockup. A push-in on the opening wide.

## Sound & music
- Music-led: electro-trap, hybrid trailer or anthem at 110-150 bpm; the first
  drop placed on a picture event (`scale-jump-cut-on-sub-bass-hit`).
- Cuts follow onsets (77 %), not the grid (21 %).
- 9-13 cues/min, attached to story events (impacts, the drop, the wall, the
  lockup), impacts above the bed; whooshes a minority.
- One designed silence: music and ambience to zero for 1-4 s before the
  lockup (`blackout-and-dead-silence-pause`).
- Master -14 LUFS, true peak ≤ -1 dBTP (the community reel at +0.6 is the
  counterexample).

## Captions/VO
None, or one in-world line over silence. Dialogue trailers: score ducks hard
under lines (VO 10 dB over the bed) and returns at full level in action.

## Tool sequence
1. `gather_stock_footage_tool {"queries": ["neon city night wide", "gamer
   playing neon room", "game controller close up hands", "rgb keyboard",
   "esports tournament", "arcade lights"], "orientation": "portrait",
   "count": 16}` or the game's capture.
2. `detect_beats_tool` on the track; note the drop second.
3. `add_track_tool {"name": "Music"}`; music from `drop_source - drop_time` so
   its drop lands at the cut; `automate_volume_tool dip -8` before the drop and
   `suck_out` 150 ms at it.
4. World wide (`set_keyframes_tool` push-in 1.0 → 1.12) + `riser_noise`.
5. Drop: ECU 2 beats, `sub_drop` -5 + `impact_boom` -7.
6. 4 beat-locked words (`beat-locked-kinetic-type-cuts`), hits on every other.
7. Montage of 2-4 beat shots; `add_motion_block_tool counter` over one shot
   (`big-number-lockup-and-counter`).
8. `particle_burst` shards over the next cut (`occluder-plate-wipe`), then
   `add_motion_template_tool grid tiles 9 drift out` on the beats
   (`tiled-video-wall`), a pop per tile.
9. Black plate 1.2 s, music ended before it (silence).
10. Lockup title (creator, both words emphasised) + 3-frame white flash plate
    + boom + sub + tail; hold 3 s.
11. `unify_grade_tool`, `master_audio_tool {"preset": "social", "genre": "hype"}`,
    render, `review_render_tool` (it reports the blackout as black frames:
    intended).

## Finish checklist
- [ ] Shot-length spread p90/p10 ≥ 5; no flat cut rate.
- [ ] About 0.5 cues per cut, on events; no whoosh on every cut.
- [ ] Most cuts on onsets (check against `detect_beats_tool` strengths).
- [ ] One held silence of 1-4 s before the lockup.
- [ ] Lockup after 59 % of runtime, held 2.6 s+, with its own sound; a visual hook in the first 3-7 s.
- [ ] No full-screen rating/legal card at the start (corner badge only).
- [ ] Two neutrals + 1-2 accents; luma dark or bright, not mid-grey.
- [ ] Titles 15-22 % of height, numerals ≤ 28 %, no captions.
- [ ] -14 LUFS, true peak ≤ -1 dBTP.

## Mix-and-match
Borrow: `scale-jump-cut-on-sub-bass-hit`, `beat-locked-kinetic-type-cuts`,
`big-number-lockup-and-counter`, `occluder-plate-wipe`, `tiled-video-wall`,
`bar-phrase-and-lyric-locked-cutting`, `blackout-and-dead-silence-pause`,
`white-flash-or-light-leak-join`. Never: captions, tutorial furniture, paper
textures, a whoosh on every cut.

## Reference moments
Local only, `~/zenvi-motion/refs2/gaming-montage/`: `x99v14g@13.5` chorus-drop
cut; `x99v14g@35.8` wide → boots ECU on a sub; `x8g6n0c@50-61.8` cut-length
ladder; `1238374060725174272@64.2` blackout + silence; `x99zxki@9.4` petal
occlusion wipe; `x8oh5j5@6.8` logotype strobe → lockup; `1102569096586059779@9.9`
red chapter cards; `1102569096586059779@13.0` stat banner;
`1102569096586059779@62.1` mosaic wall.

## Example (verified)
2026-10-29, 19.8 s, 720x1280, CLI only (`.../styles/gaming-montage/`): four
beat-locked words from frame 0 over a riser ("NO / SAVES / ONE / LIFE"), a
1.6 s push-in on a lit player, the trap drop at 3.2 s on a keyboard ECU with
sub + boom + suck-out, an onset-cut montage (1-4 beats) with a 0 → 62M → 146M
counter, a shard-burst occluder into a 9-tile wall filled on half beats, a
1.2 s blackout in silence, "PLAY AGAIN" slammed with a white flash, boom, sub
and tail; `city_neon_cinema` 0.5; mastered.
Pairwise judge vs `x99zxki@3-28` (Fortnite trailer): v1 4.55 vs 7.77 (a 3.6 s
static building shot as the hook, black voids while tiles filled), v2 5.91 vs
6.82, tie (type hook at frame 0, wall on half beats). Absolute 3.91: flat,
hazy stock grades and a template-looking counter; the blackout reads as dead
air to the judge although the dossier's best pieces use it (keep it ≤ 1.2 s on
a short).
