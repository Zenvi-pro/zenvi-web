---
id: cin-ps-continuity-thread
kind: technique
summary: "When disconnected beats need a causal chain: one small accent object recurs and carries the idea from shot to shot."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [conceptual, kinetic, linking]
aspect: ["16:9", "1:1"]
pairs_with: [shot-glow-flyline, shot-source-hub-connect, kcut-hit-fx]
avoid_with: [shot-cursor-flyover, shot-collab-cursors]
needs: [svg-path-write-on]
drawn: cinetic
---

# Travelling thread object

cinetic `ps-continuity-thread` · Pacing and structure · signature · energy high · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

One small accent object (a dot, a packet or a streak) recurs across shots and acts, carrying the idea from problem to feature to feature as a single causal chain.

Use when: Abstract or concept-led launch films whose beats are visually disconnected, and stories about value or data travelling.

## Build it in Zenvi

**Ban-safe variant (the cinetic house default; the draw says `ban_safe_variant`):**

1. Same thread, one brand accent and no halo: an opaque head with a solid tapered tail (a short directional blur only) and the same hue on every beat.
2. Contacts read through squash and a pulse: `set_keyframes_tool {"timeline_clip_id": "<struck>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 2.5, "value": 1.0}, {"seconds": 2.58, "value": 1.06, "ease": "ease_out_expo"}, {"seconds": 2.75, "value": 1.0, "ease": "ease_out_cubic"}]}` (and `scale_y`) rather than a flash.
3. Keep 3-5 appearances, 20-60 f (0.33-1.0 s), and the same size every time.

**Full look** (relies on glow, purple: only when the person's brand supplies that look):

1. Build the thread once as a small disc plus tapered tail: a round head 2-3 % of the frame height; as a clip, a short 2-second render of a dot moving, from `add_motion_block_tool {"block": "particle_burst", "position_seconds": 2.0, "duration_seconds": 1.0, "params": {"shape": "dots", "count": 1, "origin": [[0.1, 0.5]]}}`, or an `add_clip_to_timeline_tool` of a small dot image.
2. Each appearance (3-5 over 9-15 s, 20-60 f, 0.33-1.0 s each) travels a path: `set_keyframes_tool {"timeline_clip_id": "<thread>", "property": "location_x", "mode": "replace", "points": [{"seconds": 2.0, "value": -0.55}, {"seconds": 2.5, "value": 0.1, "ease": "ease_out_expo"}]}` and `location_y`; always fast (20-60 px/f). Across a cut re-enter from the same screen side and angle as it left.
3. Tail length scales with speed (about 240 px at the top): bake with `apply_fx_tool {"clip_id": "<thread>", "effects": [{"effect": "directional_blur", "amount": 0.8, "start": 2.0, "end": 2.5}]}`. The full look adds `bloom` (a halo) and shifts its tint on one beat.
4. Hand off by becoming the next scene's element (a check, a pin, a button fill): crossfade into it at the contact frame and give the struck element a scale bump `set_keyframes_tool` `scale_x/y` 1.0, 1.06, 1.0 over 5 f (0.08 s); squash on contact for 8 f (0.13 s).
5. `add_sfx_tool {"recipe": "swoosh_hit", "at_seconds": 2.5, "gain_db": -10}` at each contact.

Fallback: No one-clip tapered trail with a path follows exists; get it from a directional blur and a short particle burst. Say so rather than fake a true comet.

## Timing & taste rules

- cinetic's timing (60 fps): 3-5 appearances of 20-60 f (1.00 s) each; head 2-3% of frame height; travel 20-60 px/f with true motion blur; contact squash over about 8 f (0.13 s); hitPulse(t, 2, 5) on the struck element.
- 3-5 appearances of 20-60 f (0.33-1.0 s); head 2-3 % of the frame height at the same size every time.
- Travel 20-60 px/f with motion blur; contact squash about 8 f (0.13 s); a pulse of 5 f on the struck element.
- Re-enter from the same side and angle it left by; hand off by becoming the next element.
- Tail length = speed x 1.5 px, capped at 240 px.

## Sound for it

One swoosh_hit per contact, panned if the thread crosses the frame; no sound while it travels in the background.

## Common mistakes

- Plain UI walkthroughs where a cursor already guides the eye: two guides compete.
- Changing the head's size per appearance.
- Letting it dawdle: it is always fast or it is gone.
- Avoid when: Plain UI walkthroughs where a cursor already guides the eye, since two guides compete.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-continuity-thread`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
