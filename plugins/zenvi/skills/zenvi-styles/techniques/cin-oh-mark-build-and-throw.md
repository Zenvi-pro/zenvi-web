---
id: cin-oh-mark-build-and-throw
kind: technique
summary: "When recognition must land in half a second: a dot swells into the mark, shrinks faster, cuts to a macro of it."
categories: [cinetic-logo-sting]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: fast
mood: [confident, kinetic, brand-first]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t069, cin-tr-scale-through-cut, kcut-hit-fx]
avoid_with: [cin-oh-macro-scramble-snap-out, shot-brand-ink-open]
needs: []
drawn: cinetic
---

# Mark builds, then is thrown into a macro of itself

cinetic `oh-mark-build-and-throw` · Opening hook · accent · energy high · formats sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

On frame 1 a dot swells into the brand mark. The mark grows briefly, holds for a breath, then shrinks away faster and faster and hard-cuts at peak speed to a frame-filling macro of the same mark, which keeps pulling back.

Use when: A brand-first logo sting where recognition must land in under half a second and the energy must pour into the next shot.

## Build it in Zenvi

1. Mark only, no wordmark: `add_clip_to_timeline_tool {"file_id": "<mark>", "position_seconds": 0, "duration_seconds": 1.13, "track": 2}` (a transparent logo image on a flat dark ground clip on track 1).
2. Dot to mark, grow, hold, throw: `set_keyframes_tool {"timeline_clip_id": "<mark>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.04}, {"seconds": 0.3, "value": 0.83, "ease": "ease_out_expo"}, {"seconds": 0.667, "value": 1.0, "ease": "ease_out_cubic"}, {"seconds": 0.8, "value": 1.0}, {"seconds": 1.133, "value": 0.55, "ease": "ease_in_cubic"}]` and the same on `scale_y`: f0-f18 dot to mark, f8-f40 wrapper grows 0.83 to 1, hold f40-f48, exit f48-f68 on an ease-in.
3. Hard cut at f68 (1.133 s) on the fastest frame. The macro shot is a second copy: `add_clip_to_timeline_tool {"file_id": "<mark>", "position_seconds": 1.133, "duration_seconds": 0.8, "track": 2}` with `scale_x`/`scale_y` `[{"seconds": 1.133, "value": 2.2}, {"seconds": 1.533, "value": 1.0, "ease": "ease_out_expo"}]`, the mark at the same screen point so the cut hides.
4. Stage and first UI reveal as it settles (the UI clip on track 1 from 1.133 s). Add `apply_fx_tool {"clip_id": "<mark>", "effects": [{"effect": "radial_blur", "amount": 0.5, "start": 1.0, "end": 1.2}]}` on the fastest frames.
5. `add_sfx_tool {"recipe": "whoosh_short", "at_seconds": 1.05, "gain_db": -14}`; no hit on the mark's own appearance.

## Timing & taste rules

- cinetic's timing (60 fps): Dot to mark 18 f (0.30 s) on ease_out_expo (edge about 49 px/f on its first frame); grow 32 f (0.53 s) from f8 (0.13 s); hold 8 f (0.13 s) (f40 (0.67 s)-48); exit 20 f (0.33 s) on ease_in_cubic (f48 (0.80 s)-68), cut at f68 (1.13 s); macro pull-back 24 f (0.40 s) through zoomHandoff from about 2.2x.
- Dot (12 px) to mark (320 px) in 18 f (0.30 s) on ease_out_expo; grow 0.83 to 1 over 32 f from f8; hold 8 f (f40-48); exit 20 f (0.33 s) on ease_in_cubic.
- Hard cut on the exit's last, fastest frame, f68 (1.13 s).
- Macro pull-back 24 f (0.40 s) from ~2.2x to 1x, no overshoot, starting at the exit's speed so there is no step at the cut.
- Mark only; the wordmark lockup is saved for the end.
- Blur only on the fast frames (edges peak ~59 px/f), the hold is sharp.

## Sound for it

One short whoosh peaking on the cut frame; the mark's own build is silent. The next scene's first UI action carries the first hit.

## Common mistakes

- An unfamiliar mark that needs a longer hold to be learned (avoid_when): hold it 20-30 f longer or skip the throw.
- Showing the full lockup: the mark alone is the brand here.
- Landing the macro at 1.0x with the mark at a different screen point: the cut then reads as two shots.
- Avoid when: The mark is unfamiliar and needs a longer hold to be learned, or the film already uses a scale-continuity cut elsewhere. Never use it to show the full lockup.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-mark-build-and-throw`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
