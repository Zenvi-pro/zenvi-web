---
id: kinetic-counter
kind: technique
summary: "When a number is the claim (stat, spec, price, result): it counts or rolls up to the value and holds."
categories: [tech-review, news-short-vertical-explainer, saas-app-launch, map-data-explainer, gaming-montage, fitness-lifestyle, product-launch-film]
tools: [add_motion_block_tool, add_3d_scene_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [factual, impressive, precise]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [kinetic-scramble-decode, kinetic-tracked-label, kinetic-3d-title, kinetic-vo-captions]
avoid_with: [kinetic-lyric-sync, kinetic-write-on]
needs: []
---

# Number / counter type

## What it is
A huge figure that counts or odometer-rolls from a start value to the claim (several steps allowed: 51 → 79 → 70) with a
suffix and a small mono label under it. The Swiss scale-contrast spec layer: hero number 25-45 % of frame height against
1.5-3 % labels.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "counter", "position_seconds": 0.2, "duration_seconds": 3.6,
  "params": {"values": ["0", "7450"], "suffix": "MB/s", "label": "SEQUENTIAL READ", "style": "odometer", "weight": 700, "palette": "mono"}}
add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 1.6, "gain_db": -18}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": 1.7}
```
3D: `add_3d_scene_tool {"scene": "numerals_3d"}`. Native fallback: `add_kinetic_title_tool {"text": "7450", "animation": "scramble"}`.
Leading spaces in `suffix` are dropped (" MB/s" renders "7450MB/s").

## Timing & taste rules
- Count 0.8-1.5 s, ease-out (fast start, slow last digits), then hold ≥ 1.5 s on the value.
- Land the final value on the spoken number (±2 frames) or the downbeat.
- One number per scene; round it the way it is said ("7,450", not "7450.00").
- Second layer of motion (families/kinetic.md rule 2): while the type holds, the picture keeps moving — push the
  footage or backdrop 1.0 → 1.06 over the shot with `set_keyframes_tool` on that clip (not on the title clips).

## Sound for it
Ticks under the roll (-22 dB) or a short tonal riser ending on the landing, then one punch on the final value.

## Common mistakes
- Counting a number nobody can verify (made-up stats in a real edit).
- Label as large as the number: the contrast is the design.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-counter.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-counter.mp4` and its contact sheet. Checked on the sheet: odometer rolls 0 to 7450 in about 1.5 s and holds; leading space in the suffix is dropped. Watch judge (absolute, isolated 3-5 s test): **7.3/10** overall, typography 8; its main note: "The video ends abruptly immediately upon reaching the final number without letting the viewer absorb the spec.".
