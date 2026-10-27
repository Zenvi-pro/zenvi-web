# Hype / sport reel

Very fast (a cut every 0.2-0.3 s on a 120-160 bpm track, 4-frame bursts after
the drop), a slow-motion wind-up that rushes into the drop, a white flash and
a glitch on it, negative and glitch hits on the climax's bar lines, whips in
one direction, condensed display type that slams in, a hit on every cut,
loud, every shot in one graded world. Cars, bikes, sport, launches, events.

"Hype", "trailer", "edit to this song", "make it fast": the cut is
`build_reel_tool` first, not clips placed by hand. Hand cutting is for
fixing single shots after it.

## Structure (12-20 s)

| t | what |
| --- | --- |
| 0-1 beat | hook: the loudest image, 1-3 words in condensed capitals slamming in, a `swoosh_hit` on frame 1 |
| body | 1/2-beat cuts, a white flash where the body starts, a whip every other bar line (all the same direction) |
| 2 beats before the drop | the wind-up: one shot in slow motion that ramps into a 3x rush and lands on the cut |
| the drop (first bar line from 2/3 in) | white flash + glitch (RGB split), `impact_boom`; riser ending on it |
| climax | 1/4- and 1/2-beat bursts; on each bar line a negative frame or a glitch, alternating |
| last 2 beats | pull-back into the payoff shot, end word with hollow echo lines, hard stop on a hit |

## Tools

1. Assets: **source count 14-20 clips** (one per ~1 s of the reel), close
   and wide, all with motion, in one `gather_stock_footage_tool` call (a
   query per beat of the story: rider, engine, wheel, visor, exhaust, road;
   `orientation` the reel's). The rule is no clip
   back within 3 s: at this pace that is about one distinct clip per 0.25 s
   of the busiest 3 s (the receipt warns with the number it needs: import
   that many and rebuild with `replace: true`). Music: aggressive trap/house
   120-160 bpm with a clear drop.
2. Cut: `build_reel_tool` `style: "hype"`, `file_ids` in story order (the
   last is the payoff; leave it out and the clips that fit the look open and
   close the reel), `music_file_id`, `duration_seconds`, `hook` (1-3
   words), `end_card` (1-2 words: one line gets the echo). It does the
   accents too; read them in the receipt: `drop`, `flashes`, `transitions`
   (whips, glitch on the drop, flash_invert/glitch hits, zoom_out landing),
   `speed_ramp` (the wind-up) and `sfx_cues`. Do **not** run
   `apply_motion_transitions_tool` on top: a move on every cut is a template.
   It grades too (`grade` "auto"): every clip corrected toward one target
   and one LUT over all of them, a cool night look when the titles say night
   or the footage is dark, else teal and orange (`data.grade`). A warning
   that the titles say night over daylight footage means: import night
   footage and rebuild, or change the words.
3. No wind-up in the receipt (`speed_ramp: null`, the clip was too short):
   `speed_ramp_tool` `clip_id` of the shot before `drop`, `preset:
   "velocity"`, `hit_at` = `drop`, or pick a longer clip for that slot.
4. Strips (optional, in the body): `add_motion_template_tool` `template:
   "grid"`, `layout: "strips_v"`, `tiles: 4`, `reveal: "wipe"`,
   `duration_seconds` 1-2, with `beats`; never across the drop.
5. Treated hero shot (CLI): `subject_glow_tool` `look: "thermal"` or
   `replace_background_tool` `background: "color"`; else a contrasty LUT on
   that clip only (`apply_look_tool` `look_id: "chrome"` for a solarized
   chrome rider, `"solarize"` on a flash frame, or `"noir_era"`).
6. Look: already done by `build_reel_tool` (`data.grade`). Another look:
   rebuild with `grade` set to a LUT id (`"heroic_cinema"`); only for an
   edit cut by hand run `unify_grade_tool` with `look`, leaving out the
   treated hero shot (`timeline_clip_ids`).
7. Extra word cards (at most two before the end): `add_kinetic_title_tool`
   `{"text": "NO BRAKES", "style": "stack", "animation": "slam",
   "position_seconds": <downbeat>, "duration_seconds": 0.8}`, one or two
   words, on a downbeat.
8. Sound last: the receipt's `sound_design` call, `auto_sound_design_tool`
   `intensity: "hype"`, `density: "every_cut"`, `beats`, `climax_seconds` =
   `drop` (its receipt says how many cuts have a sound: all of them, near
   enough). `add_sfx_tool` `recipe: "glitch_burst"` at the drop if the
   receipt's glitch cue got no sound. Then `master_audio_tool` `preset:
   "social"`.
9. Review: `review_edit_tool` `pace: "fast"`. Fix every `high` and
   `medium` problem: `long-hold` (a shot over 1.5 s outside the hook and the
   end: split it or rebuild shorter), `cuts-off-beat`. `clip-back-soon` and
   `repeated-footage` are `low`: fix them too when you can (more clips,
   rebuild with `replace: true`), but they do not block. Call it again; stop
   when no `high` or `medium` problem is left.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 8 above (the receipt's `sound_design` call, `density: "every_cut"`).
2. `master_audio_tool` `{"preset": "social", "genre": "hype", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

Contact sheet: no clip back within 3 s, no black frames at whip peaks
(`preview_frame` 1 frame before and after a whip), the drop frame is the
flash, the climax shows a negative frame. Ramp: the frame 2 frames before
`drop` is a blur of motion, the frame a beat before it is slow and sharp.
Titles: condensed capitals, readable in 0.5 s. After rendering,
`review_render_tool` on the file: ends on the end word (not black), true
peak at or under -1 dBTP.

## Pitfalls

- Mixing whip directions: one current; up only for the reveal.
- A flash on every bar: flashes open sections; the climax hits are negatives
  and glitches.
- Plain bold sans titles over the footage: use the style's titles (or Anton)
  and keep them to 1-3 words.
- Ramping a clip without enough source: the tool skips the ramp and says so;
  give the wind-up slot a longer clip.
