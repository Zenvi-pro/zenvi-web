---
id: crt-scanline-and-schematic-inserts
kind: technique
summary: "For a techy flash-cut edit: one-beat blueprint or dither inserts between live shots, RGB fringe on the live ones."
categories: [flash-cut-match-cut-edit, science-curiosity]
tools: [apply_look_tool, apply_fx_tool, detect_beats_tool, add_clip_to_timeline_tool, add_sfx_tool, add_motion_block_tool]
pace: frantic
mood: [techy, retro, glitchy]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [monochrome-to-colour-hit-flash, beat-staggered-tile-and-slice-build, scale-jump-cut-on-sub-bass-hit]
avoid_with: [tactile-plate-animation, comic-burst-insert]
needs: [crt-scanline-fx, subject-registered-graphic-overlay, datamosh-carry]
---

# CRT scanline and schematic inserts

## What it is
Between live macro shots, one-beat inserts of the same subject turned into a
blueprint, a dithered 1-bit print or a thermal map, with RGB split and a glitch
burst on each; the live shots keep a light RGB fringe. "Evolution of" and
science flash edits use it to say "this is how it works" in half a second.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_clip_to_timeline_tool {... live shots of 2 beats, inserts of 1 beat (0.4 s at 150 bpm), on the grid}
apply_look_tool {"timeline_clip_id": "<insert>", "look_id": "duotone_blue_orange"}
apply_fx_tool {"clip_id": "<insert>", "effects": [{"effect": "dither", "amount": 1, "params": {"colors": 2}},
                                                  {"effect": "chromatic_aberration", "amount": 0.8}]}
apply_fx_tool {"clip_id": "<live shot>", "effects": [{"effect": "chromatic_aberration", "amount": 0.35},
                                                     {"effect": "glitch", "amount": 0.25, "params": {"rate": 0.8}}]}
add_sfx_tool {"recipe": "glitch_burst", "at_seconds": <insert start>, "gain_db": -8}
```
- Insert looks: `duotone_blue_orange` (blueprint), `duotone_navy_red`,
  `duotone_ink_cream` (print); `halftone` FX for a newspaper screen.
- `apply_fx_tool` renders with ffmpeg: CLI or local MCP only.
- Missing: true scanlines + barrel distortion as one FX (`crt-scanline-fx`),
  guide lines/spiral registered to the subject
  (`subject-registered-graphic-overlay`; `hud_callouts` block is the
  stand-in), datamosh across the cut (`datamosh-carry`).

## Timing & taste rules
- Inserts are one beat (0.33-0.5 s), never longer; 2-4 per 10 s.
- The insert shows the same subject as the shot around it (eye → dithered eye),
  so it reads as an X-ray, not a random graphic.
- Keep one treatment family per piece (all duotones or all dithers); three
  unrelated grades read as inconsistent (judge note, pass 2).
- Live shots 2-3 beats; cut on the grid.

## Sound for it
A glitch burst on every insert at -8 dB, a dry hit on live cuts, one tail on
the last hit; master to -14 LUFS so the bursts are heard.

## Common mistakes
- Inserts that run 1 s+: they become a look, not a flash.
- Live shots slower than the inserts' rhythm (pass 1: "sluggish clock and
  turntable shots").

## Verified
2026-10-29: 9:16 tests on eye/vinyl/clock macros over the trap bed. Pass 1
(0.5 s inserts, quiet bursts): judge 4.36. Pass 2 (beat-grid shots: 2-beat
live, 1-beat inserts, three duotones + 1-bit dither, glitch on live shots,
bursts at -8): 4.73; notes: unify the insert family, end on a tail.
