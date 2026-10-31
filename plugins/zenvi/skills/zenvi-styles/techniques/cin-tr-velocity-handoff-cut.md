---
id: cin-tr-velocity-handoff-cut
kind: technique
summary: "When a cut joins two moving shots: the first speeds up and cuts on its fastest frame, the next opens moving and brakes."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [momentum, flowing, clean]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [whip-and-match-cut-chain, kcut-hit-fx, cin-tr-scale-through-cut]
avoid_with: [blackout-and-dead-silence-pause]
needs: []
drawn: cinetic
---

# Velocity handoff cut

cinetic `tr-velocity-handoff-cut` · Transition · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The outgoing shot speeds up in one direction and is cut on its fastest frame. The next shot opens already moving the same way and brakes to rest, so momentum runs straight through the edit.

Use when: Most cuts between moving shots: feature-to-feature edits, montages, chapter changes, and any film that must never stop. Velocity-matched cuts are exempt from the two-uses-per-type limit.

## Build it in Zenvi

1. Pick the cut time `T` on a beat (`detect_beats_tool`), clip A ends at `T`, clip B starts at `T` (same track).
2. Outgoing speeds up over its last 20 f (0.33 s): `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "location_x", "mode": "replace", "points": [{"seconds": <T-0.33>, "value": 0}, {"seconds": <T>, "value": -0.16, "ease": "ease_in_cubic"}]}`. That ends near 30-40 px/f at 1080p (~0.016-0.021 of the frame width per frame).
3. Incoming opens moving the same way at 1.0-1.5x that speed and brakes: `set_keyframes_tool {"timeline_clip_id": "<B>", "property": "location_x", "mode": "replace", "points": [{"seconds": <T>, "value": 0.21}, {"seconds": <T+1.0>, "value": 0, "ease": "ease_out_expo"}]}` (about 400 px of travel, 45-90 f / 0.75-1.5 s).
4. Smear only the fast frames: `apply_fx_tool {"clip_id": "<A>", "effects": [{"effect": "directional_blur", "amount": 0.5, "params": {"angle": 0}, "start": <len-0.15>, "end": <len>}]}` and the mirror on B for its first 0.15 s.
5. One-click version: `apply_motion_transition_tool {"preset": "whip", "clip1_id": "<A>", "clip2_id": "<B>", "direction": "left", "duration": 0.3}`. Keep one dominant direction per act (left in one, right in the next).
6. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": <T-0.1>, "gain_db": -16}`.

## Timing & taste rules

- cinetic's timing (60 fps): Exit: last 16-24 f (0.40 s) on ease_in_cubic (speed grows about ×1.1-1.2 per frame), ending at 25-40 px/f (never above 60) or −6 to −8% scale per frame. Entry: 30-55 px/f on frame 0, slowing about ×0.92-0.94 per frame (ease_out_expo over 45-90 f (1.50 s); entryDistance(40, 60) is about 400 px). A 1-3 px/f drift may run under the hold before the ramp. Text inside a moving shot must be under 20 px/f by the time it has to be read.
- Exit: last 16-24 f (0.27-0.40 s), speed growing ~x1.1-1.2 per frame, ending at 25-40 px/f (never above 60) or -6 to -8 % scale per frame.
- Entry: 30-55 px/f on frame 0 in the same direction at 1.0-1.5x the exit speed, slowing ~x0.92-0.94 per frame over 45-90 f (0.75-1.5 s).
- A 1-3 px/f drift may run under the hold before the ramp.
- Text inside a moving shot must be under 20 px/f by the time it has to be read.
- Velocity-matched cuts are exempt from the two-per-type limit; opposite directions are not allowed.

## Sound for it

A short whoosh peaking on the cut frame (the fastest frame); no hit unless the incoming shot lands on an object.

## Common mistakes

- One side has to be still (a held statement or freeze), or the shots move in opposite directions (avoid_when).
- Cutting from a decelerating exit: the cut must be on the fastest frame.
- Running the incoming shot at a different direction than the outgoing: that is a jump cut.
- Avoid when: One side has to be still (a held statement or a designed freeze), or the two shots would move in opposite directions. Carry a shape or an anchor across instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-velocity-handoff-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
