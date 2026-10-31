# The cinematic family: how its techniques combine

25 techniques, ids `cinematic-*`, files in `../techniques/`. They are the camera, lens, grade,
cutting and sound grammar of film, usable inside any style (trailer, travel, brand film,
documentary, wedding, automotive, music video). Read this before borrowing more than one.

## The five layers - take at most one choice per layer from the look layers

| Layer | Pick | Techniques |
| --- | --- | --- |
| 1. Grade (exactly one) | the colour story | `teal-orange`, `bleach-bypass`, `cold-thriller`, `warm-nostalgia`, `day-for-night` (a scene), `duotone` (a section) |
| 2. Texture (0-2) | the medium | `film-emulation`, `halation-bloom`, `light-leak` |
| 3. Frame (0-1, plus one reveal) | the screen shape | `anamorphic-letterbox`, `aspect-ratio-reveal` |
| 4. Camera and lens (any, sparingly) | how shots move | `push-in`, `rack-focus`, `depth-of-field`, `speed-ramp`; `parallax`, `dolly-zoom` need a clean plate (fallbacks inside) |
| 5. Cutting and sound (the structure) | how time moves | `shot-scale-grammar`, `match-on-action`, `whip-cut`, `j-l-cut`, `montage-rhythm`, `title-sequence`, `trailer-sound`, `silence-before-hit` |

Hard rules:
- One grade per piece (a second only as a deliberate section: a duotone opener, a day-for-night
  scene). Two grades stacked on the same clip always lost in testing.
- Warm treatment (`light-leak` texture, `warm-nostalgia` grade) never with a cold grade (`cold-thriller`,
  `day-for-night`, `bleach-bypass`).
- Calm grammar (`j-l-cut`, `title-sequence`, `rack-focus`, `dolly-zoom`) is not cut into a
  `montage-rhythm` fast section or across a `whip-cut`; it lives in the slow acts.
- `silence-before-hit` at most once per 20-30 s; `dolly-zoom` once per film; `aspect-ratio-reveal` once
  (plus an optional widen at the climax).

## Order of operations (one undo step each; FX renders last)

1. Cut first: shots on the music grid (`detect_beats_tool` downbeats), source windows inside the file
   length, cuts on action (`match-on-action`), scale progression (`shot-scale-grammar`). Snap every
   position and length to whole frames (beat grids are not frame multiples); otherwise neighbours end up
   a frame apart and `apply_motion_transition_tool` refuses ("no clip is cut back to back").
2. Crop-fill sources whose aspect is not the timeline's (16:9, or the 9:16 / 2.39:1 delivery the index
   lists: `set_clip_property_tool` `scale` 0 fills the timeline's own frame) before any grade.
3. Retime: `speed_ramp_tool` (changes clip lengths; do it before keyframes and FX).
4. Grade: `unify_grade_tool` with the family's look (`look`, `look_intensity` 0.4-0.85, `strength` 0.7-1.0),
   then per-look extras (`color_grade_clip_tool` wheels).
5. Camera keyframes: push-ins, punch-ins, rack focus (`add_effect_tool` Blur keyframes), weave.
6. Texture: grain (`apply_look_tool` `grain:*`), then ffmpeg FX (`apply_fx_tool` bloom / light_leak /
   chromatic_aberration) - each is a render per clip, so only on the locked cut.
7. Frame: bars on a 16:9 timeline (`add_shape_mask_tool` height 0.744, a 2.39:1 band; a 2.39:1 timeline
   needs none, and at 9:16 a 2.39:1 band is a strip: skip it) and the reveal; titles after bars so they stay inside.
8. Transitions: whips, flashes (`apply_motion_transition_tool`).
9. Sound: music clips (split for a dead stop), J/L cuts, `add_sfx_tool` cues (trailer palette), suck-outs.
10. Render with `--loudness -16` (social) and watch the whole thing; run the watch judge.

## Four verified combinations (the showcase edits)

All built only with `zenvi` CLI calls from stock footage; scripts and renders under
`~/zenvi-motion/fleet/artifacts/skc-cinematic/`.

- **Trailer** (22 s, dark city, 139.8 BPM): `cold build -> card -> tightening -> silence -> drop -> title`.
  `rack-focus` hook on an eye with a sub boom, one shot per bar (`push-in`), black `title-sequence` cards
  with `trailer-sound` booms, `montage-rhythm` act 2 (2 -> 1 beats), `silence-before-hit` (black,
  music cut), drop cut on beats with one `whip-cut`, `teal-orange` + `halation-bloom` +
  `anamorphic-letterbox` + `grain:35mm_fine`, end card on a boom.
- **Travel montage** (34 s, 132 BPM): `aspect-ratio-reveal` opener under the title, 2-bar aerials with
  `push-in`, the music's lift on a white flash, `montage-rhythm` (1 bar -> 1/2 -> 1/4), a 7 s release
  shot with a `light-leak`, warm sunlit look, bars throughout; music-led sound (riser into the release only).
- **Brand film** (31 s, one object per 2.22 s): `rack-focus` hook on a watch face, `film-emulation`
  tone + grain + halation on the hero objects, alternate `push-in`, `j-l-cut` of the turntable's own
  sound, every clip's own sound plus placed micro-sounds (paper, shutter, typing), an ambient drone
  bed at half level, cream end card.
