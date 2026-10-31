---
id: cin-ps-one-long-hold
kind: technique
summary: "When the film never stops: one key claim sits nearly still for 1-1.5 s so the viewer remembers it."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [confident, still, memorable]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ps-breath-envelope, kinetic-keyword-slam, t119]
avoid_with: [cin-ps-locked-camera-holds, cin-ps-silent-sign-off]
needs: []
drawn: cinetic
---

# The one long hold

cinetic `ps-one-long-hold` · Pacing and structure · accent · energy any · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In a film that otherwise never stops, a single key claim sits nearly still for over a second, which tells the viewer it is the line to remember.

Use when: The single claim or number the film exists to say, in a launch film or short spot that is relentless everywhere else.

## Build it in Zenvi

1. The one statement, once per film: `add_kinetic_title_tool {"text": "<the claim>", "style": "editorial", "animation": "rise", "position_seconds": 18.0, "duration_seconds": 2.6, "stagger_seconds": 0.133, "text_size": 0.07, "y": 0.5}`. Words settle in 20-36 f (0.33-0.6 s).
2. Hold 60-90 f (1.0-1.5 s) almost still: `set_keyframes_tool {"timeline_clip_id": "<title_word>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 18.6, "value": 1.0}, {"seconds": 20.1, "value": 1.012, "ease": "ease_in_out_sine"}]}` for every word clip (and `scale_y`); under 0.3 px/f at the edges. A background ground breathing by 3 % opacity, nothing new entering.
3. Exit by a creep: `scale_x/y` to 1.07 over the last 18 f (0.3 s), `ease_in_cubic`, then cut on the fastest frame: add the keyframes on the same clip at 20.1 s and 20.4 s.
4. `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": 18.4, "gain_db": -18}` is optional; every other near-still run in the film stays at or under 30 f (0.5 s).

## Timing & taste rules

- cinetic's timing (60 fps): Settle 20-36 f (0.60 s); hold 60-90 f (1.50 s) at under 0.3 px/f; exit creep +6% over 18 f (0.30 s) ease_in_cubic. Every other near-still run stays at or under 30 f (0.50 s).
- Settle 20-36 f (0.33-0.6 s); hold 60-90 f (1.0-1.5 s) at under 0.3 px/f; exit creep +6 % over 18 f (0.3 s) on ease_in_cubic.
- Every other near-still run stays at or under 30 f (0.5 s); this hold is at least twice as long.
- One statement per film; no new element enters during the hold.
- Background breathes by 3 % opacity so the frame is not dead.

## Sound for it

Thin the music or drop it to a bed under the hold; at most one tail_bloom at -18 dB when the line settles.

## Common mistakes

- Films already built on long holds: it stops reading as special.
- Two lines competing for the slot.
- Filling the hold with extra motion: it must be nearly still.
- Avoid when: Films already built on long holds, where it stops reading as special, or when two lines compete for the slot.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-one-long-hold`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
