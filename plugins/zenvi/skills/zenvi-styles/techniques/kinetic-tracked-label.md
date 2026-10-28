---
id: kinetic-tracked-label
kind: technique
summary: "When a label must stick to a moving object (car, product, player): the text rides the object across the shot."
categories: [automotive-ad, tech-review, sports-hype-edit, gaming-montage, product-launch-film, vfx-tutorial-breakdown]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [technical, precise, energetic]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-counter, kinetic-scramble-decode]
avoid_with: [kinetic-text-on-path, kinetic-echo-stack]
needs: [tracked-point-callout-pin]
---

# Text tracked to an object

## What it is
A small label (spec, name, value) pinned to a point on a moving object, often with a leader line, moving with it. No
point tracker on web/CLI/MCP (`needs: tracked-point-callout-pin`; the OpenCV tracker is desktop-only).

## Build it in Zenvi
Fallback that verifies on slow moves: read the point on 3-4 preview frames (`zenvi frame <t> --grid` or
`preview_frame` with the grid) and keyframe the label by the same offsets:
```json
add_kinetic_title_tool {"text": "LED · 2400 LM", "style": "documentary", "animation": "fade", "text_size": 0.045,
  "position_seconds": 0.2, "duration_seconds": 3.2, "y": 0.36}
set_keyframes_tool {"timeline_clip_id": "<title clip>", "property": "location_x",
  "points": [{"seconds": 0.2, "value": x0}, {"seconds": 1.7, "value": x0 - 0.04}, {"seconds": 3.2, "value": x0 - 0.05}]}
set_keyframes_tool … location_y the same way
```
(`x0`, `y0` = the title's `data.box` top-left; add the point's movement in frame fractions.) Static callouts with leader
lines on a held shot: `add_motion_block_tool {"block": "hud_callouts", "params": {"points": [...]}}`.

## Timing & taste rules
- Fallback only on slow, smooth movement (one key per 1-1.5 s); fast or shaky moves need the tracker.
- Label 2-4.5 % of frame height, mono or small sans, never the display face.
- Offset the label from the point (above-left) so it never covers the thing it names.

## Sound for it
A UI tick when the label appears (-18 dB); no whoosh with the motion.

## Common mistakes
- Faking a track on a fast pan (the label swims).
- Too many labels: 1-3 per shot.

## Verified
2026-10-28, CLI (`zenvi call`, this branch) on Pexels bench footage / generated media: `scripts/kinetic-tracked-label.sh` in the verification artifacts (`~/zenvi-motion/fleet/artifacts/skk-kinetic/`, local only) → `techniques/kinetic-tracked-label.mp4` and its contact sheet. Checked on the sheet: the label rides the approaching car from three hand-read points; fine for this slow move, would swim on a fast one. Watch judge (absolute, isolated 3-5 s test): **4.0/10** overall, typography 5; its main note: "Complete lack of audio makes the motion graphic test feel lifeless.".
