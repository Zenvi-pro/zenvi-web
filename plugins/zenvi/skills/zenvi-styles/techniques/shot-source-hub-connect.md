---
id: shot-source-hub-connect
kind: technique
summary: "When many sources become one (integrations, unified inbox, one API): lines connect all at once, pulses flow into a hub."
categories: [saas-app-launch, product-launch-film, animated-explainer, brand-story-corporate, tech-review]
tools: [add_motion_block_tool, set_keyframes_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [integrated, techy, resolved]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [T062, kinetic-lower-third, shot-outline-trace-reveal]
avoid_with: [shot-cloner-depth-echo]
needs: [svg-path-write-on]
---

# Sources converge on a hub

## What it is
Two versions of "everything connects". (A) Four source nodes on the left each have a thin curve to one point on the right;
the curves draw on one after another, the nodes travel along them, shrink faster at the end ("sucked in") and vanish into
the mark, which gives a small gulp; the curves then erase from the left, leaving only the mark. (B) An old page flips 180
degrees fast to become the hub page, five app icons pop at once, five tubes connect at once, light pulses flow through
them forever. Pick one version per piece.

## Build it in Zenvi
The tool set draws neither paths nor flowing pulses (`needs: svg-path-write-on`), so build the beats from what exists:
- Hub mark: `add_motion_block_tool {"block": "logo_build", "duration_seconds": 5, "placement": "full_frame"}` or `ripple_logo`;
  the gulp is a keyframed scale on its clip: `set_keyframes_tool` `scale_x`/`scale_y` 1, 1.12 (ease_out_back, 0.1 s), 1.
- Source nodes: icons or screenshots as clips on separate tracks; `set_keyframes_tool` `location_x`, `location_y` along the
  curve in 4-5 points (ease_in_out_cubic over 1.5 s) and `scale_x`/`scale_y` 1 to 0.34 to 0 with the break at 75 % of the trip.
- Flip variant (B): `apply_motion_transition_tool {"preset": "spin", "direction": "cw", "duration": 0.6}` is the closest to the fast flip
  (not a card back); then icons all pop on the same frame (alpha and scale keyframes), then connectors.
- Connectors and pulses: no tool; the honest fallback is `hud_callouts` (`grid: none`, leader lines drawn to labels) over the nodes.
- `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <draw start>, "gain_db": -18}` per line, `pop` at the gulp.

## Timing & taste rules
- Draw-on staggered 0.045 of the shot (7 f) apart, 4 curves; over 6 the curves blur into each other.
- Convergence window 40 % of the shot, in-out cubic (never linear: that is a conveyor belt); size 44 to 15 px over the first 75 %,
  then 15 to 0 over the last 25 % (the sucked-in feel).
- Data packets run an integer number of cycles, phase offset 0.13 per lane; brightest at the middle of the path.
- Erase the lines only after all nodes are gone (12 f); mark pulse 12 %, not above 25 %.
- Variant B: flip 35 f decelerating, edge flash 2 f, then icons together, tubes together +10 f, tubes grow in 9 f. Staggering
  the connections reads as negotiating one by one; "together" is the identity of this move.
- Accent colour on the packets only; nodes stay neutral.

## Sound for it
`ui_tap` per drawn line (-18 dB), a rising `whoosh_short` under the convergence, `pop` or `impact_punch` on the mark; for
variant B a `whoosh_medium` on the flip, one `pop` for all icons, one `toggle` for all tubes.

## Common mistakes
- Fading the nodes out instead of shrinking them to zero; erasing lines before the nodes reach the hub.
- Opening mark placed on bare lines (line ends peek through the gaps): put it on an opaque disc.
- Stagger the connections in variant B; or flip only 90 degrees and pause on the edge.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft cards `shots/ui-entrance/bezier-source-converge-merge.md` and `shots/ui-entrance/integration-hub-map.md` (Apache-2.0; see ../NOTICE).
