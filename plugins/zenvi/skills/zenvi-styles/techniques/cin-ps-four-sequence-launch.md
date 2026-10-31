---
id: cin-ps-four-sequence-launch
kind: technique
summary: "When a 30-60 s launch must earn attention then prove it: open, one diagram, a long walkthrough, a brief close."
categories: [cinetic-launch-film, cinetic-teaser]
tools: [detect_beats_tool, add_marker_tool, add_motion_block_tool, add_kinetic_title_tool, add_clip_to_timeline_tool, screen_zoom_follow_tool, set_keyframes_tool, split_clip_tool]
pace: medium
mood: [structured, confident, product-led]
aspect: ["16:9", "1:1"]
pairs_with: [cin-ps-score-mapped-to-acts, cin-ps-luma-act-map, cin-ps-locked-camera-holds]
avoid_with: [cin-ps-image-act-then-type-act, cin-ps-single-camera-journey]
needs: []
drawn: cinetic
---

# Spectacle, diagram, walkthrough, sign-off

cinetic `ps-four-sequence-launch` · Pacing and structure · workhorse · energy medium · formats launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A launch film in four sequences: a short spectacle open, one concept diagram, a long real-product walkthrough and a brief brand close.

Use when: 30-60 s launch films that have to earn attention, explain an idea and then prove it in the product.

## Build it in Zenvi

1. Time shares about 19/14/58/9 %; at 30 s that is about 5.7, 4.2, 17.4 and 2.7 s. Mark each act on a bar line: `detect_beats_tool {"file_id": "<music>"}`, then `add_marker_tool {"name": "Open", "position_seconds": 0, "color": "green"}`, `{"name": "Diagram", "position_seconds": 5.7}`, `{"name": "Walkthrough", "position_seconds": 9.9}`, `{"name": "Close", "position_seconds": 27.3}`.
2. Open (surge): the biggest moves and the strongest accent use: `add_motion_block_tool {"block": "particle_burst", "position_seconds": 0.3, "duration_seconds": 1.5, "params": {"shape": "sparks"}}` plus the hero line as `add_kinetic_title_tool`.
3. Diagram (dip), slower, one centred concept figure that names the idea: `add_motion_block_tool {"block": "hud_callouts", "position_seconds": 5.7, "duration_seconds": 4.2, "params": {"title": "<idea>", "labels": ["<in>", "<out>"]}}`.
4. Walkthrough (plateau): 10-14 shots from wide/close pairs of one recording: `add_clip_to_timeline_tool` the capture once, then `screen_zoom_follow_tool {"clip_id": "<capture>", "zoom": 1.5, "min_hold": 1.2}` or `set_keyframes_tool` `scale_x/y` to 4-4.5x on the control (split the clip with `split_clip_tool` at each wide/close cut, shots median 75-100 f, 1.25-1.67 s).
5. Close: replay the open's mechanic, then the lockup: `add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 27.3, "duration_seconds": 2.7, "params": {"brand": "<name>", "cta": "<cta>"}}`.

## Timing & taste rules

- cinetic's timing (60 fps): Shares 19/14/58/9% (at 30 s: about 342/252/1044/162 f (2.70 s)). Walkthrough shot median 75-100 f (1.67 s); wides 90-180 f (3.00 s), close-ups 76-154 f (2.57 s) at 4-4.5x. Lockup hold 90-120 f (2.00 s) inside the close.
- Shares 19/14/58/9 %; at 30 s about 342/252/1044/162 f (5.7/4.2/17.4/2.7 s).
- Walkthrough shot median 75-100 f (1.25-1.67 s); wides 90-180 f (1.5-3 s); close-ups 76-154 f (1.3-2.6 s) at 4-4.5x scale on the control.
- Cuts velocity-matched across the wide/close pair; render the UI once and frame both from the same capture.
- Lockup hold 90-120 f (1.5-2 s) inside the close.
- Map the music onto the contour: intro/build, breakdown, groove, resolve, hold.

## Sound for it

Let the score follow the contour (see the score-mapping technique); UI clicks in the walkthrough get ui_tap or toggle at -18 dB; one sub_drop on the lockup.

## Common mistakes

- Spots under 15 s: use the image-then-type plan instead.
- Products with nothing to diagram: skip the dip rather than faking a diagram.
- Letting the walkthrough run on the open's pace: it is the plateau and should be calmer.
- Avoid when: Spots under 15 s (use the image-then-type plan instead) and products with nothing to diagram.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-four-sequence-launch`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
