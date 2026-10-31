---
id: cin-tr-envelope-match-type-cut
kind: technique
summary: "When a big claim hands over to its sentence: hard cut to smaller words spread to the old width, gaps then close."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [typographic, precise, assured]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-emphasis-scale, shot-title-demote-to-label, kinetic-keyword-slam]
avoid_with: [kinetic-word-pop, cin-tr-conveyor-line-swap]
needs: []
drawn: cinetic
---

# Envelope-matched type cut

cinetic `tr-envelope-match-type-cut` · Transition · accent · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A big line hard-cuts to a much smaller, longer line whose words start spread apart so it spans exactly the old line's width, then the gaps close while the sideways drift carries on, so the outer edges of the type survive the cut.

Use when: A big two- or three-word claim hands over to its full sentence or call to action; any big-to-small type change where both lines share a centre or a left edge and the type already drifts sideways.

## Build it in Zenvi

1. Line A (big): `add_title_tool {"text": "FASTER. SIMPLER.", "position_seconds": 0, "duration_seconds": 1.6, "font_scale": 2.4, "screen_position": "center", "track": 2}`, drifting sideways with a creep: `set_keyframes_tool {"timeline_clip_id": "<A>", "property": "location_x", "mode": "replace", "points": [{"seconds": 0, "value": 0.03}, {"seconds": 1.6, "value": -0.06}]}` (about -3.5 px/f).
2. Measure A's on-screen width `W_A` and B's natural width `W_B` (smaller) with `inspect_timeline_tool` on the cut frame. Line B as one title clip per word (n words, cap height 2-3x smaller): `add_title_tool {"text": "Ship the whole launch this week", ...}` split into `add_title_tool` per word at their rest positions, on track 2 from `T`.
3. Spread each word: gap `g0 = (W_A - W_B) / (n - 1)` and `set_keyframes_tool {"timeline_clip_id": "<word j>", "property": "location_x", "mode": "replace", "points": [{"seconds": <T>, "value": <g0 * (j - (n-1)/2) / frame_width>}, {"seconds": <T+0.6>, "value": 0, "ease": "ease_out_expo"}]}` (36 f / 0.6 s, half done by f5 / 0.08 s). Each word keeps its own tracking.
4. Both lines carry the same sideways drift through the cut (3-4 px/f), decaying in B over 60 f (1.0 s): add `location_x` keyframes to B continuing A's slope, then easing flat with `ease_out_cubic`.
5. Optional ghost frame: B at `alpha` 0.65 for 1 f over A. Hold B at least 60 f (1.0 s). `add_sfx_tool {"recipe": "hit_transient", "at_seconds": <T>, "gain_db": -16}`.

Fallback: No tool animates letter or word spacing as one control; one clip per word with location_x keyframes is the stand-in, workable up to about 6 words.

## Timing & taste rules

- cinetic's timing (60 fps): Cut in 0 f (0.00 s), or 1 ghost frame at 0.6-0.7 incoming. The gaps close over 36 f (0.60 s) on ease_out_cubic, half done by frame 5. The outermost words travel (W_A − W_B)/2: keep that at or under 160 px so their first frame stays under 20 px/f, or fly them at 0.6 opacity for the first 6 f (0.10 s). Shared drift 3-4 px/f, decaying in B over 60 f (1.00 s). Hold B at least 60 f (1.00 s).
- Cut in 0 f, or 1 ghost frame at 0.6-0.7 incoming.
- Gaps close over 36 f (0.6 s) on an ease-out, half done by frame 5 (0.08 s).
- Outermost words travel (W_A - W_B)/2: keep it at or under 160 px (about 8 % of the width) so their first frame stays under 20 px/f, or fly them at 0.6 alpha for the first 6 f (0.1 s).
- Shared drift 3-4 px/f, decaying in B over 60 f (1.0 s); hold B at least 60 f.
- B is naturally narrower than A and shares a centre or left edge.

## Sound for it

A small `hit_transient` on the cut frame, nothing as the gaps close.

## Common mistakes

- B naturally wider than A, either line a single word, or the alignment changing across the cut (avoid_when).
- Letting the outermost words travel more than ~160 px: they smear.
- No shared drift: the type then stops dead at the cut.
- Avoid when: B is naturally wider than A (use a blur-swap rescale instead), either line is a single word (there are no gaps, so collapse one word's tracking instead), or the alignment changes across the cut.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-envelope-match-type-cut`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
