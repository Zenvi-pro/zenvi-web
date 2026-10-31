---
id: cin-ps-empty-ground-after-cut
kind: technique
summary: "When flat statement cards hard-cut in a type film: the new ground shows two empty frames before its type appears."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_title_tool]
pace: fast
mood: [crisp, minimal, typographic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-keyword-slam, cin-ps-breath-envelope, t119]
avoid_with: [whip-and-match-cut-chain]
needs: []
drawn: cinetic
---

# Empty ground after a cut

cinetic `ps-empty-ground-after-cut` · Pacing and structure · accent · energy medium · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Right after some hard cuts the new stage shows for two empty frames before its type appears, a tiny palate cleanser that makes the cut read crisply without any flash.

Use when: Type-led films on white or flat stages with many statement cuts.

## Build it in Zenvi

1. Outgoing card on its own ground, ending by its own exit (an ease_in_cubic move or a fade over its last 8 f, 0.13 s): `add_kinetic_title_tool {"text": "<statement one>", "style": "creator", "animation": "pop", "position_seconds": 0, "duration_seconds": 1.6}`.
2. Incoming stage starts at the cut frame, flat, no type yet: `add_title_tool {"template": "Standard_1", "text": "", "background_color": "#f4f1ea", "position_seconds": 1.6, "duration_seconds": 1.8, "track": 1}`.
3. The first element arrives two frames later, on its normal entrance: `add_kinetic_title_tool {"text": "<statement two>", "style": "creator", "animation": "pop", "position_seconds": 1.633, "duration_seconds": 1.6}` (cut + 2 f at 60 fps = 0.033 s).
4. Do this on a few statement-to-statement cuts only (at most a third), never the film's first frame; the hook opens composed and moving.

## Timing & taste rules

- cinetic's timing (60 fps): 2 empty frames at 60 fps; the incoming card starts at cut + 2 on its usual entrance; on at most a third of the cuts.
- 2 empty frames at 60 fps (0.033 s); at 30 fps round to 1 frame; the incoming card starts at cut + 2 f on its usual entrance.
- On at most one third of the cuts, only where both stages are flat.
- The outgoing card has already left by its own exit, so the two empty frames read as a breath, not a dropped frame.
- Never on frame 0.

## Sound for it

None. A hit or pop on the card's entrance still lands on its first visible frame, cut + 2 f.

## Common mistakes

- Velocity-matched cuts, where the gap kills the momentum.
- Using it on frame 0, where the hook must open composed and moving.
- Applying it on every cut: it stops being a breath and looks like lag.
- Avoid when: Velocity-matched cuts, where the gap kills the momentum, and frame 0.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-empty-ground-after-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
