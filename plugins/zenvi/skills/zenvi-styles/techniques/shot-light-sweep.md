---
id: shot-light-sweep
kind: technique
summary: "When a dark title or hero card should be lit, not animated: a spotlight swings over it, or one sheen wipes across."
categories: [kinetic-type-motion-design, brand-story-corporate, product-launch-film, movie-game-trailer, music-lyric-video]
tools: [add_kinetic_title_tool, add_title_tool, add_shape_mask_tool, set_clip_properties_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [theatrical, mysterious, premium]
aspect: ["16:9", "9:16"]
pairs_with: [kinetic-title-sequence, shot-glow-flyline, cinematic-silence-before-hit]
avoid_with: [shot-brand-frame-snap, shot-slam-entrance, shot-aurora-flip]
needs: []
---

# Light as a brush: spotlight sweep, corner reveal, sheen

## What it is
Light does the animating. A) Spotlight sweep: a title almost invisible in the dark is found by a soft light that swings over it in two damped passes, then
the aperture opens and the title holds fully lit. B) Sheen: one 45 degree band of highlight sweeps once over a dark hero card (rounded corners clip it). C) Corner
reveal: a radial light grows from a corner at constant speed until the whole screen is lit. Only works on dark grounds: light on white is invisible.

## Build it in Zenvi
Spotlight (A) from a scrim with a hole; the hole travels because the scrim clip travels.
```json
add_kinetic_title_tool {"text":"Make it count","style":"editorial","animation":"fade","emphasis":"none","text_size":0.3,"ink":"#f8efe2","background":"#1a0a0d","y":0.5,"stagger_seconds":0,"position_seconds":0,"duration_seconds":5}
add_title_tool {"template":"Solid_Color","text":" ","background_color":"#050203f7","position_seconds":0,"duration_seconds":5}   // the scrim, on the top track
add_shape_mask_tool {"clip_ids":["<scrim>"],"shape":"ellipse","x":0.5,"y":0.5,"width":0.22,"height":0.14,"feather":0.06,"outside":true}
set_keyframes_tool {"timeline_clip_id":"<scrim>","property":"scale_x","points":[{"seconds":0,"value":3}]}   // and scale_y: the scrim is 3x the frame so its edge never shows
set_keyframes_tool {"timeline_clip_id":"<scrim>","property":"location_x","points":[{"seconds":0,"value":-0.62,"ease":"ease_in_out_sine"},{"seconds":1.2,"value":0.6,"ease":"ease_in_out_sine"},{"seconds":2.4,"value":-0.35,"ease":"ease_in_out_sine"},{"seconds":3.4,"value":0,"ease":"ease_out_sine"}]}
set_keyframes_tool {"timeline_clip_id":"<scrim>","property":"location_y","points":[{"seconds":0,"value":0.03},{"seconds":0.6,"value":0},{"seconds":1.2,"value":0.03},{"seconds":1.8,"value":0},{"seconds":2.4,"value":0.03},{"seconds":3.4,"value":0}]}
set_keyframes_tool {"timeline_clip_id":"<scrim>","property":"alpha","points":[{"seconds":0,"value":1},{"seconds":3.4,"value":1},{"seconds":4.3,"value":0,"ease":"ease_in_out_sine"}]}
add_sfx_tool {"recipe":"swish_airy","at_seconds":0.6,"gain_db":-24,"pan":0.6}   // another on each return, pan flipped
```
The mask's size and feather scale with the clip: with the scrim at 3x, a 0.22-wide hole is 0.66 of the frame and `feather` 0.05-0.06 stays soft but defined (0.25 made the whole scrim translucent).
Corner reveal (C): same scrim, hole centred at a corner, `keyframes` on the mask `grow` at constant speed (`linear`) ending exactly full.
Sheen (B): a soft white bar clip (a `Solid_Color` title, `background_color` "#ffffff") rotated 25 degrees (`set_keyframes_tool property=rotation`), `set_clip_properties_tool {"timeline_clip_ids":["<bar>"],"properties":{"composite":"screen","alpha":0.5}}`, swept with `location_x` over 58-90 f (about 1 s) and clipped to the card by a rounded `add_shape_mask_tool` (`shape` rectangle, `feather` 0.01). Not rendered; remove the bar clip afterwards.

## Timing & taste rules
- 5.7 s (170 f). Contrast is the whole effect: dim title at 7 % brightness vs 100 % lit (above 15 % there is no "lighting up"). Scrim alpha 0.95+; the pass reads only when the dark text is really nearly invisible.
- Pendulum: two passes, then damp to the centre so position and speed hit zero together (a plain sine brakes hard at its fastest point); 4-10 f of filament-style flicker at the start is a nice touch. Open the aperture 20 f later (iris 360 to 1080 px, `ease_out_cubic`); settle to a soft top light.
- Corner reveal must be strictly linear and finish at the very end of the shot (a radius that is too large saturates in the first quarter and feels non-linear).
- Sheen: 115 degree band, soft width 0.14 + narrow core 0.5; one pass, then the layer is removed; the card turns 21 to 14 degrees toward the light during the pass.
- Light in total no more than twice per film; it is the fastest way to look cheap. Do not combine with a spotlight-on-card technique in the same film.
- Swing must not look linear; keep `ease_in_out_sine` on every leg.

## Sound for it
Two quiet `swish_airy` passes panned with the light (-24 dB), a very soft `sparkle` (-24 dB) as the aperture opens. Avoid a big hit: the original judge found the metallic ding generic.

## Common mistakes
- Letting the scrim edge enter the frame (scale at least 3x).
- Not removing the sheen layer after the pass.
- Using it on white or pale pictures.

## Verified
2026-10-29, CLI on generated media (no footage): scripts/shot-light-sweep.sh → shots/shot-light-sweep.mp4 (local only). Checked on the sheet: a nearly black title found by a soft light on two swings, then the scrim lifts and the title holds; the first versions kept the whole title visible because the mask feather scaled up with the scrim. Watch judge (absolute): **5.5/10**; main note: "The movement of the light is slightly mechanical with linear-feeling sweeps and noticeable banding in the dark gradients."

Adapted from video-shotcraft cards `shots/effects/light-play-moves.md` and `shots/effects/spotlight-sweep-moves.md` (Apache-2.0; see ../NOTICE).
