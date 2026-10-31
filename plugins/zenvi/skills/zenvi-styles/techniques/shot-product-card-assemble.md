---
id: shot-product-card-assemble
kind: technique
summary: "When data should look extracted, not designed: a detail card fills field by field behind a cursor, price struck down."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer, ugc-ad-testimonial]
tools: [add_motion_block_tool, add_kinetic_title_tool, add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [automated, tidy, clever]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [T062, kinetic-counter, kinetic-scramble-decode]
avoid_with: [shot-list-item-entrance, shot-stack-press-count]
needs: [word-highlight-box, auto-sized-pill-title]
---

# Product card, progressively assembled

## What it is
A detail card (image, title, category pill, price, three lines of description, colour swatches, button) builds itself like a form
being filled in. A small outlined "fill cursor" hops from field to field ahead of the content, each field settling in after it;
skeleton bars fade as the real content lands. The one semantic event is the price: it appears, stays 18 f, is struck through and
shrunk, and a new accent price springs out beside it. The whole card creeps forward 3.5 % over the shot.

## Build it in Zenvi
No form-fill cursor or per-field build (`needs: word-highlight-box`, `auto-sized-pill-title`). Compose it from parts and the pointer block:
- Frame and card: a still or UI clip with the card, scaled 0.96 to 1 and `location_y` +0.03 to 0 over 14 f, then `scale_x`/`scale_y` 1 to 1.035 over the rest (`set_keyframes_tool`).
- Fields in order, one title per field on its time: `add_kinetic_title_tool {"text": "Title", "style": "editorial", "animation": "rise", "position_seconds": 0.67}`
  (title 0.67 s, pill 1.0 s, price 1.4 s, body lines 2.5 s / 2.6 s / 2.7 s, swatches 3.2 s, button 3.8 s at 30 fps); pills and swatches use `animation: pop`.
- Price downgrade: price title ends at 2.07 s; a second title "Free" with `animation: pop` starts at 2.1 s in the accent; the strike-through is a thin bar clip with
  `scale_x` 0 to 1 over 6 f at 2.07 s and the old price `scale_x`/`scale_y` 1 to 0.46 with `alpha` 1 to 0.4.
- Fill cursor: closest tool is `add_motion_block_tool {"block": "cursor_path", "params": {...}}` (an oversized pointer hovering targets with an outline), over a screenshot of the finished card.
- `add_sfx_tool`: `ui_tap` per field group (-20 dB), `pop` on pill/swatch, `toggle` on the price strike, `notification_blip` on the new price.

## Timing & taste rules
- Field spacing: 3 f inside a group (pill, text lines, swatches), 10-20 f between groups; even spacing everywhere reads as a mechanical roll call.
- Cursor hop 6 f, asymmetric in-out; under 4 f it flashes, over 10 f it trails behind the content.
- Large fields rise 10-26 px with a 6 px focus pull (14 f, expo-out); small ones (pill, swatch) pop 0.4 to 1 with one visible overshoot. Small pops, big rises.
- Hold the old price 18 f before it is demoted, or it reads as always on sale. New price spring from 1.18 to 1; it is the only large scale bounce in the shot.
- Highlight swipe over body words in 6 f, starting after the line has begun to land (a highlight before its text is an error).
- Final field lands around 4.2 s; give the viewer 1.3 s to read the whole card, do not cut that.
- One hue (the accent) for cursor, new price, chip and highlight; everything else neutral.

## Sound for it
Light `ui_tap` per field group, `pop` on pills and swatches, one `toggle` on the strike, `notification_blip` on the new price (all -20 to -16 dB).

## Common mistakes
- Hard-coded field boxes (cursor misses after a text change).
- Body copy wider than the card; price digits changing width and colliding with chips.
- Fading the whole card in (it is a form being filled, not a slide).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/ui-entrance/product-card-progressive-assemble.md` (Apache-2.0; see ../NOTICE).
