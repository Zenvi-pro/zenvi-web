---
id: cin-tr-defocus-cut
kind: technique
summary: "When two shots share nothing: the first goes out of focus, the cut lands on a blurred shot that snaps sharp."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_effect_tool, set_effect_property_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [dreamy, soft, reset]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cinematic-rack-focus, cinematic-depth-of-field, white-flash-or-light-leak-join]
avoid_with: [cin-tr-scale-through-cut]
needs: []
drawn: cinetic
---

# Defocus cut

cinetic `tr-defocus-cut` · Transition · accent · energy medium · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The outgoing shot throws itself out of focus in a few frames, the film cuts to a shot that is still fully defocused with its content already moving, and the lens snaps sharp as that content settles.

Use when: Joining two shots with nothing in common (no shared shape, direction or colour), or a deliberate 'look again' beat.

## Build it in Zenvi

1. Put a Blur effect on both clips: `add_effect_tool {"timeline_clip_id": "<A>", "effect": "Blur"}` and on `<B>`; read the ids from the receipts.
2. Outgoing, last 6 f (0.1 s): `set_effect_property_tool {"effect_id": "<blurA>", "property": "horizontal_radius", "value": 0, "at_seconds": <T-0.1>}` then `value: 16` at `<T>` with `interpolation: "bezier"` (same on `vertical_radius`); fade toward the next stage colour with `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "alpha", "mode": "replace", "points": [{"seconds": <T-0.1>, "value": 1.0}, {"seconds": <T>, "value": 0.2, "ease": "ease_in_cubic"}]}`.
3. Hard cut at `T`. Incoming opens at radius 24 and held 6-12 f (0.1-0.2 s) while its content already moves in: `set_keyframes_tool {"timeline_clip_id": "<B>", "property": "location_x", "mode": "replace", "points": [{"seconds": <T>, "value": 0.08}, {"seconds": <T+0.33>, "value": 0, "ease": "ease_out_expo"}]}` (cards on a diagonal over 20 f).
4. The snap: radius 24 to ~2 over 8 f (0.13 s) starting at `T+0.15`, then 2 to 0 over 12-20 f (0.2-0.33 s) with `ease_out_cubic`. Text inside lands sharp, never blurred for more than 6 f.
5. `add_sfx_tool {"recipe": "tail_bloom", "at_seconds": <T>, "gain_db": -16}`.

Fallback: Blur radius keyframes go in as point set_effect_property_tool calls; `apply_motion_transition_tool {"preset": "blur_dissolve"}` is the quick cousin if the defocused hold does not matter.

## Timing & taste rules

- cinetic's timing (60 fps): Out: 6 f (0.10 s) on ease_in_cubic to 16 px. Cut. Defocused hold 6-12 f (0.20 s) at 24 px. Snap 8 f (0.13 s) (ease_in_cubic) to t = 0.1. Settle 12-20 f (0.33 s) (ease_out_cubic). Incoming card move 20 f (0.33 s) on ease_out_expo. About 30-45 f (0.75 s) in all.
- Out: 6 f (0.1 s) on an ease-in to 16 px blur, opacity 1 to 0.2.
- Defocused hold 6-12 f (0.1-0.2 s) at 24 px, content already moving (20 f / 0.33 s ease-out).
- Snap 8 f (0.13 s) to 10 % blur, settle 12-20 f (0.2-0.33 s); about 30-45 f (0.5-0.75 s) in all.
- Readable text is never blurred for more than 6 f.
- At most twice per film.

## Sound for it

A soft `tail_bloom` or low pad swell on the cut; no hit.

## Common mistakes

- Using it as the default seam: it turns into a soft crossfade; also on shots dominated by small text, or more than twice per film (avoid_when).
- Blurring text that must be read.
- No motion in the defocused hold: it looks like a lag.
- Avoid when: As the default seam (it turns into a soft crossfade), on shots dominated by small text, or more than twice per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-defocus-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
