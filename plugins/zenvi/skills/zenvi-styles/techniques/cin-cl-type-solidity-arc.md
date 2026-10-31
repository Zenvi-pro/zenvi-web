---
id: cin-cl-type-solidity-arc
kind: technique
summary: "When a brand film moves from promise to proof: opening type is translucent white, the closing line and lockup are solid."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_title_tool, add_motion_block_tool]
pace: calm
mood: [assured, building, editorial]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-ink-resolve, cin-cl-living-stage, shot-blur-slide]
avoid_with: [cin-cl-read-state-tone-ladder]
needs: []
drawn: cinetic
---

# Type solidity arc

cinetic `cl-type-solidity-arc` · Colour and light · accent · energy calm · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The type gains body across the film. Early statements are translucent white that lets the coloured stage show through, and the closing line and lockup are solid, so the payoff reads as more certain than the promise.

Use when: Brand films and launches on a coloured or living stage, built as question to answer or promise to proof, where the closing line should feel firmer than the opening.

## Build it in Zenvi

1. Choose one alpha per act: opening 0.65, middle 0.85, end 1.0. Type is `#ffffffA6`, `#ffffffD9`, `#ffffff` (the last two hex digits are the alpha).
2. Opening line over the coloured stage: `add_title_tool {"text": "What if a film built itself?", "text_color": "#ffffffA6", "font_weight": "bold", "position_seconds": 0.5, "duration_seconds": 3, "fade_in_seconds": 0.27}`.
3. Middle act: same call, same font, size and position, `"text_color": "#ffffffD9"`.
4. Closing line and lockup: solid. `add_title_tool {"text": "Zenvi builds it.", "text_color": "#ffffff", "font_weight": "bold", "position_seconds": 9.0, "duration_seconds": 2, "fade_in_seconds": 0.27}`, then hold the lockup 90-120 f (1.5-2.0 s) at full opacity.
5. Step the value only on cuts or act changes, never inside a line.
6. The stage is a living gradient, e.g. `add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 11, "params": {"style": "orbs", "colors": ["#1d4ed8", "#0b1530"], "speed": 0.2}, "track": "1"}`.

## Timing & taste rules

- cinetic's timing (60 fps): Act values are 0.65, 0.85 and 1.0 (opening, middle, end), stepped in 0 f (0.00 s) on cuts or act changes. Each arrival's ink resolve (12-16 f (0.27 s) on ease_out_expo) lands at the act's value. The end-card line and lockup stay at 1.0 for their whole 90-120 f (2.00 s) hold.
- Act values 0.65, 0.85, 1.0, stepped in 0 f on a cut or act change.
- Each arrival's ink resolve (12-16 f = 0.2-0.27 s) lands at the act's value.
- Keep weight, size and tracking identical across acts so only confidence changes.
- Translucent acts are display type only (at least 64 px at 1080p) over stage areas darker than about luma 110.
- The end-card line and lockup stay at 1.0 for the whole 90-120 f (1.5-2.0 s) hold.

## Sound for it

None; the sound is whatever the music does under the arc.

## Common mistakes

- Neutral black or grey stages, where translucent white just reads as dim grey.
- Small UI text, films under about 10 s, or light stages where translucent ink loses contrast.
- Changing the alpha inside a line or a shot, which reads as a flicker.
- Avoid when: Neutral black or grey stages, where translucent white just reads as dim grey. Also avoid it for small UI text, in films under about 10 s, and on light stages, where translucent ink loses contrast.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-type-solidity-arc`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