- **Documentary open** (28 s): cold open of diegetic detail shots (`shot-scale-grammar` ECU -> WS:
  clock, calendar, sleeper, room) with an `j-l-cut` (the clock ticks on under the next shots), one
  blur dissolve at the structural joint, drone bed entering early, wides with `push-in`, restrained
  `title-sequence` after the cold open, natural grade (saturation 0.8) + `grain:16mm_classic`, no whooshes.

Watch judge (abs, 0-10) per pass, and what moved the score:

| Edit | Passes | What changed |
| --- | --- | --- |
| Trailer | 3.7 -> 5.9 -> 6.6 (v4 5.2) | dropped a flat moon opener and a CGI tunnel; titles 0.07 -> 0.12-0.16 of the short side; hook = rack focus + sub boom on frame 1. v4 (0.42 s silence, a repeated car shot instead of the mixer, rising end title) scored lower, so v3 stands |
| Travel | 4.6 -> 6.9 | only landscapes (no stray people or props), `strength` 1.0 grade, sans titles faded whole |
| Brand film | 3.8 -> 4.9 -> 8.1 | the clips' own sounds kept (watch tick, needle, cups, clock) over an ambient bed instead of a beat loop; hook moved to the watch |
| Documentary | 7.7 (v2 5.0-5.2) | v2 replaced the blur dissolve at the cold-open joint with a hard cut and moved the title: it scored lower twice, so v1 stands |

Lessons that hold across all four: sound is half the score (every edit's biggest jump was a sound
change); one subject or one theme beats variety (the judge punishes any shot that leaves the
theme); the judge's own suggested fixes are not always improvements - re-render and re-judge, keep
the better pass.

## Pairings that worked / failed in testing

- Worked: teal-orange + anamorphic + bloom (grade 7/10); trailer-sound + silence-before-hit (sound 8/10);
  j-l-cut alone (transitions 7/10); montage-rhythm with one unified grade.
- Failed: stock film LUT + bright sky (cyan), any vignette over 0.3 or feather under 0.85 (the oval
  shows - judged "heavy" four times), day-for-night on sky shots, parallax/dolly-zoom without a clean
  plate (ghost), burn light leak over a whole clip.

## Shot cards (`shot-*`) that extend this family

The `shot-*` techniques are translations of the video-shotcraft shot cards (Apache-2.0,
`~/zenvi-motion/research/ext-skills/video-shotcraft/references/shots/`; licence in the styles NOTICE).
They are mostly motion-graphics and UI shots. Ids below assume `shot-<card name>`. Timing numbers
taken from them are cited inline in the cinematic files.

| Layer | Cinematic id | Shot cards to borrow with it |
| --- | --- | --- |
| Texture | `film-emulation`, `halation-bloom`, `light-leak` | `shot-grain-dissolve`, `shot-light-play-moves`, `shot-spotlight-sweep-moves`, `shot-white-flash-logo-simplify-cut` |
| Frame | `aspect-ratio-reveal` | `shot-crane-rise-reveal`, `shot-text-as-mask` |
| Camera | `push-in`, `rack-focus`, `dolly-zoom`, `parallax`, `speed-ramp` | `shot-crash-zoom-punch`, `shot-tension-camera-moves` (pull-back isolation, bullet time), `shot-space-camera-moves`, `shot-overhead-camera-moves`, `shot-steep-tilt-glide` (3D graphics camera moves) |
| Cutting | `shot-scale-grammar`, `match-on-action`, `whip-cut`, `montage-rhythm` | `shot-rhythm-interrupt-moves` (punch-in ladder), `shot-beat-cut-moves` (flash crops), `shot-circle-match-iris`, `shot-transition-hidden-cut`, `shot-shot-transitions`, `shot-sakuga-timing-shift`, `shot-panel-grid-moves` |
| Titles and sound | `title-sequence`, `trailer-sound`, `silence-before-hit` | `shot-trailer-grammar-moves` (bumper hook), `shot-letterspace-materialize`, `shot-brand-ink-open` |

Duplicates merged (one id kept; the other should be a pointer):
- `shot-speed-ramp-freeze` -> **`cinematic-speed-ramp`** (same time-remap device; the freeze variant and
  its numbers now live in the cinematic file).
- `shot-depth-layer-moves` -> **`cinematic-parallax`** (the graphics-layer path and its layer ratios now
  live in the cinematic file).
Everything else is related, not a duplicate: the cards build UI and graphics shots, the cinematic files
treat footage, so both ids stay and point at each other.

## Gaps found (ids for GAPS.md)

`clean-plate-inpaint`, `focus-pull-between-planes`, `anamorphic-streak-flare`, `lens-flare-element`,
`film-emulation-fx`, `braam-generator`, `mask-keyframe-easing`, `title-tracking-animate`, plus existing
GAPS #9 `music-structure-detect`, #18 `shot-length-ramp`, #20 `visual-match-cut-sequencer`,
#28 `parallax-layer-camera-rig`, #32 `motion-peak-cut-snap`, #35 `photo-depth-layer-parallax`.
