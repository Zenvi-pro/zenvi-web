---
id: shot-multiplane-slider
kind: technique
summary: "When a flat screenshot or card set needs depth: three layers slide at 0.35x / 0.7x / 1.4x, then the hero floats up."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, video-essay-explainer]
tools: [add_clip_to_timeline_tool, add_effect_tool, set_keyframes_tool, add_kinetic_title_tool, add_sfx_tool]
pace: medium
mood: [premium, calm, tactile]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-mask-reveal, shot-pullback-isolation, cinematic-parallax, shot-brake-scroll]
avoid_with: [shot-tilted-plane-glide, shot-station-flythrough, shot-overhead-tilt-drop]
needs: [parallax-layer-camera-rig]
---

# Multiplane slider (parallax with a landing)

## What it is
A sideways pan of a page gives you "looking at a page". The same drive applied at three speeds gives depth (multiplane
camera): a defocused far page, the readable middle deck of cards, and big floating chips in front that sweep past the lens.
The slide has an end: it settles with the hero card centred, and the hero lifts. Where it shines: card decks, lists, whole-page horizontal tours.

## Build it in Zenvi
No depth-rig tool yet (`needs: parallax-layer-camera-rig`), so stack three copies and drive them by hand.
1. Far layer: `add_clip_to_timeline_tool {"file_id":"<page>","position_seconds":0,"duration_seconds":5}` on track 1, scaled up one step
   (`set_keyframes_tool property=scale_x/scale_y value 1.2`), soften: `add_effect_tool {"effect":"Blur","properties":{"horizontal_radius":5,"vertical_radius":5}}` and
   `add_effect_tool {"effect":"Saturation","properties":{"saturation":0.7}}`.
2. Middle layer: the same page (or the cards cut out as stills) on track 2, no blur; give it a soft `Shadow`
   (`add_effect_tool {"effect":"Shadow","properties":{"distance":12,"blur_radius":30,"opacity":0.35}}`).
3. Near layer: 4-6 label chips (stills or `add_title_tool` pills) on track 3, scaled 1.2x, blurred 7 px, with a deeper Shadow.
4. Drive: one total travel `D` (fraction of the frame). `set_keyframes_tool property=location_x` on each layer with `D*0.35`, `D*0.7`, `D*1.4`
   from 0.3 s to 4.3 s, `ease_in_out_cubic`; choose `D` so the target card is centred when the middle layer lands.
5. Settle: from ~8 frames after landing the hero card scales 1.035 and lifts (stronger Shadow); a pinned headline (`add_kinetic_title_tool`) stays still on top.

## Timing & taste rules
- 4-5.5 s; slide 130 f with `ease_in_out_cubic`; the sliding must end. A constant-speed tour reads as a screensaver.
- Speed ratio between layers >= 2x or it is unreadable; <= 4 layers. Back layer gets blur + desaturation + haze; no anchor = loose stickers floating.
- The reading layer is crisp, high-res, never blurred. Put blur on small elements (chips), not on a full-frame layer that changes every frame (render cost).
- Hold the poster frame >= 1 s after the lift.

## Sound for it
Barely: a soft `whoosh_long` under the slide at -26 dB, `pop` at -20 dB on the hero lift.

## Common mistakes
- Slicing the real layout into fragments; keep the page whole and cut only independent chips onto their own layers.
- Untested: tilted-parallax combinations; render a still first.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/camera/depth-layer-moves.md` (Apache-2.0; see ../NOTICE).
