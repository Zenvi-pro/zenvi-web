---
id: shot-ui-to-brand-morph
kind: technique
summary: "When the last beat says 'the thing you used is the brand': UI collapses, dots fly out, form the mark, wordmark rises."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, animated-explainer]
tools: [set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [resolved, playful, polished]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t069, T061, shot-type-and-filter, shot-control-state-change]
avoid_with: [shot-outro-group-photo-launch, shot-ui-strip-away-outro, shot-grain-dissolve]
needs: []
---

# UI becomes the brand

## What it is
The product's own UI turns into the mark: A, an icon tilts twice in anticipation, flips edge-on to a line, and the logo opens out of that line; B, the input box sends, fills with ink,
collapses to a vertical bar, and three more pieces drop into dashed slots to complete the mark. Both end in the same lockup: the mark slides aside, the name lands letter by letter, a short
tagline fades in. An audience reads "what I was using is the brand".

## Build it in Zenvi
Verified recipe (the build-up of dots into a mark is the `logo_build` block, the UI collapse is native keyframes):
```json
set_keyframes_tool {"timeline_clip_id": "<ui_clip>", "property": "scale_x", "ease": "ease_in_cubic", "points": [{"seconds": 0.8, "value": 1}, {"seconds": 1.4, "value": 0.04}]}
set_keyframes_tool {"timeline_clip_id": "<ui_clip>", "property": "scale_y", "ease": "ease_in_cubic", "points": [{"seconds": 0.8, "value": 1}, {"seconds": 1.4, "value": 0.04}]}
set_keyframes_tool {"timeline_clip_id": "<ui_clip>", "property": "alpha", "ease": "ease_in", "points": [{"seconds": 1.15, "value": 1}, {"seconds": 1.5, "value": 0}]}
add_motion_block_tool {"block": "logo_build", "params": {"name": "northfold", "tagline": "motion & identity", "mark": "stack", "colors": ["#e8a33d", "#3b6cf6", "#f4f1ea", "#d9482b"]},
  "position_seconds": 1.2, "duration_seconds": 4.4, "placement": "full_frame"}
add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 1.45, "gain_db": -10}
add_sfx_tool {"recipe": "impact_thud", "at_seconds": 3.1, "gain_db": -6}
add_sfx_tool {"recipe": "sparkle", "at_seconds": 3.8, "gain_db": -14}
```
Variant A with the user's own icon file: `logo_reveal_end {"brand": "...", "logo": "<file_id>", "cta": "...", "url": "..."}` opens the mark through an iris and slides the wordmark out. For a flip
use `scale_x` 1 -> 0.04 (`ease_in_cubic`, 12 frames) on the icon and swap clips on the thinnest frame. The big-ring-to-mark lockup also uses this tail: ring scale 5.4 -> 1 in 0.8 s
(`ease_in_out_cubic`) with a +6 % overshoot, then the lockup.

## Timing & taste rules
- A: anticipation 12-34 frames, tilts -12 / +14 / -18 degrees to 0 (growing, so it reads as a wind-up), then a 12-frame accelerating flip to 0.04 wide with two ghost trails; swap the shape on the thinnest frame (any earlier shows two shapes).
  The new mark opens on a spring (damping 11, stiffness 130) with overshoot; a cut or slash follows 7 frames later as a second beat.
- B: sending is a 20-frame pointer move, the text flies out accelerating in 11 frames; ink fills as a circle wipe from the button (never an opacity fill, which passes through grey); the five size/position quantities of the box
  share one spring (damping 15, stiffness 95); the other pieces land 58 / 72 / 86 frames, 14 apart, from 760 px off-frame, each preceded by a dashed slot outline 10 frames earlier. Use 3-4 pieces, not particles.
- Lockup: mark moves left over ~18 frames to make room (by half the lockup width), letters 2.6 frames apart over 12 frames each (scale 1.9 -> 1 with blur 14 -> 0), tagline fades whole 0.72-0.84 of the clip, the ring-to-mark brake ends settled within 0.25 s.
- Hold the final lockup for at least a second.
- Do not run other animations during the morph. Mark and ring must not rotate together; the mark layer scales only.
- Swap to the final single-path mark once it is assembled so anti-aliased seams do not leave a 1 px step.

## Sound for it
A: a `whoosh_short` on the flip and a soft `pop` on the open. B: a `pop` (-12) per piece, `impact_thud` (-6) on lock. Silence under the wordmark except one `sparkle` (-14).

## Common mistakes
- Letting the collapsing UI sit over black (the project ground shows when it shrinks; put a ground clip of the end-card colour under it).
- Overlapping the closing with another sign-off (pick one: morph, group photo or strip-away).
- A lockup that moves after landing.

## Verified
2026-10-29, CLI on a generated light dashboard mock: scripts/shot-ui-to-brand-morph.sh → shots/shot-ui-to-brand-morph.mp4 (local only). Checked on the sheet: UI shrinks to a point (black ground visible around it), four dots fly in on arcs, form the stacked mark, the mark locks and slides left, "northfold" rises letter by letter and the tagline lands. Watch judge (absolute): **8.1/10**; main note: "The kinetic choreography and sound sync from the UI collapse into the brand mark are exceptionally executed... The only minor shortcomings are low subtitle contrast and a slightly static final hold."

Adapted from video-shotcraft cards `shots/outro/ui-to-brand-morph.md` and `shots/outro/logo-shrink-wordmark-lockup.md` (Apache-2.0; see ../NOTICE).
