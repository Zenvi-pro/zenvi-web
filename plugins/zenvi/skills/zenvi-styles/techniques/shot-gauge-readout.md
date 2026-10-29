---
id: shot-gauge-readout
kind: technique
summary: "When a metric should be revealed like an instrument: dials self-test to full then settle, or a tape rushes by."
categories: [saas-app-launch, tech-review, automotive-ad, product-launch-film, map-data-explainer]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [mechanical, ceremonial, precise]
aspect: ["16:9", "1:1"]
pairs_with: [kinetic-counter, kcut-count-up, shot-live-chart, shot-scan-annotate]
avoid_with: [shot-slam-entrance, shot-attention-bounce]
needs: [gauge-dial-render]
---

# Gauge readout (needle sweep self-test, tape scroll, fixed pointer)

## What it is
Reporting a number becomes a body movement of an instrument. A) Self-test: three dials; each needle whips to full scale (270 degrees), the ticks it passes light up, then a spring pulls it back to the real value; the three dials ripple left to right; the value pops under each dial on the settle and a "Checking... Ready" capsule resolves. B) Tape scroll: a full-height scale slides behind a pointer pinned to the centre line: slow crawl against the old ceiling, the ceiling breaks, a sprint (about 100 px per frame at peak) and a spring brake that overshoots and returns; the number window updates in step.

## Build it in Zenvi
No dial renderer (`needs: gauge-dial-render`). What exists:
- Tape / roll feel (B): `add_motion_block_tool {"block":"counter","position_seconds":0,"duration_seconds":5,"params":{"values":["120","240"],"suffix":" ms","style":"odometer","label":"p95 render time"}}`: the odometer wheels roll (vertical motion blur is in the block). Add a ceiling line stack: `hud_callouts` with `grid="full"` for the scale marks.
- Dial (A): draw the dial as a still (3 gauges) from your design tool; the needle is a separate PNG on its own track pivoting by `set_keyframes_tool {"timeline_clip_id":"<needle>","property":"rotation","points":[{"seconds":0.3,"value":-135},{"seconds":0.7,"value":135,"ease":"ease_out_cubic"},{"seconds":1.5,"value":<real>,"ease":"ease_out_back"}]}` with `origin_x/origin_y` keyframes at the pivot; stagger the three needles 4 f apart; values via `counter` blocks under each dial.
- Capsule: `add_kinetic_title_tool {"text":"Ready","style":"documentary","animation":"fade"}`.
Prefer an existing dial component on the real dashboard (zoom into it) before drawing a new one.

## Timing & taste rules
- A: 4.7 s; outbound 12 f `ease_out`, tick lighting follows the needle, back within 24 f, rebound ~8 degrees; three needles staggered 4 f (a copy-pasted simultaneous sweep looks cheap); value pop is on the settling frame; self-test capsule last.
- B: 5 s; sprint 22 f peak ~100 px/frame, vertical motion blur scaled to speed, brake via spring with overshoot (a straight stop wastes the "thud"); crawl against the old limit first.
- After the settle: hold >= 30 f dead still (A last dial ~66 f, B 110 f). A needle that drifts at the end looks unfinished.
- Dial needles must have overshoot; zero overshoot reads as a digital clock. Do not turn ring-progress charts into a third variant.

## Sound for it
A: `whoosh_short` (-18 dB) per needle sweep, `ui_tap` on each settle; B: low rolling `whoosh_long` (-26 dB) for the sprint, `impact_thud` (-12 dB) on the brake.

## Common mistakes
- Sweeping only to the real value: the "full-scale first, then answer" is the ceremony.
- Moving the pointer in B; the world moves, the pointer stays.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/data/gauge-readout-moves.md` (Apache-2.0; see ../NOTICE).
