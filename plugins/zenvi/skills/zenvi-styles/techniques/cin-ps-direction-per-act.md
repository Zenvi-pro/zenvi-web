---
id: cin-ps-direction-per-act
kind: technique
summary: "When hard-cut acts need coherence: one screen direction per act, so every entrance and exit runs one way until a seam."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_motion_transition_tool, pan_tool]
pace: medium
mood: [coherent, smooth, directional]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ps-luma-act-map, cinematic-whip-cut, whip-and-match-cut-chain]
avoid_with: [cin-ps-oner-morph-chain, cin-ps-single-camera-journey]
needs: []
drawn: cinetic
---

# One screen direction per act

cinetic `ps-direction-per-act` · Pacing and structure · workhorse · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Each act owns one direction of travel, so every entrance, exit, drift and camera ramp in it runs the same way, and the direction turns only at an act seam, where the turn itself marks the new chapter.

Use when: Films built from hard cuts with velocity handoffs, two-act spots (imagery, then type), runs of statements (an upward feed), and vertical films with a rising vector.

## Build it in Zenvi

1. Give each act one vector (2-4 per film): left to right, right to left, or upward for a feed. Write it down before keyframing.
2. Entrances start upstream by 8-15 % of the frame width (150-290 px at 1080p) and brake: `set_keyframes_tool {"timeline_clip_id": "<card>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": -0.12}, {"seconds": 0.67, "value": 0, "ease": "ease_out_expo"}]}` (30-50 f, 0.5-0.83 s); for a rightward act use -0.12, for a leftward act +0.12.
3. Holds drift downstream at 0.3-1 px/f: `{"seconds": 0.67, "value": 0}, {"seconds": 2.0, "value": 0.01}`.
4. Exits and accelerate-into-cut ramps leave downstream: `{"seconds": 2.0, "value": 0.01}, {"seconds": 2.35, "value": 0.12, "ease": "ease_in_cubic"}` (18-24 f, 0.3-0.4 s, reaching 17-38 px/f). Across each cut the hero leaves the downstream edge and re-enters from the upstream edge.
5. Whips follow the same sign: `apply_motion_transition_tool {"preset": "whip", "direction": "right", "clip1_id": "<a>", "clip2_id": "<b>"}`; `pan_tool {"clip_ids": ["<whoosh>"], "pan": 0.6}` takes the vector's side.
6. Turn the vector only at an act seam, on its downbeat, and make the turn coincide with a second channel change (a polarity flip, a score section change, or imagery to type). The last act's vector delivers the lockup, which arrives along it and settles centred.

## Timing & taste rules

- cinetic's timing (60 fps): 2-4 vectors per film, one per act, each turn on b(n) at an act seam. Entrance offsets 8-15% of frame width (150-290 px at 1080p), braking on ease_out_expo over 30-50 f (0.83 s); hold drift 0.3-1 px/f downstream; exit ramps 18-24 f (0.40 s) on ease_in_cubic, reaching 17-38 px/f; counter-motion above 2 px/f lasts at most 6 f (0.10 s) and only in settle tails.
- 2-4 vectors per film, one per act, each turn on a downbeat at an act seam.
- Entrance offsets 8-15 % of the frame width, braking over 30-50 f (0.5-0.83 s) on ease_out_expo; hold drift 0.3-1 px/f (18-60 px/s) downstream.
- Exit ramps 18-24 f (0.3-0.4 s) on ease_in_cubic, reaching 17-38 px/f.
- Counter-motion above 2 px/f lasts at most 6 f (0.1 s), and only in settle tails.

## Sound for it

Whooshes take the pan side of the vector; no extra sounds.

## Common mistakes

- Oners and single camera journeys, where the surface layout sets the direction.
- Films whose motion is mostly radial zooms, or multi-cell grids.
- Turning the vector mid-act: the turn only marks a new chapter at a seam.
- Avoid when: Oners and single camera journeys, where the layout of the surface sets the direction; films whose motion is mostly radial zooms; multi-cell grids; a film with no act change, which should keep one vector throughout.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-direction-per-act`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
