---
id: cin-tr-scale-through-cut
kind: technique
summary: "When the world changes but the subject stays: it shrinks into the cut, a larger match opens on the same point."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [set_keyframes_tool, apply_fx_tool, add_sfx_tool]
pace: fast
mood: [seamless, dimensional, premium]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [t100, t110, cin-oh-mark-build-and-throw]
avoid_with: [cin-tr-defocus-cut]
needs: []
drawn: cinetic
---

# Scale-through cut

cinetic `tr-scale-through-cut` · Transition · signature · energy high · formats launch, sting, feature, loop. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

An object shrinks faster and faster toward a fixed point, the film cuts, and a matching object appears much larger on the same point and keeps shrinking as it brakes, so one pull-back runs through two different worlds. The mirror version swells into the cut and opens on an undersized object that grows.

Use when: Changing medium or world while keeping the subject: 3D to flat, device to UI, brand card to product, a mark coming back as a macro. Also hero pull-backs at act changes.

## Build it in Zenvi

1. Both subjects are centred on one screen point (within +/-30 px): crop or reposition them with `location_x/y` so the points agree.
2. Outgoing, shrink faster and faster into the cut (about -7.8 % on the last frame): `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <T-0.33>, "value": 1.0}, {"seconds": <T>, "value": 0.75, "ease": "ease_in_cubic"}]}`, same on `scale_y`.
3. Incoming, a larger matching subject that keeps shrinking and brakes: `{"seconds": <T>, "value": 1.8}, {"seconds": <T+0.67>, "value": 1.0, "ease": "ease_out_expo"}` on `scale_x` and `scale_y` of `<B>` (first frame about -8 % per frame, scale velocity continuous in log space).
4. For a frame-filling macro of a related mark use start 8-9x shrinking about x0.84 per frame and settled by f30 (0.5 s): `{"seconds": <T>, "value": 8.5}, {"seconds": <T+0.5>, "value": 1.0, "ease": "ease_out_expo"}`.
5. Push version: A swells `1.0 -> 1.22` (ease_in_cubic) over 16-24 f while the rest dims, B opens at 0.8 and grows to 1 over 30 f (0.5 s).
6. Optional smear: `apply_fx_tool {"clip_id": "<A>", "effects": [{"effect": "radial_blur", "amount": 0.5, "start": <len-0.12>, "end": <len>}]}`; also `apply_motion_transition_tool {"preset": "zoom_through", "focus_x": 0.5, "focus_y": 0.5}` for the quick version.

## Timing & taste rules

- cinetic's timing (60 fps): Exit: 16-24 f (0.40 s) on ease_in_cubic to 0.70-0.80 (last frame −7 to −9% per frame). Cut on a downbeat. Entry: 1.7-2.0x → 1 over 30-40 f (0.67 s) on ease_out_expo (first frame −8 to −9%), or an 8-9x macro shrinking toward rest ×0.84 per frame and settled by about 30 f (0.50 s). Anchor drift ≤ 30 px. Push variant: +20-25% over 16-24 f (0.40 s), then 0.8 → 1 over 30 f (0.50 s).
- Exit: 16-24 f (0.27-0.40 s) on an ease-in to 0.70-0.80 scale; last frame -7 to -9 % per frame; cut on a downbeat.
- Entry: 1.7-2.0x to 1x over 30-40 f (0.5-0.67 s) on ease_out_expo, first frame -8 to -9 %.
- Macro entry: 8-9x shrinking x0.84 per frame, settled by ~f30 (0.5 s); snap to 1 when within 1 %.
- Anchor drift between the two subjects 30 px at most (1.5 % of the width).
- Use at most twice per film; both sides must be moving, a scale jump with no matched velocity reads as a jump cut.

## Sound for it

A single whoosh peaking on the cut, optionally a low `sub_drop` under the incoming shrink; nothing else.

## Common mistakes

- The two objects cannot share a centre point, or both sides are calm (avoid_when).
- Mismatched scale velocity at the cut: the eye sees a jump.
- More than two per film: it stops being a signature.
- Avoid when: The two objects cannot share a centre point, or both sides are calm; a scale jump without matched scale velocity reads as a jump cut. Use it at most twice per film.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-scale-through-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
