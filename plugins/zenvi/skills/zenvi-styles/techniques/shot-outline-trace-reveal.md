---
id: shot-outline-trace-reveal
kind: technique
summary: "When a card, chart or interface should be 'drawn' into existence: a pen-tip line traces it, then the content fills in."
categories: [saas-app-launch, product-launch-film, animated-explainer, brand-story-corporate, kinetic-type-motion-design]
tools: [add_motion_block_tool, add_shape_mask_tool, set_keyframes_tool, add_kinetic_title_tool, apply_look_tool, add_sfx_tool]
pace: medium
mood: [crafted, editorial, precise]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kcut-draw-on, shot-bento-light-up, kinetic-write-on]
avoid_with: [shot-source-hub-connect]
needs: [svg-path-write-on]
---

# Outline trace reveal

## What it is
Instead of flying or fading in, an element is drawn by an invisible pen. Version 1 (element): an ink line with a visible tip runs once
around a card's outline in 1.3 s, flashes darker at the closing point, then the card's own hairline border and content take over.
Version 2 (whole page): the interface is first drawn as thin blueprint lines, group by group, then a glowing vertical line sweeps left
to right and the line drawing turns into the real UI behind it. A short third use: a hand-drawn underline under one key word (18 f).

## Build it in Zenvi
There is no stroke-draw tool (`needs: svg-path-write-on`). Honest fallbacks:
- Frame wipe: the card clip with `add_shape_mask_tool {"shape": "rectangle", "width": 0.6, "height": 0.6, "feather": 0.01, "keyframes": [{"seconds": 0.4, "grow": -0.3}, {"seconds": 1.7, "grow": 0}]}`
  grows the card from a thin frame (works as "the box opens", not as a pen line).
- Blueprint then reveal (version 2): the UI clip under a second copy graded to a line-art look (`apply_look_tool`) is not a line drawing.
  Use `add_motion_block_tool {"block": "hud_callouts", "params": {"grid": "full", "title": "LAYOUT", "labels": ["Sidebar", "Header", "Cards"], "values": ["", "", ""]}}`
  for the drawn frame ticks and lines, then reveal the real UI with a left-to-right mask: `add_shape_mask_tool` on the UI clip, `keyframes` of
  `grow` from -0.5 to 0 over 1 s (88-118 f in the card).
- Underline: `add_kinetic_title_tool {"text": "100%", "style": "editorial", "animation": "typewriter"}` plus a red bar as a second clip scaled in X (`set_keyframes_tool` `scale_x` 0 to 1, `ease_out_cubic`, 0.6 s).
- `add_sfx_tool {"recipe": "swish_airy", "at_seconds": <start>, "gain_db": -20}` for the draw, `ui_tap` at the closing flash.

## Timing & taste rules
- Trace one lap in 40 f (1.3 s), ease in-out; under 28 f it does not look drawn, over 60 f it looks like loading.
- A visible pen tip is the whole idea; the line must be wider than the tip's glow (6 px line, 9.6 px tip at 1080p).
- Closing flash: 2 f at full black, 6 f back down; on white grounds darker and thicker, never glowing.
- Hand-off: line fades 56-66 f while the element's own hairline fades in; content appears after the line has closed, never before.
- Blueprint groups start staggered (20 f sidebar, 30 f top bar, 40 + 3i f cards, 52 f chart); never all at once (reads as a printer).
- Gap of 6 f between the last line and the sweep; the sweep line and the mask edge must be driven by the same value.
- Real card corners must equal the drawn outline's radius (14 px line on an 8 px card shows at the hand-off).
- One subject per call-out; a screen full of items each drawing a lap looks like a loading animation.

## Sound for it
Airy `swish_airy` for the line (-20 dB), a dry `ui_tap` on the close, `paper` or `pop` when content rises in.

## Common mistakes
- Pairing version 2 with a bento light-up in the same piece (two whole-wall reveals).
- The line geometry not matching the real layout (elements jump when the sweep passes).
- Content fading in before the outline has closed.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/ui-entrance/draw-svg-trace.md` and `shots/ui-entrance/wall-reveal-moves.md` (Apache-2.0; see ../NOTICE).
