---
id: cin-dn-metric-cold-open
kind: technique
summary: "When one strong true number should earn attention before the name: open on the proof figure already moving, no title."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, apply_motion_transition_tool, automate_volume_tool, add_sfx_tool]
pace: fast
mood: [confident, abrupt]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [big-number-lockup-and-counter, circular-problem-to-proof-bookend, blackout-and-dead-silence-pause]
avoid_with: [cinematic-title-sequence, shot-brand-ink-open]
needs: []
drawn: cinetic
---

# Metric as the first statement

cinetic `dn-metric-cold-open` · Data and numbers · signature · energy high · formats launch, vertical, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The film opens on its proof number already moving, with no title and no logo, and the brand waits for the end lockup.

Use when: The product has one strong, true outcome number (users, views, savings) that should earn attention before the name does.

## Build it in Zenvi

1. Open on the number: `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 1.9, "placement": "full_frame", "params": {"values": ["2.4", "2.9"], "decimals": 1, "suffix": "M", "label": "creators joined", "style": "odometer", "weight": 800}}`. Frame 0 is already mid-count; first visible change by f2 (0.03 s); settled by f40 (0.67 s); no fade-up from black.
2. Cap height of the figure about 11 % of frame height, centred on the ground; keep the brand name and logo off screen until the end lockup.
3. Readable for at least 72 f (1.2 s) including its unit under a 2 % breath: `set_keyframes_tool {"timeline_clip_id": "<counter>", "property": "scale_x", "points": [{"seconds": 0.67, "value": 1.0}, {"seconds": 1.9, "value": 1.02}]}` (same on `scale_y`).
4. Hand off on a cut at a motion peak into the problem shot: `add_clip_to_timeline_tool {"file_id": "<problem>", "position_seconds": 1.9, "track": "1"}`, or `apply_motion_transition_tool {"preset": "whip", "track": "1", "time": 1.9, "duration": 0.15}`.
5. Mark the landing with an audio drop: `automate_volume_tool {"role": "music", "shape": "dip", "at_seconds": 0.67, "db": -18, "length_ms": 250}` and an optional freeze of at most 15 f (0.25 s); `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 0.67, "gain_db": -10}`.

## Timing & taste rules

- cinetic's timing (60 fps): First change by frame 2. Settled by frame 40. Readable for 72 f (1.20 s) (about frames 41-113). Hand-off cut near frame 113. Optional freeze of at most 15 f (0.25 s) on the landing silence.
- First change by frame 2 (0.03 s), settled by frame 40 (0.67 s), readable for 72 f (1.2 s, frames 41-113), hand-off near frame 113 (1.9 s).
- Number cap height about 11 % of frame height; add a 2 % breath push during the hold.
- Story order: metric, problem, solution, process, lockup; the logo only at the lockup.
- Audio drop on the landing frame: thin or cut the music; any designed freeze at most 15 f (0.25 s).

## Sound for it

Music dips on the landing frame (settled at 0.67 s) with one soft thud; the count itself gets its ticks from the block.

## Common mistakes

- A weak, generic or unverifiable number: do not open on it.
- Films where the mark itself must lead.
- Fading up from black: the first frame must already be moving.
- Avoid when: The number is weak, generic or can't be verified; films where the mark itself must lead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`dn-metric-cold-open`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
