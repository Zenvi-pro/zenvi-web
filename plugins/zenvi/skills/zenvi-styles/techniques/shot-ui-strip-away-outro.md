---
id: shot-ui-strip-away-outro
kind: technique
summary: "When one click ends the film: Publish is pressed, the editor evaporates layer by layer, one button becomes the logo."
categories: [saas-app-launch, product-launch-film, brand-story-corporate, animated-explainer]
tools: [set_keyframes_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [quiet, decisive, minimal]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t069, T061, shot-control-state-change]
avoid_with: [shot-outro-group-photo-launch, shot-ui-to-brand-morph, shot-grain-dissolve]
needs: []
---

# UI strip-away outro

## What it is
Subtractive ending: a pointer clicks the terminal action (Publish, Ship, Done); six whole UI blocks peel off from the outside in, every 4 frames, each drifting away from the centre while
evaporating. On a darkening ground only the pressed button remains, slides to the centre, grows 1.5x with a white halo, then fades and hands over to the logo. Publishing means complexity goes to zero.

## Build it in Zenvi
The UI must be separate layers you supply (sidebar, inspector, toolbar left/right, canvas cards, canvas base, toolbar centre, the button) placed on tracks, plus a dark ground.
```json
set_keyframes_tool {"timeline_clip_id": "<sidebar>", "property": "location_x", "ease": "ease_in_quad", "points": [{"seconds": 1.2, "value": 0}, {"seconds": 1.67, "value": -0.12}]}
set_keyframes_tool {"timeline_clip_id": "<sidebar>", "property": "alpha", "ease": "ease_in_quad", "points": [{"seconds": 1.2, "value": 1}, {"seconds": 1.67, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<button>", "property": "location_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 1.3, "value": 0.30}, {"seconds": 1.9, "value": 0}]}
set_keyframes_tool {"timeline_clip_id": "<button>", "property": "scale_x", "ease": "ease_in_out_cubic", "points": [{"seconds": 1.3, "value": 1}, {"seconds": 1.9, "value": 1.5}]}
add_motion_block_tool {"block": "logo_reveal_end", "params": {"brand": "Northfold", "cta": "", "url": "northfold.example"}, "position_seconds": 3.2, "duration_seconds": 3.0, "placement": "full_frame"}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 1.1, "gain_db": -8}
add_sfx_tool {"recipe": "whoosh_fall", "at_seconds": 1.3, "gain_db": -14}
```
Layers 2-6 the same as the sidebar, each starting 4 frames (0.13 s) after the previous, from the outside to the middle, the button's layer last; `scale_y` as `scale_x`; the button `alpha` 1 -> 0 from 3.0 to 3.4 s.
A darkening of the ground (grey -> near-black) via a dark `gradient_field` clip fading in over the canvas base's last 20 frames. The 0 -> 7 px blur on departure has no keyframe; skip it or accept a plain fade-and-drift.

## Timing & taste rules
- 144 frames: pointer arrives 34 frames, strip ~40 frames, button alone, logo, hold >= 1 s.
- Order outside to centre, one layer every 4 frames; layer duration 14 frames, ease-in (accelerating departure). Same-frame vanish is a power cut; 8 frames apart or more is slow demolition.
- Every layer must be a meaningful UI region; slicing by pixel area leaves broken half-states between steps.
- Displacement 50-140 px away from the centre, each in its own direction; a plain fade is only an opacity change. Blocks inside the canvas leave 3 frames apart, alternating +-70 px.
- The button moves first to the centre (18 frames, ease in/out) and is scaled 1.5x; the halo grows 30 -> 70 px as the ground darkens; the button is above all layers the whole time. Then fade it 12 frames and bring the logo ~10 frames later (spring, 86 -> 100 %), with no gap over ~20 frames of black.
- The pointer must leave within 10 frames of the click.
- The trigger must be terminal (Publish, Ship, Done); Save does not deserve the production.
- Use the brand's highlight colour for the button; a weak colour fails the promotion to lead.

## Sound for it
`mouse_click` at the press (-8); a single descending `whoosh_fall` (-14) across the strip; nothing during the button's hold except room tone; `impact_thud` (-10) as the logo lands.

## Common mistakes
- Letting a departing layer cross in front of the button.
- Wiping all layers together as "delete".
- Doing it as well as another sign-off in the same film.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/outro/ui-strip-away-outro.md` (Apache-2.0; see ../NOTICE).
