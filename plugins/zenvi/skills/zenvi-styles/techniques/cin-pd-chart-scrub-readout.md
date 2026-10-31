---
id: cin-pd-chart-scrub-readout
kind: technique
summary: "When reading any point in history is the value, a cursor scrubs a chart to the point that makes the claim."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_title_tool, add_emoji_tool, add_sfx_tool, set_keyframes_tool]
pace: calm
mood: [analytic, calm, product]
aspect: ["16:9", "1:1"]
pairs_with: [kcut-count-up, cin-pd-pin-field-pullback, t052]
avoid_with: [cin-pd-terminal-burst-output, kcut-hit-fx]
needs: [data-bound-scrub-readout]
drawn: cinetic
---

# Scrub a chart with a live readout

cinetic `pd-chart-scrub-readout` · Product demo · workhorse · energy calm · formats feature, walkthrough, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The cursor glides across a chart; a hairline and a dot ride the series beneath it and a small readout shows the date and value at that point, stepping from data point to data point until it lands on the one that makes the claim.

Use when: Analytics, finance, health or monitoring products whose value is reading any point in history; a calm interaction beat after a fast one.

## Build it in Zenvi

1. The chart: `add_motion_block_tool {"block": "chart_build", "params": {"kind": "line", "title": "<metric>", "values": [<40 or more points>], "labels": ["<d1>", "..."], "highlight": <index>, "caption": "<claim>"}, "position_seconds": 0.0, "duration_seconds": 8.0}` (use 40+ points so each snap is small).
2. Hairline and dot as small clips on tracks above it (`add_title_tool` with a thin `background_color` bar; `add_emoji_tool` black circle at 0.012). The cursor glides across on a shallow arc (bow 0.05) at 6-10 px/f over 90-150 f (1.5-2.5 s) `ease_in_out_sine`: write `location_x` keyframes for the hairline and dot as stepped values (one per data point, `interpolation: "constant"`), and `location_y` on the dot to ride the series.
3. Readout card (8 px radius): `add_title_tool {"text": "<date>\n<value>", "font": "mono", "position_seconds": 1.0, "duration_seconds": 3.0}` riding the plot top edge at the cursor x with `location_x` keyframes, clamped inside the plot so it never flips sides. The value changes through `counter` rolls per index change (8 f = 0.13 s), or restyled titles stepped at the same instants.
4. Hairline and readout fade in over 6 f (0.1 s) as the cursor enters the plot. The scrub ends on the point that carries the claim: dot scale 1 to 1.25 for 2 f (0.03 s) back by tau 6 f (0.1 s), the value in the accent relaxing to ink over 24 f (0.4 s); hold there 36-48 f (0.6-0.8 s) under a 2 % breath.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": <land>, "gain_db": -22}` only on the landing.

Fallback: Binding the hairline, dot and readout to chart data needs a real chart; record the product's own chart and scrub it with a cursor_path block, or step the three overlay clips by hand as above.

## Timing & taste rules

- cinetic's timing (60 fps): Scrub 90-150 f (2.50 s) on ease_in_out_sine at 6-10 px/f (the readout never moves faster than the cursor); hairline and readout in over 6 f (0.10 s); value roll 8 f (0.13 s) per index change; landing pulse attack 2 f (0.03 s), tau 6; accent relax 24 f (0.40 s); hold on the landing point 36-48 f (0.80 s) under a 2% breath.
- Scrub 90-150 f (1.5-2.5 s) on ease_in_out_sine at 6-10 px/f; the readout never moves faster than the cursor.
- Hairline and readout in over 6 f (0.1 s); value roll 8 f (0.13 s) per index change.
- Landing pulse attack 2 f (0.03 s), tau 6 f (0.1 s); accent relax 24 f (0.4 s); hold on the landing 36-48 f (0.6-0.8 s).
- Punch in to 1.6-2x first if the readout is not legible at frame size.

## Sound for it

One ui_tap at -22 dB when the scrub lands; a continuous scrub stays silent.

## Common mistakes

- A chart with no point worth landing on.
- A readout illegible at the framing: punch in to 1.6-2x first.
- Scrubbing faster than the readout can be read.
- Avoid when: The chart has no point worth landing on, or the readout is illegible at the framing (punch in to 1.6-2x first); never scrub faster than the readout can be read.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`pd-chart-scrub-readout`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
