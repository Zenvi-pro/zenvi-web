---
id: slow-motion-with-anchored-subject-tracking
kind: technique
summary: "When one movement is the hero (a stretch, a kick, a leap): a long slowed take with the body anchored in frame."
categories: [fitness-lifestyle]
tools: [speed_ramp_tool, set_clip_speed_tool, set_keyframes_tool, apply_fx_tool, process_clip_effect_tool]
pace: calm
mood: [graceful, focused, cinematic]
aspect: ["9:16", "16:9", "4:5"]
pairs_with: [negative-space-chapter-breath, voice-over-bed-mix-balance, soft-bloom-lifted-shadow-grade]
avoid_with: [accelerating-cut-length-ramp, sentence-split-rapid-hook]
needs: [tracked-point-hold-reframe]
---

# Slow motion with anchored subject tracking

## What it is
One continuous take, 5-9 s, slowed to 35-50 %, where a body point (pivot
foot, hips, hands) holds one screen position while the limbs sweep through
frame. The calm, held centre of an otherwise cut-heavy fitness piece.

## Build it in Zenvi
1. Slow it with a shape, not a flat factor:
   `speed_ramp_tool {"clip_id": "<take>", "preset": "hero", "slow": 0.35}`
   (normal, held slow-mo, normal; the receipt gives the new length; a 6 s
   source became 7 s). Flat: `set_clip_speed_tool {"speed": 0.4}`.
2. A slow push that keeps the anchor: `set_keyframes_tool` scale_x and
   scale_y 1.0 to 1.12 across the clip (points must stay inside the clip's new
   length; read it from the speed receipt), plus `location_x`/`location_y`
   keyframes that move against the drift so the anchor stays put.
3. Smoother than frame repeats (CLI/local only):
   `apply_fx_tool {"clip_id", "effects": [{"effect": "optical_flow_slowmo"}]}`.
4. Shaky handheld: `process_clip_effect_tool` Stabilizer first.

## Timing & taste rules
- 5-9 s; 0.35-0.5x; one per piece, after the dense section.
- The anchor point within 3 % of its start position for the whole take; true
  point tracking needs `tracked-point-hold-reframe` (missing); without it
  choose takes where the camera already tracks the body and only push.
- Footage shot at 50-60 fps or more; 24/30 fps slowed below 0.5x stutters.

## Sound for it
Music thins (pad or a single sustained note), one breath or cloth foley at
-22 dB on the peak of the move; no whooshes.

## Common mistakes
- Keyframes past the slowed clip's end (the tool refuses; read the length).
- Slow motion on a static pose: the slowness must be visible in motion.
- Cutting out at the peak of the move instead of after it lands.

## Verified
2026-10-28: 7 s stretching take (stock), `speed_ramp_tool` hero 0.35, scale
push 1.0 to 1.12, ambient bed. First script failed: scale keyframe at 8 s was
past the ramped clip (valid 0-7 s). Contact sheet: smooth push, the torso stays
centred. Watch judge motion 5, overall 4.73; fixes: a stronger first frame and
let the move land before the end.
