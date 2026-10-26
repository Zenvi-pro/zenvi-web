# Hype / sport reel

Very fast (a cut every 0.2-0.25 s on a 150-160 bpm track), whips and crash
zooms, speed ramps on the hero moments, strip masks and mosaics, a treated
hero shot, a hit on every cut, loud. Cars, bikes, sport, launches, events.

## Structure (9-15 s, 9:16)

| t (s) | what |
| --- | --- |
| 0-0.5 | hook: the loudest image, a `swoosh_hit` on frame 1 |
| 0.5-4 | cuts every 1/2 beat, whips in one direction |
| ~4 | velocity ramp on the hero shot (rush → near-freeze on the beat → rush) |
| 4-7 | strips / mosaic of 4-6 clips (`grid` `strips_v`, `mosaic`) |
| 7 | riser → drop: `zoom_through` into the next shot, `impact_boom` |
| last 1-2 s | logo / end word, hard stop on a hit |

## Tools

1. Assets: 10-16 clips, close and wide, all with motion: at least one
   distinct clip per 1.5 s of runtime, none back within 3 s. Music:
   aggressive trap/house 150-160 bpm.
2. Cut: `build_reel_tool` `style: "hype"`, `file_ids` in story order,
   `music_file_id`, `duration_seconds`, `hook` (2-4 words), `end_card`.
3. Hero ramp: `speed_ramp_tool` `clip_id`, `preset: "velocity"`, `hit_at` =
   a downbeat from `data.beats`, `ripple: true` (needs ~2.5x the clip's
   length in source footage).
4. Transitions: `apply_motion_transitions_tool` `track: "1"`, `style:
   "hype"` (whip, whip, crash zoom; pull-back on the last cut), one
   `direction` for the piece. One `zoom_through` (`focus_x`/`focus_y` on the
   subject) at the drop.
5. Strips: `add_motion_template_tool` `template: "grid"`, `layout:
   "strips_v"`, `tiles: 4`, `reveal: "wipe"`, `duration_seconds` 2-3, with
   `beats`; or `layout: "mosaic"`, `tiles: 6`.
6. Treated hero shot (CLI): `subject_glow_tool` `look: "thermal"` or
   `replace_background_tool` `background: "color"`; else a contrasty LUT on
   that clip only (`apply_look_tool` `look_id: "noir_era"`).
7. Look: `unify_grade_tool` first (daylight and night shots meet in the
   middle), with `look: "teal_punch"` or `"heroic_cinema"`, `look_intensity`
   0.6, leaving out the treated hero shot (`timeline_clip_ids`).
8. Sound last: `auto_sound_design_tool` `intensity: "hype"`, `beats`,
   `climax_seconds` = the drop. Check every cut has a transient;
   `add_sfx_tool` `whip` on whips it missed. Then `master_audio_tool`
   `preset: "social"`.

## Checks

Contact sheet: no shot repeats back to back, no black frames at whip peaks
(`preview_frame` 1 frame before and after a whip). Ramp: frame at `hit_at`
is the peak of the action. Loudness: music not lowered. After rendering,
`review_render_tool` on the file: no repeated shot within 3 s, ends on the
end word (not black), true peak at or under -1 dBTP.

## Pitfalls

- Mixing whip directions: one current; up only for the reveal.
- A transition on every cut: hype style already mixes; the rest are hard cuts
  with hits.
- Ramping a clip without enough source: the tool refuses or the shot gets
  shorter than planned; pick a longer clip.
