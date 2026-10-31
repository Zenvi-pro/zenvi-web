---
id: cin-lc-one-centred-subject
kind: technique
summary: "When the viewer must never search: one huge centred subject per frame, dimmed surroundings, a gentle breath in the hold."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_kinetic_title_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_effect_tool, update_effect_tool]
pace: medium
mood: [direct, bold, phone-first]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-lc-vertical-band-stack, cin-ps-breath-envelope, shot-jump-cut-punch-in]
avoid_with: [cin-lc-live-split-view, cin-lc-bento-cell-takeover]
needs: []
drawn: cinetic
---

# One huge centred subject

cinetic `lc-one-centred-subject` · Layout and composition · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Every frame has exactly one subject, centred and large: a single line of type, or one UI card scaled to most of the frame width and often bleeding past the edges, with everything else dimmed.

Use when: Fast, phone-first films; walkthroughs where the viewer must never search for the subject; the default framing between more designed compositions.

## Build it in Zenvi

1. One line of type at most 80 % of the frame width: `add_kinetic_title_tool {"text": "<one line>", "style": "creator", "animation": "pop", "position_seconds": 0, "duration_seconds": 1.2, "text_size": 0.07, "y": 0.5}` (type 5-8 % of the frame height per line, centred on the frame centre; in a tall frame centre it inside the safe area).
2. Or one UI card filling 85-100 % of the frame width, bleeding past the edges where content allows: `add_clip_to_timeline_tool {"file_id": "<ui_capture>", "position_seconds": 0, "duration_seconds": 1.2, "track": 1}` and `set_keyframes_tool {"timeline_clip_id": "<ui>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.2, "value": 1.03, "ease": "ease_in_out_sine"}]}` (and `scale_y`): a 2.5 % breath so the hold is alive. Show captured UI at about 2x so body text is at least 27 px at 1080p.
3. Dim everything that is not the hero to 60-70 % brightness: `set_keyframes_tool {"timeline_clip_id": "<background>", "property": "alpha", "mode": "replace", "points": [{"seconds": 0, "value": 1}, {"seconds": 0.27, "value": 0.65, "ease": "ease_in_out_sine"}]}` over a black card, or defocus with `add_effect_tool {"effect": "Blur", "timeline_clip_id": "<background>"}` at blur 8-40 and `update_effect_tool` to ramp it over 12-20 f (0.2-0.33 s).

## Timing & taste rules

- cinetic's timing (60 fps): Holds of 30-72 f (1.20 s) per hero. Cards at 85-100% of frame width or bleeding past it, header bars up to full width, tables at least 80%; type 5-8% of frame height per line. Dims and rack focus 12-20 f (0.33 s) on ease_in_out_sine.
- Holds of 30-72 f (0.5-1.2 s) per hero.
- Cards at 85-100 % of the frame width or bleeding past it; header bars up to full width; tables at least 80 %; type 5-8 % of the frame height per line.
- Dims and defocus take 12-20 f (0.2-0.33 s) on ease_in_out_sine; never leave neighbours at full strength.
- Captured UI at about 2x so body text is at least 27 px at 1080p.
- Keep each hold alive with a 2.5 % scale breath.

## Sound for it

A hit only when the subject changes on a cut; the hold itself is silent.

## Common mistakes

- Comparison or cause-and-effect beats that need two things on screen: use a split instead.
- Leaving the neighbours at full strength so the eye has two targets.
- A hero card floating small in the middle: scale it to the frame, bleed it.
- Avoid when: Comparison or cause-and-effect beats that need two things on screen at once (use a split), or bento-style loops.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-one-centred-subject`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
