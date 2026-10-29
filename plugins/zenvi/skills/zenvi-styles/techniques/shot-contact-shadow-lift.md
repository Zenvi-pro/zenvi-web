---
id: shot-contact-shadow-lift
kind: technique
summary: "When one card among several must be picked out: it lifts off the table and its shadow stays behind, softer and wider."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, 3d-product-cgi-ad, animated-explainer]
tools: [set_keyframes_tool, add_clip_to_timeline_tool, add_3d_scene_tool, add_effect_tool, add_sfx_tool]
pace: calm
mood: [tactile, physical, quiet]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-card-stack-fan, T057, kinetic-lower-third]
avoid_with: [shot-cloner-depth-echo]
needs: [contact-shadow]
---

# Contact-shadow lift

## What it is
Most motion is about position; this is about body. When a card is picked out it lifts off a table seen from a slight
angle, and its shadow does not travel with it: it stays on the table, grows, softens and fades. The shadow is the proof the
card left the surface. Sweep, sweep, pick: three cards are scanned one at a time and the last one is chosen and stays in the air.

## Build it in Zenvi
No physical shadow object exists (`needs: contact-shadow`); build it as a second clip:
1. Cards as clips (or an `add_3d_scene_tool {"scene": "card_stack", "params": {"animation": "fan"}}` fan viewed from 52 degrees), one lift at a time.
2. Lift: `set_keyframes_tool` on the card's `location_y` (up about 0.05 of the frame, i.e. 40-50 px visible on 1080p) and `scale_x`/`scale_y`
   (1 to 1.05), `ease_out_back` rise 0.3 s; drop back 8 f `ease_in_cubic`, a 2 f squash to 0.99, then 5 f back to 1.
3. Shadow: a black rounded rectangle (any dark clip with `corner_radius`, `add_effect_tool` Blur on it) placed under the card on a lower track, **not** parented to it:
   keyframe its `alpha` 0.32 to 0.14 and blur 3 to 25 px (Blur effect `properties`), and its `scale_x`/`scale_y` 1 to 1.08. A second wider, fainter one (alpha 0.09 to 0.22,
   blur 14 to 54 px, offset right and down) is the ambient shadow. The card itself carries no drop shadow.
4. The selected card rises and stays up (spring), others settle back. `add_sfx_tool {"recipe": "cloth", "at_seconds": <lift>, "gain_db": -24}`
   for the lift (a soft inhale), `paper` for the touch-down.

## Timing & taste rules
- Visible lift at least 12 px on screen (28 px at 2D, 96 px translateZ at a 20-24 degree angle); anything under about 12 px is invisible. Over-do it first.
- One card in the air at a time; two lifted cards and the viewer does not know which was picked.
- The shadow lags the card a couple of frames on the way down, then sticks (1.5-2 f squash 0.99, 5 f rebound).
- The chosen card stays up for about 50 f at the end (hold); for a loop make it land too.
- Scan timing: lift 0.3 s, hold 0.5 s, drop 0.3 s per card, then the pick.

## Sound for it
A very soft `cloth` (-24 dB) on a lift, `paper` (-22 dB) on touch-down, a `pop` or `ui_tap` for the pick.

## Common mistakes
- A shadow that follows the card (reads as a glow, not a lift); box-shadow style on the card itself.
- Lift below the visibility threshold (the original 8 px was unreadable; 28 px passed).
- Lighting more than one card to "show variety".

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/element-body-moves.md` (Apache-2.0; see ../NOTICE).
