---
id: cin-mi-spinner-to-check
kind: technique
summary: "When a product works through steps alone, each spinner turns into a check and a small Done tag the moment its step ends."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_type_block_tool, add_title_tool, add_sfx_tool, set_keyframes_tool]
pace: calm
mood: [reassuring, steady, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-ui-progress-spine-steps, cin-pd-agent-status-then-answer, cin-mi-two-beat-confirm-cascade]
avoid_with: [kcut-hit-fx, cin-mi-launch-hop]
needs: []
drawn: cinetic
---

# Spinner resolves to a check

cinetic `mi-spinner-to-check` · Micro-interaction · workhorse · energy calm · formats feature, walkthrough, launch, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A working indicator (a rotating dashed ring in a step list, or a small spinning disc pushed into the middle of a sentence) turns into a check with a short tag the moment the step is done.

Use when: The product works through steps on its own (an agent, a sync, an import), and each completion should land as a small lock.

## Build it in Zenvi

1. Working: a dotted ring that spins one turn per 48 f (0.8 s) = 450 degrees per second: `add_type_block_tool {"block": "text_on_path", "text": "· · · · · · · ·", "shape": "ring", "radius": 0.012, "spin": 450, "ink": "<ink>", "position_seconds": <step_start>, "duration_seconds": <work_time>}`, beside the step label (`add_title_tool`).
2. Done frame: end the spinner clip and place the check on the same frame: `add_type_block_tool {"block": "write_on", "paths": ["M2 8 L6 12 L14 3"], "view_box": [0, 0, 16, 16], "width": 0.014, "stroke_width": 2.5, "ink": "<accent>", "position_seconds": <done>, "duration_seconds": 0.5, "draw_seconds": 0.13}` (ring scale 0.6 to 1 over 8 f / 0.13 s on `ease_out_expo`; the tick draws over 8 f from +3 f / 0.05 s).
3. A small Done tag rises 6 px and fades in over 8 f (0.13 s): `add_title_tool {"text": "Done", "position_seconds": <done>, "duration_seconds": 3.0, "fade_in_seconds": 0.13}`; the step label goes from grey to ink (crossfade two title clips).
4. The next step's spinner starts on that same frame; one step every 24-36 f (0.4-0.6 s).
5. Inline variant: open a slot between two words (the words slide apart over 6 f / 0.1 s) with an accent disc spinning in it; on done, swap it for the check.
6. `add_sfx_tool {"recipe": "pop", "at_seconds": <done + 0.07>, "gain_db": -22, "pitch": <step_n>}` on each check's 50 % frame, climbing one semitone per step.

## Timing & taste rules

- cinetic's timing (60 fps): Ring: one turn per 48 f (0.80 s), linear (disc: one per 24 f (0.40 s)). Slot opens over 6 f (0.10 s) ease_out_expo. Check ring 8 f (0.13 s) ease_out_expo from 0.6; tick draws over 8 f (0.13 s) from +3 f (0.05 s); tag 8 f (0.13 s). One step every 24-36 f (0.60 s).
- Ring one turn per 48 f (0.8 s), linear; disc one turn per 24 f (0.4 s).
- Check ring scales 0.6 to 1 over 8 f (0.13 s); tick draws over 8 f from +3 f (0.05 s); tag 8 f (0.13 s).
- Slot opens over 6 f (0.1 s); one step every 24-36 f (0.4-0.6 s).
- Never let all the checks resolve on one frame.

## Sound for it

A soft pop at -22 dB on each check, pitched up one semitone per step so the run climbs; spinners are silent.

## Common mistakes

- A single long wait with nothing resolving: show progress instead.
- All the checks resolving on one frame.
- Changing the spinner to the check with a crossfade: it must be a swap on the done frame.
- Avoid when: There is a single long wait with nothing resolving (show progress instead), or all the checks would resolve on one frame.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`mi-spinner-to-check`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
