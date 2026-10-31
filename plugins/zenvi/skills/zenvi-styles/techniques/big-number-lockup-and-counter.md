---
id: big-number-lockup-and-counter
kind: technique
summary: "For a stat that is the story (players, views, records): a huge rolling number over a small label, landing on a hit."
categories: [gaming-montage, news-short-vertical-explainer]
tools: [add_motion_block_tool, color_grade_clip_tool, add_vignette_tool, add_sfx_tool, propose_overlay_windows_tool]
pace: fast
mood: [hype, confident, triumphant]
aspect: ["9:16", "1:1", "16:9"]
pairs_with: [tiled-video-wall, scale-jump-cut-on-sub-bass-hit, beat-locked-kinetic-type-cuts]
avoid_with: [stacked-word-flipper]
needs: []
---

# Big number lockup and counter

## What it is
A figure 22-28 % of frame height rolls through steps (0 → 62M → 146M in about
2 s) over a small mono label, while the footage keeps playing; it lands with a
hit and holds about 3 s. Community hype reels use it as a running banner; news
shorts snap it on the spoken number.

## Build it in Zenvi
```json
color_grade_clip_tool {"timeline_clip_id": "<plate>", "exposure": -0.2, "saturation": 0.85}
add_motion_block_tool {"block": "counter", "position_seconds": <t>, "duration_seconds": 3.8,
  "params": {"values": ["0", "62", "146"], "suffix": "M", "label": "MATCHES PLAYED THIS SEASON",
             "style": "odometer", "weight": 800, "accent": "<brand>"}}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": <t>, "align": "start", "duration": 1.6, "gain_db": -14}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <landing of the last value>, "gain_db": -8}
```
- `values` are the steps; the last one holds. `style: "count"` changes digits
  in place (a calmer read); `odometer` rolls wheels.
- `propose_overlay_windows_tool` finds a calm window in busy footage.
- Dark plates: dim the footage 0.2-0.5 stops and add `add_vignette_tool`
  `{"amount": 0.25}` so the white number reads; more than -0.5 stops turns the
  plate to mud (judge note).
- The angled wedge banner of the reference is not a block option; a pill
  `lower_third` or a plain counter approximates it.

## Timing & taste rules
- Number 22-28 % of height, label 2-3 % (hero:label about 10:1).
- Roll 1.5-2 s, hold the final value at least 1 s before anything leaves.
- One number per section; three counters in a row become a slideshow.
- Gag numbers ("1 MOZAMBIQUE KILL") work after two real ones.

## Sound for it
A tonal riser under the roll, a punch on the landing (8-12 dB over the bed), an
optional tick per wheel step at -20 dB.

## Common mistakes
- The counter exits the moment it lands (judge: "cuts off as soon as it
  settles"): hold 1 s.
- Label too thin over moving footage: dim or vignette the plate.

## Verified
2026-10-29: 5 s 9:16 test, odometer 0 → 62M → 146M over dimmed esports
footage, riser and punch. Contact sheet: number about 9 % of height on 9:16 at
the default size (fits the safe width), label legible. Judge (abs) 5.73: hold
the final value longer, the plate was too dark at -0.5 stops.
