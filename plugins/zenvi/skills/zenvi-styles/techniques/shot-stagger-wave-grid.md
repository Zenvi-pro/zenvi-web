---
id: shot-stagger-wave-grid
kind: technique
summary: "When a system should 'power on' or a value should spread: a grid lights from one source outward, then a return pulse."
categories: [saas-app-launch, product-launch-film, animated-explainer, map-data-explainer, brand-story-corporate]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [electric, systematic, tidy]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-counter, kinetic-emphasis-scale, T062]
avoid_with: [shot-bento-light-up]
needs: [grid-cell-reflow]
---

# Stagger wave over a grid (and over values)

## What it is
Radial wave: a 17x9 dot grid lights by distance from a source; each dot swells to 1.5x and settles to a constant glow, and a second,
bluer pulse comes back from the outer ring to the centre. "Energy spreads from a source, then answers." Value stagger: 16 bars
enter with time delay AND a gradient of values (height 92 to 32, hue 200 to 320, travel 46 to 14 px, blur 8 to 2), then a second beat
moves the origin to the centre and pulses with centre-biased amplitude (42 % in the middle, 6 % at the ends). Same index, two jobs.

## Build it in Zenvi
- Dot wave: `add_motion_block_tool {"block": "dot_grid_reveal", "position_seconds": 0, "duration_seconds": 4, "params": {"scene": "orb", "cell": 40, "dots": "accent", "resolve": false}}`
  (a dot lands, multiplies and spreads over the grid as a dot matrix; no return pulse, no custom origin).
- Bars with gradient: `add_motion_block_tool {"block": "chart_build", "duration_seconds": 5, "params": {"kind": "bar", "title": "", "values": ["92","84","76","68","60","52","44","36"], "labels": ["","","","","","","",""], "suffix": "", "highlight": -1}}`
  (bars grow from the baseline in order, labels counting up; heights supply the value gradient; colour/blur gradient and the centre-origin second beat are `needs: grid-cell-reflow`).
- Code caption of the "recipe" under the bars: `add_kinetic_title_tool {"text": "stagger from center", "style": "documentary", "animation": "typewriter"}` only for a technique demo.
- `add_sfx_tool {"recipe": "sparkle", "at_seconds": 0.3, "gain_db": -18}` at the source; a `riser_tonal` ending on the pulse.

## Timing & taste rules
- 17 columns x 9 rows (153 dots); under 8 columns the distance bands read as three rings. Wave speed factor 0.35 of the shot to the farthest ring; dot travel 0.18 (21 f).
- Overshoot = 1 + 0.5 sin(w pi): a bounce in mid-travel; 0.8 and the dots touch.
- Resting dots stay at 25 % presence (grid scale must still be legible); only the return pulse glows.
- Return wave begins at 0.62 of the shot, no earlier than 0.5 (it would overlap the tail of the first); window 0.15; peak colour a hard switch above 0.3.
- Bars: time stagger 3 f each (0.02 of the shot), travel window 0.22; in the second beat the origin moves to the centre with 4 f edge delay. If the second beat is off,
  the first beat's bars should span at least a 2.9:1 height ratio, hue span 120 degrees (under 40 or over 200 reads wrong).
- Keep brightness pulse the same for every bar (55 %); gradients of everything at once make no one a hero.
- The last 20 f are still, so the final gradient can be read; deep ground (near-black) is needed for the glow.

## Sound for it
A `sparkle` at the source, soft `ui_tap` ticks at the ring crossings (-22 dB, at most 3), `riser_tonal` into the return pulse.

## Common mistakes
- Source off-centre without recomputing the normalised distances (outer dots never light).
- Changing the dot size without its centring margin; the whole array shifts half a dot.
- Letting the dot pulse overlap the first wave's tail, or the light version on a pale ground (no glow shows).

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/ui-entrance/radial-wave.md` and `shots/ui-entrance/value-stagger-gradient.md` (Apache-2.0; see ../NOTICE).
