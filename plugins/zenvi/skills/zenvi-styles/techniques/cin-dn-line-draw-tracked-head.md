---
id: cin-dn-line-draw-tracked-head
kind: technique
summary: "When a trend is the message: a line draws behind a solid head dot, accelerating then creeping to its last point."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: medium
mood: [analytical, flowing]
aspect: ["16:9", "1:1", "4:5"]
pairs_with: [kinetic-counter, t052]
avoid_with: [cin-dn-bar-sweep-lit-caps]
needs: [chart-line-head-dot]
drawn: cinetic
---

# Line chart draws with a tracking head

cinetic `dn-line-draw-tracked-head` · Data and numbers · workhorse · energy medium · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A line or stepped series draws left to right behind a solid dot at its head that the eye can follow, accelerating through the middle and creeping into its last point.

Use when: Growth, price or usage over time; any chart where the trend is the message.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same chart_build line.
2. Head dot solid with a 2 px ring in the ground colour; no blur, halo, drop shadow glow or bloom; area fill stays a single-hue opacity ramp.

**Full look** (relies on glow: only when the person's brand supplies that look):

1. `add_motion_block_tool {"block": "chart_build", "position_seconds": 1.0, "duration_seconds": 5.0, "placement": "full_frame", "params": {"kind": "line", "title": "Weekly active users", "values": ["12", "14", "13", "19", "27", "41"], "labels": ["W1", "W2", "W3", "W4", "W5", "W6"], "highlight": 5, "plate": "none", "caption": "3.4x in six weeks"}}`; the line draws across over 96 f (1.6 s), starting from rest, peaking near 29 % of the draw and creeping the last third into the final point.
2. The area under the line fades in from 18 % to 0 % opacity in the line's hue; if the block shows no fill, accept the bare line.
3. The head dot (r 6 px at 1080p with a 2 px ring in the ground colour) is not a block param: add `add_emoji_tool` with a plain dot (or a title bullet) and ride the line with `set_keyframes_tool` on `location_x` and `location_y`, `ease_in_out_sine`, points sampled from the data values, over the same 1.6 s.
4. When the head lands, the endpoint value rolls in over 14 f (0.23 s): `add_motion_block_tool {"block": "counter", "params": {"values": ["41"]}, "position_seconds": 2.5, "duration_seconds": 2.0}`.
5. Short form: 24 f (0.4 s) ease_out_expo draw.
6. `add_sfx_tool {"recipe": "riser_tonal", "at_seconds": 1.0, "gain_db": -22}`.

Fallback: If the block draws no head dot, the sampled dot keyframes carry it; if that is too fiddly, keep the plain line draw.

## Timing & taste rules

- cinetic's timing (60 fps): Full draw 96 f (1.60 s) on ease_out_cubic (peak near 29%, 3.5x the mean speed; the last 30 f (0.50 s) creep at about 2-3 px/f on a 1,400 px path). Short form: 24 f (0.40 s) on ease_out_expo, with the area fill fading in from 8 f (0.13 s) later over 16 f (0.27 s). Head peaks at 40-60 px/f at 1080p. Endpoint value rolls over 14 f (0.23 s).
- Full draw 96 f (1.6 s), head peaking at 40-60 px/f at 1080p, last 30 f (0.5 s) creep at about 2-3 px/f on a 1,400 px path.
- Short form: 24 f (0.4 s) ease_out_expo with the fill fading in 8 f later over 16 f.
- Endpoint value rolls over 14 f (0.23 s) when the head lands.
- Charts under about 400 px wide make the head read as noise.

## Sound for it

A faint rising tone along the draw, no hit; optional soft tick on the endpoint roll.

## Common mistakes

- Invented up-and-to-the-right data.
- Charts under about 400 px wide.
- Letting the head stop and restart: it must creep into the last point.
- Avoid when: Invented up-and-to-the-right data; charts under ~400 px wide, where the head reads as noise.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-line-draw-tracked-head`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
