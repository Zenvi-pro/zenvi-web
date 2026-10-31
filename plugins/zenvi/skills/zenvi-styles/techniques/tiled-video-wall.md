---
id: tiled-video-wall
kind: technique
summary: "For a scale or community payoff: a 3x3 wall of clips pops in on beats while pulling out, then flashes to a card."
categories: [gaming-montage, video-essay-explainer]
tools: [add_motion_template_tool, detect_beats_tool, add_kinetic_title_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [triumphant, communal, hype]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [big-number-lockup-and-counter, beat-locked-kinetic-type-cuts, scale-jump-cut-on-sub-bass-hit]
avoid_with: [grid-cell-reflow-and-collapse, beat-staggered-tile-and-slice-build]
needs: [mosaic-text-reveal]
---

# Tiled video wall

## What it is
A 3x2, 3x3 or 4-PIP wall of clips pops in over 0.6-2.4 s (one tile per beat)
while the camera pulls out; it says "all of you" in a community reel and
"everything at once" in an essay. It ends with a white flash into a stat or
thank-you card.

## Build it in Zenvi
```json
detect_beats_tool {"file_id": "<music>"}
add_motion_template_tool {"template": "grid", "file_ids": ["<9 distinct clips>"], "position_seconds": <t>,
  "duration_seconds": 3.6, "layout": "grid", "tiles": 9, "reveal": "pop", "gutter": 6,
  "beats": [<timeline beats>], "drift": "out"}
add_kinetic_title_tool {"text": "50M PLAYERS", "position_seconds": <t + 3.6>, "duration_seconds": 2, "style": "stack",
  "animation": "pop", "emphasis": "none", "ink": "#ffffff", "background": "<brand red>", "text_size": 0.17}
add_clip_to_timeline_tool {"file_id": "<white plate>", "position_seconds": <t + 3.6>, "start_seconds": 0, "end_seconds": 0.13}
set_keyframes_tool {"timeline_clip_id": "<white plate>", "property": "alpha", "points": [{"timeline_seconds": <t + 3.6>, "value": 1}, {"timeline_seconds": <t + 3.73>, "value": 0}]}
add_sfx_tool {"recipe": "pop", "at_seconds": <each tile beat>, "gain_db": -16, "pitch": <i>, "pan": <column -0.5/0/0.5>}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": <card>, "gain_db": -6}
```
- Nine distinct clips for nine tiles (`strict_variety: true` refuses repeats).
- The white plate is a generated solid (ffmpeg `color=white`), 4 frames,
  alpha 1 → 0: a decaying flash frame over a title, where a motion transition
  cannot reach.
- A 16x16 wall that lights up through a text stencil is the missing
  `mosaic-text-reveal`; `layout: "repeat"` (one clip, 9-16 copies) is the
  closest native wall.

## Timing & taste rules
- One tile per beat, 9 beats max (3.6 s at 150 bpm); `drift: "out"` keeps the
  wall alive while it fills.
- Tiles from one world and grade; every tile should show a face or an action.
- The card after the wall: number 2x the word size, slammed with a boom; plain
  centred caps read as a placeholder (judge, pass 1).

## Sound for it
A pop per tile pitched up a semitone each and panned by column, a rising whoosh
into the flash, a boom + sub on the card (centred).

## Common mistakes
- A hard cut from the wall to the card with no flash (pass 1: "lifeless cut").
- Repeating a clip in two tiles.

## Verified
2026-10-29: 5.4-5.6 s 9:16 tests, nine stock gaming clips, `drift: "out"`,
then a red "50M PLAYERS" card. Pass 1 (hard cut to the card): 5.09. Pass 2
(4-frame white flash plate, rising whoosh, boom + sub): 5.36; the judge asks
for a bigger number than word and a scale overshoot on the card.
