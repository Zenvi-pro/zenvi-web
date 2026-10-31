---
id: shot-live-chart
kind: technique
summary: "When data is the story: a live stream with one spike, a swarm of dots regrouping, or an axis that has to rescale."
categories: [map-data-explainer, video-essay-explainer, saas-app-launch, tech-review, news-short-vertical-explainer]
tools: [add_motion_block_tool, add_motion_template_tool, apply_motion_transition_tool, add_sfx_tool]
pace: medium
mood: [analytical, dramatic, precise]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-counter, kcut-count-up, shot-brake-scroll, shot-gauge-readout]
avoid_with: [kcut-strobe-cards, shot-slam-entrance]
needs: [pictogram-chart-morph, live-chart-render]
---

# Live chart moves (oscilloscope, dot swarm, axis rescale)

## What it is
Charts as plot. A) Oscilloscope stream: the line is written at a fixed point on the right while old data flows off the left; one burst (2.2x amplitude, readout jumps in accent). B) Dot swarm: 320 dots drift into three clusters (real category labels), line up as bars, then gather into a dot-matrix number; the viewer can follow one dot. C) Axis rescale shock: a growth line breaks through the chart's ceiling, the y axis snaps and re-ticks, the line settles at its true value.

## Build it in Zenvi
Real chart and real axis labels first: grey placeholder bars cannot carry the story.
- Base (any variant): `add_motion_block_tool {"block":"chart_build","position_seconds":0,"duration_seconds":6,"params":{"kind":"line","title":"Renders per minute","values":["120","180","150","240","310","1240"],"labels":["Mon","Tue","Wed","Thu","Fri","Sat"],"highlight":5,"suffix":"","caption":"+933 % vs Mon"}}` (set `kind` to `bar` or `donut` for B-style composition).
- Spike (A): `add_motion_block_tool {"block":"particle_burst","params":{"shape":"rings","origin":[{"x":0.8,"y":0.4}],"count":30,"colors":["#ff5a47"]},"position_seconds":3.2,"duration_seconds":1.2}` plus `counter` for the readout jump.
- Rescale (C): two stacked `chart_build` blocks, the second with the same earlier values but a larger last value, joined with `apply_motion_transition_tool {"preset":"flash_white","duration":0.1,"intensity":0.8}` or `shake`; the first-to-second cut is the "rescale". A true tick-by-tick re-axis is missing.
- Dots (B): not native; fall back to `chart_build kind=donut` then a `counter` for the final number.
True oscilloscope write-on, dot-swarm morph and axis-rescale animation are missing (`needs: pictogram-chart-morph, live-chart-render`). Never show three variants in one film.

## Timing & taste rules
- 5.5-6.4 s each. Highlight colour only on the event (coral spike, cobalt cluster, terracotta overshoot); grey-only reads as nothing.
- A: stream 8 px/frame, spike 2.2x with a precursor and ringing; waveform is a pure function (no random per frame); brake to true stillness after the spike and push slowly toward it. B: 320 dots of 20 px, spring stiffness 150 / damping 13, 8 f stagger per dot batch, sunflower-spiral clusters. C: overshoot ~226 px past the ceiling (80 px is not enough), 10 px shake, hold half a beat.
- Readouts and labels >= 32 px; main number 120-176 px; chart fills the frame instead of sitting in a small card.
- Every variant ends with >= 36 f of pure stillness. One spike, one rescale; repeating them makes them cheap.

## Sound for it
A: one `ui_tap`/`notification_blip` on the spike. B: `whoosh_short` per regroup. C: `riser_noise` up to the break, `swoosh_hit` on the rescale.

## Common mistakes
- Placeholder data. Use real axis, units, readouts.
- Reduced contrast between event colour and others.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/data/chart-live-moves.md` (Apache-2.0; see ../NOTICE).
