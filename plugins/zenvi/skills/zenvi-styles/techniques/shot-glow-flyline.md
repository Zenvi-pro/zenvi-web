---
id: shot-glow-flyline
kind: technique
summary: "When a dark scene shows data moving between cards: drifting light behind glass, a glowing arc flies card to card."
categories: [saas-app-launch, brand-story-corporate, product-launch-film, map-data-explainer, tech-review]
tools: [add_motion_block_tool, apply_fx_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [dark, premium, flowing]
aspect: ["16:9"]
pairs_with: [shot-light-sweep, shot-live-chart, shot-scan-annotate, kinetic-lower-third]
avoid_with: [shot-aurora-flip, shot-brand-frame-snap, shot-riso-misregistration]
needs: [svg-path-write-on]
---

# Glow orbs and fly-lines (ambient, data flow, relay)

## What it is
Light as a second brush, in a dark scene only (white grounds hide glow). A) Ambient: three big soft blobs drift behind a frosted-glass card; colour tints through the glass and the card's edge brightens as the nearest blob approaches. B) Fly-line: a glowing arc shoots from card A to card B with a bright head and fading tail; the landing card pulses its outline. C) Relay: when the line lands, the blob behind that node surges on the same frame, so the background and the event answer each other. Three or more lines in a row: use C, not B.

## Build it in Zenvi
- Ambient + frosted cards: `add_motion_block_tool {"block":"gradient_field","params":{"style":"orbs","colors":["#16c6c0","#1a3f8f","#ff6b57"],"speed":0.6,"grain":true},"duration_seconds":5.7,"placement":"full_frame"}`
  then `add_motion_block_tool {"block":"glass_cards","params":{"headline":"One place for *everything*","cards":["Inbox","Calendar","Files"],"details":["12 new","3 today","Syncing"],"click":-1},"position_seconds":0,"duration_seconds":5.7,"placement":"over_video"}`. The glass blurs the blobs behind it for real.
- Fly-line: no arc tool (`needs: svg-path-write-on`; `line_trails` draws generative figures, not card-to-card arcs). Closest: a thin white bar with a soft glow as a still, moved by `set_keyframes_tool` (`location_x`, `location_y`, `rotation` over 22 f, `ease_out_cubic`) along the line between card centres, plus a short `echo` trail: `apply_fx_tool {"clip_id":"<bar>","effects":[{"effect":"echo","params":{"style":"trails"},"amount":0.6}]}`.
- Landing pulse: `add_motion_block_tool {"block":"particle_burst","params":{"shape":"rings","count":24,"origin":[{"x":0.72,"y":0.5}],"rings":true,"colors":["#7ad9ff"]},"position_seconds":2.9,"duration_seconds":1.0}`.
- Relay: a second `gradient_field` is not needed; keyframe the blob via `set_keyframes_tool property=alpha` on a duplicated field clip (0.5 to 1.0 over 5 f at the landing frame, back in 15 f) so the surge and the ring share one frame constant.

## Timing & taste rules
- Ambient 170 f (5.7 s); blobs 760-1200 px, peaks at 0.55 / 0.5 / 0.42, drift 280-300 px with unequal periods 96-150 f (equal periods read as a shaking frame). Converge with `ease_out_sine` over 115-145 f and freeze; the last 25 f are still. A hard stop reads as a freeze.
- Glass card needs real backdrop blur (44 px, saturation 1.5); its ancestors must not fade or filter or the blobs vanish from the glass: fade in the glass itself.
- Fly-line: 22 f growth `ease_out_cubic`, head r 7 px + 40 px halo + 9-point tail only while growing; lands with outline pulse 6 f out, 12 f decay to 0.25; whole event quiet by frame 86 of 140. Dark-scene line: 3.5 px white core + 7 and 18 px indigo glow; segmented, butt-capped, or tails turn into bead strings.
- Relay: shared surge constant: blob 1 + 1.6*surge, 12 % bigger, 5 f up, 15 f down. A 2-frame offset and the answering effect is gone. Event layer ends first, ambient layer freezes last.
- One dark scene per film. Cut in and out through a soft transition (see motion transitions), not a hard light-to-dark cut.

## Sound for it
Ambient silent. Each landing a soft `ui_tap` or `pop` (-22 dB); relay adds a `sparkle` (-26 dB) on the same frame.

## Common mistakes
- White line on a pale ground: invisible (use a dark underlay line).
- Calm drift that stops dead.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/effects/glow-flyline-moves.md` (Apache-2.0; see ../NOTICE).
