---
id: soft-bloom-lifted-shadow-grade
kind: technique
summary: "When the piece should feel warm, airy and backlit: lifted blacks, soft rolled whites, gentle bloom, grain, all clips."
categories: [food-recipe, wedding-event-film]
tools: [unify_grade_tool, color_grade_clip_tool, apply_fx_tool, apply_look_tool, add_vignette_tool, analyze_frame_colors_tool]
pace: calm
mood: [warm, cosy, nostalgic, airy]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [slow-motion-hero-passage, slow-pan-over-stills-or-documents, voice-over-bed-mix-balance]
avoid_with: [documentary-register-parody-kit, hard-cut-chapter-title-cards]
needs: []
---

# Soft bloom lifted-shadow grade

## What it is
The warm documentary food / wedding look: window light blooms softly,
shadows lift to a milky charcoal, highlights roll off instead of clipping, skin
and food stay naturally saturated, a light grain and vignette hold it together
across every clip.

## Build it in Zenvi
Per piece, in this order:
1. One world first: `unify_grade_tool {"timeline_clip_ids": [...], "reference_clip_id":
   "<best clip>", "look": "warm_correction", "look_intensity": 0.5}`.
2. Lift and roll: `color_grade_clip_tool {"timeline_clip_id", "shadows": 0.12,
   "highlights": -0.2, "contrast": -0.1}` per clip (`timeline_clip_ids` for all).
3. Bloom, gently (CLI/local FX):
   ```json
   apply_fx_tool {"clip_id": "<c>", "effects": [{"effect": "bloom", "amount": 0.3,
     "params": {"threshold": 0.75, "radius": 0.6}}]}
   ```
   On high-key footage keep `amount` ≤ 0.3 and `threshold` ≥ 0.75: at 0.45 /
   0.6 the test blew out the board and hands.
4. `apply_look_tool {"clip_ids": "<id1>,<id2>,...", "look_id": "grain:35mm_fine"}`
   (every clip in one call and one undo step; ids as one comma-separated string), `add_vignette_tool {"amount": 0.25}`.
5. Check `analyze_frame_colors_tool` on two clips: luma around 90-100 of 255,
   saturation 65-80, every clip's mean luma within 15 of the reference.

## Timing & taste rules
- Same grade on every clip including inserts; no per-shot looks.
- Shadows lifted, never crushed; whites below clip (check the brightest frame).
- Warm, not orange: skin first.

## Sound for it
No direct cue; it suits an acoustic bed and close foley (pours, chops) at or
above the bed.

## Common mistakes
- Bloom on already-bright frames: blown highlights.
- Grading one hero shot and leaving the rest raw (the judge's top note on the
  first pass: shot 2 saturated, others flat).
- `apply_look_tool` with `clip_ids` as a JSON array: refused; pass one
  comma-separated string.

## Verified
2026-10-28: 5.4 s test, chop / olive-oil pour / herbs (stock), steps 1-4 at
amount 0.45 threshold 0.6. First pass: bloom refused (`intensity` is not a
param), apply_look refused on a list. Second pass rendered; before/after frame
pair shows warmer, lifted shadows. Watch judge grade note: highlights blown on
the hands and board, so the rule above lowers bloom. Overall 3.0.
