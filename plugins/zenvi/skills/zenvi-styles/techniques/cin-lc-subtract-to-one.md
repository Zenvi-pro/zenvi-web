---
id: cin-lc-subtract-to-one
kind: technique
summary: "When a crowded board needs one answer: elements drop out one by one until a single survivor stays and the world dims."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_template_tool, delete_from_timeline_tool, trim_clips_tool, set_keyframes_tool, duplicate_clips_tool, add_sfx_tool]
pace: medium
mood: [focused, decisive, clean]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-pullback-isolation, shot-spotlight-hero-card, cin-lc-one-centred-subject]
avoid_with: [shot-bento-light-up]
needs: []
drawn: cinetic
---

# Subtract to the one

cinetic `lc-subtract-to-one` · Layout and composition · workhorse · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A busy board loses its elements one by one until a single survivor remains, which either re-centres or stays exactly where it was while the world around it dims.

Use when: Isolating the deliverable, the found result or the keyword before entering its world; turning a crowded problem state into one focus.

## Build it in Zenvi

1. The busy board, 6-9 tiles: `add_motion_template_tool {"template": "grid", "position_seconds": 0, "duration_seconds": 4, "file_ids": ["<f1>", "<f2>", "<f3>", "<f4>", "<f5>", "<f6>"], "tiles": 6, "reveal": "cut"}`.
2. Staccato version: place the tiles as separate clips and delete a tile every 5-7 f (0.08-0.12 s) with `delete_from_timeline_tool`, or end each tile clip early with `trim_clips_tool` (`trim_end_seconds`); survivors re-centre by `set_keyframes_tool` on `location_x/y` with no ease (`interpolation: "constant"`). Hold the last one 17 f (0.28 s) with a +0.5 % `scale_x/y` drift.
3. Graded version: duplicate the survivor to a top track at the same position with `duplicate_clips_tool`; fade every neighbour: `set_keyframes_tool {"timeline_clip_id": "<neighbour>", "property": "alpha", "mode": "replace", "points": [{"seconds": 2.0, "value": 1}, {"seconds": 2.2, "value": 0, "ease": "ease_in_out_sine"}]}` (12 f, 0.2 s); darken the stage with a black card whose `alpha` goes 0 to 1 over 10 f (0.17 s), `ease_in_cubic`, under the survivor; hold 30 f (0.5 s).
4. Words in a line: exit in reading order, each lifting 12 px (0.011) and fading over 4 f (0.07 s) with `ease_in_cubic`, 3 f (0.05 s) apart.
5. `add_sfx_tool {"recipe": "pop", "at_seconds": 2.2, "gain_db": -12}` on the last removal.

## Timing & taste rules

- cinetic's timing (60 fps): Staccato: a removal every 5-7 f (0.12 s); last survivor held 17 f (0.28 s). Graded: neighbours fade over 12 f (0.20 s), world dims over 10 f (0.17 s), hold 30 f (0.50 s). Word exits 4 f (0.07 s) each, 3 f (0.05 s) apart (a line clears in about 12 f (0.20 s)). Re-centre 20-40 f (0.67 s) on ease_out_cubic.
- Staccato: a removal every 5-7 f (0.08-0.12 s), last survivor held 17 f (0.28 s) with a +0.5 % drift.
- Graded: neighbours fade over 12 f (0.2 s), the world dims over 10 f (0.17 s), hold 30 f (0.5 s).
- Word exits 4 f (0.07 s) each, 3 f (0.05 s) apart: a line clears in about 12 f (0.2 s).
- Re-centre the survivor over 20-40 f (0.33-0.67 s) with ease_out_cubic.

## Sound for it

One soft pop on the last removal; the removals themselves stay silent so the hold reads as a settle.

## Common mistakes

- Removing elements that were themselves the message: show them first.
- A small survivor floating lost in an empty frame: push in after isolating it.
- Tweening the staccato version: the jumps are the rhythm.
- Avoid when: The removed elements are themselves the message (show them first), or the survivor is small enough to float lost in an empty frame (push in after isolating it).

## Verified

2026-10-31, `~/zenvi-motion/fleet/artifacts/x2-cinetic/verify/cin-lc-subtract-to-one.mp4` (1280x720p60, add_motion_template_tool grid with six file_ids and reveal cut (0-4 s, 7 clips: backdrop plus six tiles entering every 0.5 s on 120 BPM), then tiles 2-6 ended at 3.00, 3.08, 3.16, 3.24 and 3.32 s with the CLI trim --edge right --to, pop at 3.32 s): the frames at 2.92-3.42 s show the board losing a tile every ~5 f until one tile remains; the survivor re-centre (constant location keyframes), hold and drift were not built; watch judge 2.4/10.

Found when rendering it (apply before building):

- Step 1: add_motion_template_tool grid works as written (template grid, file_ids, tiles 6, reveal cut) but the tiles enter on the beats about 0.5 s apart (first at 0, last at 2.5 s), so the board is only full from 2.5 s; start the removals after 2.5 s. It returns 7 clips (a grid-bg and tile-1-1 to tile-1-6 on tracks 1-7) whose ids are in the receipt's clips list.
- Step 2: to end a tile early use `zenvi trim <clip> --edge right --to <timeline s>` (tested on the receipt's tile clips; trim_clips_tool was not tried); the tile clips run past the template's duration (ends at 3.7-5.9 s for a 4 s template), so trim each to the removal time rather than counting on the template length.
- Step 2: the receipt's survivor (tile-1-1) sits at location_x -0.33, location_y -0.25 and scale 0.50; re-centring needs location_x/location_y keyframes with "interpolation": "constant" at the removal time using timeline_seconds in the points.

Translated from cinetic's technique library (`lc-subtract-to-one`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
