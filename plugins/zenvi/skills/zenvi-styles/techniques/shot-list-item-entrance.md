---
id: shot-list-item-entrance
kind: technique
summary: "When a menu or detail list should grow into the screen: rows scale in on a 10 f beat while the whole list drifts."
categories: [saas-app-launch, product-launch-film, animated-explainer, tech-review, brand-story-corporate]
tools: [add_motion_block_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [soft, clean, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-mask-reveal, T062, shot-doc-park-pill-deal]
avoid_with: [shot-stack-press-count, shot-bracket-slot-carousel]
needs: [video-card-cascade-layout]
---

# List items grow in, list drifts

## What it is
Two layers of motion that do not know about each other. Layer 1: each row of a 6-item menu enters on its own, scaling from 0.82 to 1
with a short rise and a focus pull (blur 8 px to 0), a soft 1.5 % overshoot, one every 10 f. Layer 2: the whole list drifts
upward at a constant slow speed through the entire shot, so no frame is dead. Variant (detail page): rows drop from above,
rotate flat from a 16 degree tilt and "click" into their slot, with a 2 px accent seam flashing along the bottom edge on landing.

## Build it in Zenvi
- Menu: `add_motion_block_tool {"block": "toggle_panel"}` is a ready panel whose rows enter in turn (its switches then turn on); `glass_cards` is a
  3-card version over footage. For a 6-row menu with exact control, one `add_title_tool {"text": "Home", "template": "Gray_Box_4", "position_seconds": 0.07, "duration_seconds": 3.8, "screen_position": "center"}`
  per row (rows at 10 f = 0.33 s apart), then per row `set_keyframes_tool` on `scale_x`/`scale_y` 0.82 to 1 (0.8 s, `ease_out_back`, soft), `alpha` 0 to 1 (0.4 s) and `location_y` +0.04 to 0.
- Drift: the drift is on the container; with separate row clips, add one `set_keyframes_tool` `location_y` on a parent-like cover: apply the same
  linear `location_y` curve (0.05 to -0.05 of the frame over the shot, `interpolation: linear`) to every row clip.
- Row detail variant: rows as clips with `location_y` from -0.12 to 0 (fast, `ease_in_cubic`, leaving at speed) then 4 f `scale_x`/`scale_y` press 0.995 to 1; `needs: video-card-cascade-layout` for the 3D tilt flatten.
- `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <row time>, "gain_db": -24}` only every 2nd or 3rd row.

## Timing & taste rules
- Stagger 10 f (not 4 f: that is a different "all appear" move; not 16 f: the beat falls apart); each window 24 f, so 2-3 rows are moving at once.
- Starting scale 0.82 (recognisable as a row); under 0.5 it reads as a pop-in. Start offset 44 px, smaller than the row pitch.
- Overshoot about 1.5 %: use a soft back, not a bouncy spring (six bouncing rows look cheap).
- Drift 96 px per 4 s (0.8 px/f): an order of magnitude slower than a row's entrance, else the layers merge. Same direction as the rows is fine.
- The title on the other side enters when the list is half done (46 f) - one hero first.
- Last row lands at least 30 f before the end; with more than 8 rows shorten the stagger.
- Only the current row is highlighted (solid bar + one sweep after landing).
- Detail variant: cues 12/22/31/39/46 f (gaps 10 to 7 f) and compute when the last row lands before choosing intervals.

## Sound for it
Barely any: a faint `ui_tap` (-24 dB) on every second or third row, not each; the accent seam is its own "sound". Never a pop per row.

## Common mistakes
- Drift ends at -48 px, not 0: the shot does not loop and does not match a following shot's position; add a settling curve if needed.
- Longer labels than the row width; the drift pushing first and last rows out of the safe area.
- Row positions not matching the real page slot (rows must land where they live).
- Overshoot or glow outside the rounded corners of the row.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/ui-entrance/list-reveal.md` and `shots/ui-entrance/row-embed.md` (Apache-2.0; see ../NOTICE).
