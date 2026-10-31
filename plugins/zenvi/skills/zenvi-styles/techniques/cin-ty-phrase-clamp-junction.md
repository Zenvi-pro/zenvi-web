---
id: cin-ty-phrase-clamp-junction
kind: technique
summary: "When a two-part claim means more together: two halves arrive from opposite sides and lock on one baseline."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_title_tool, inspect_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [assertive, locked-in]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [kinetic-mask-reveal]
avoid_with: [cin-le-mark-slide-name-follow]
needs: [junction-anchored-text-halves]
drawn: cinetic
---

# Phrase clamp at a junction

cinetic `ty-phrase-clamp-junction` · Typography in motion · signature · energy medium · formats launch, feature, sting, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Two halves of a phrase arrive from opposite directions and lock on one baseline at a fixed junction, like a clamp closing.

Use when: A two-part claim whose halves mean more together (subject + promise, problem + fix); the payoff line; a junction that a slot roller will reuse.

## Build it in Zenvi

1. `add_title_tool {"text": "Say it once,", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 2.6, "track": "3"}` first half; `add_title_tool {"text": "ship it twice.", "template": "Standard_1", "position_seconds": 2.0, "duration_seconds": 2.6, "track": "4"}` second half (second half is also a whole-title clip, so the 2 f per-word drop stagger is merged into one drop).
2. `inspect_timeline_tool {"startFrame": 150}` then pin the junction at x about 48 % of the frame: a constant `set_keyframes_tool {"timeline_clip_id": "<half1>", "property": "location_x", "points": [{"seconds": 2.0, "value": <dx1>}, {"seconds": 4.6, "value": <dx1>}]}` and the same for `<half2>` with `<dx2>`, so the first half ends and the second starts one word space apart.
3. Vertical lock: `set_keyframes_tool {"timeline_clip_id": "<half1>", "property": "location_y", "ease": "ease_out_expo", "points": [{"seconds": 2.0, "value": 0.059}, {"seconds": 2.3, "value": 0}]}` (64 px of 1080); second half `{"seconds": 2.033, "value": -0.037}` to `{"seconds": 2.333, "value": 0}` (-40 px, f2 later).
4. `set_keyframes_tool {"timeline_clip_id": "<half1>", "property": "alpha", "points": [{"seconds": 2.0, "value": 0}, {"seconds": 2.05, "value": 1}]}` for both halves (opacity over 3 f).
5. Lock punch on the beat: `scale_x` and `scale_y` on both halves, `{"seconds": 2.3, "value": 1.0}`, `{"seconds": 2.35, "value": 1.015, "ease": "ease_out_expo"}`, `{"seconds": 2.5, "value": 1.0}`.
6. `add_sfx_tool {"recipe": "pop", "at_seconds": 2.3, "gain_db": -14}`.

Fallback: Without exact junction alignment, centre one add_kinetic_title_tool (style editorial, animation rise) with the whole phrase and accept that the halves do not travel from opposite sides.

## Timing & taste rules

- cinetic's timing (60 fps): Vertical: 18 f (0.30 s) ease_out_expo, 64 px and 40 px travel (peak 19.7 and 12.3 px/f on frame 1), 2 f (0.03 s) word stagger, 1 f (0.02 s) pre-pose, opacity 3 f (0.05 s). Snap: 35 px per side over 10 f (0.17 s) ease_out_expo (about 20 px/f on frame 1) to 0.75 of the gap, back over 18 f (0.30 s) ease_out_cubic. Calm close: 80 f (1.33 s) ease_out_cubic. Hold the locked line at least 54 f (0.90 s) with a 0.3 px/f drift.
- Vertical default: 18 f (0.30 s) ease_out_expo, 64 px (0.059 of height) and 40 px (0.037) travel, 3 f (0.05 s) opacity.
- Horizontal snap variant: halves start 35 px (0.018 of width) out, close to 0.75 of the word space over 10 f (0.17 s), then ease back to the true gap over 18 f (0.30 s). The closing never touches the space.
- Calm variant: a 1.7x gap closes to 1x over 80 f (1.33 s) on ease_out_cubic.
- Hold the locked line at least 54 f (0.9 s) with a tiny 0.3 px/f drift; punch it 1.5 % on the lock only.

## Sound for it

One soft pop at f138 (2.3 s) on the lock, -14 dB; the arrival of each half gets none.

## Common mistakes

- A line over 5 words or halves of very unequal length: the junction drifts off centre.
- Using it more than once per film or as the end lockup.
- Junction gap wider or narrower than one word space: it reads as two captions, not one claim.
- Avoid when: Lines over 5 words or halves of very unequal length; more than once per film; the end lockup.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ty-phrase-clamp-junction`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
