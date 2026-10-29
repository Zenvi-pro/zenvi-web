---
id: shot-spotlight-hero-card
kind: technique
summary: "When one object is the film's hero: house lights drop, a spotlight searches the page, locks on a card and it lifts off."
categories: [saas-app-launch, product-launch-film, 3d-product-cgi-ad, brand-story-corporate]
tools: [add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_vignette_tool, add_sfx_tool]
pace: calm
mood: [theatrical, premium, slow]
aspect: ["16:9", "1:1"]
pairs_with: [shot-brand-ink-open, cinematic-push-in, cinematic-halation-bloom]
avoid_with: [shot-magician-card-flourish, shot-fracture]
needs: [moving-spotlight-mask]
---

# Spotlight on the hero card

## What it is
A real page screenshot, dimmed to ~6-14 % as if the house lights are off; a warm tungsten pool wanders over the page for a few stations, locks on one card and shrinks onto its
outline; the camera pushes in from the side, the card rises and hovers with a longer shadow, a champagne beam runs round its outline twice, and the card settles back onto the page
with a floating 3D caption. One hero, one complete motion arc.

## Build it in Zenvi
Dim layer over the page capture, with a hole cut by a feathered shape mask (outside kept): a dark title card as the dim, `alpha` 0.9.
```json
add_title_tool {"text": " ", "background_color": "#0e0c0aE6", "position_seconds": 0, "duration_seconds": 1.0, "template": "Bar_1"}
add_shape_mask_tool {"clip_ids": ["<dim_1>"], "shape": "ellipse", "x": 0.28, "y": 0.4, "width": 0.4, "height": 0.4, "feather": 0.25, "outside": true}
```
A mask keeps its centre, so a wandering pool = one dim clip per station (3 stations x ~0.4 s, each with its own x,y); the last dim clip is the lock: a card-shaped `rectangle` hole whose
`keyframes` [{"seconds": 1.4, "grow": 0.6}, {"seconds": 1.8, "grow": 0}] close from the pool size to the card outline, with `feather` 0.03 (`needs: moving-spotlight-mask` for one continuous moving light).
Card lift: `set_keyframes_tool` on the card clip, `scale_x/y` 1 -> 1.08 `ease_out_back` over 0.33 s, hold with a +-4 px bob (40-frame period), then 1.0 over 0.6 s; the push-in is `scale` 1 -> 2.2 on the page group
with `location_x` shifting the card to the right third. Light beam round the outline: a thin champagne outline still tracing twice via `line_trails` is the stand-in. Hold 1 s at the end.
`add_vignette_tool {"clip_ids": ["<page>"], "amount": 0.5, "feather": 0.6}` also deepens the corners.

## Timing & taste rules
- Lock to touch-down about 3.6 s (108 frames): rise 10 frames (overshoot curve 0.2, 1.25, 0.3, 1), hover 58, reseat 18, a 0.997 press on landing. A first draft is always too fast.
- The pool search is three stations, 2-3 frames of stillness between, smooth in/out; radius 400 -> 300, a 6 % pulse on lock.
- Dim to 6-10 % brightness: under that it is a dimmed page, over 0.96 neighbours vanish and the page context is lost.
- A circular pool on a card lights the middle and leaves the ends dark ("torch on a page"); on lock switch to a card-shaped soft hole so the card is evenly lit edge to edge.
- Camera: side-on (rotY ~34, rotX ~8) beats from-below; no drift after the push-in. Let the light breathe, not the camera.
- Beam laps: first 14 frames bright, second 20 frames dim; one lap reads as a blink. The beam is the hero's alone, never on the neighbours.
- The caption rides above the dimming layers in page space or it is greyed out by the dim.

## Sound for it
`impact_thud` (-14, low) on the lights dropping, `whoosh_long` (-12) on the lift, `sparkle` (-16) on the beam, `impact_punch` (-12) on the reseat.

## Common mistakes
- Many cards glinting (lights are for the hero only).
- Text in the card blurry on the push-in: shoot the page at 2x.
- Opening on a group dance of cards; start with one hero and the full arc.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/opening/spotlight-hero-card.md` (Apache-2.0; see ../NOTICE).
