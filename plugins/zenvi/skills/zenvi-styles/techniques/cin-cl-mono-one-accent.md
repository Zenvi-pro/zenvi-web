---
id: cin-cl-mono-one-accent
kind: technique
summary: "When several things compete in a shot: grade everything grey and paint one accent on the single meaning-carrier."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [color_grade_clip_tool, add_kinetic_title_tool, add_guide_overlay_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [disciplined, graphic, focused]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-cl-ink-resolve, cin-cl-read-state-tone-ladder, cin-cl-accent-on-newest, cinematic-duotone]
avoid_with: [cin-cl-one-hue-light-ramp, cin-cl-context-palette-shift]
needs: []
drawn: cinetic
---

# Monochrome world, one accent

cinetic `cl-mono-one-accent` · Colour and light · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Everything is black, white and grey, and one saturated accent marks the single element in each shot that carries the meaning.

Use when: Films that mix photos, 3D, maps and UI, multi-cell layouts, or any shot where several things compete and the eye needs exactly one target.

## Build it in Zenvi

1. `color_grade_clip_tool {"timeline_clip_ids": ["<photo>", "<map>", "<ui_capture>"], "look": "black_and_white"}` on every photo, map, render and backdrop capture so mixed media reads as one grey world (one call, all media clips).
2. `add_kinetic_title_tool {"text": "Ship the *whole* film", "emphasis": ["whole"], "accent": "<accent>", "ink": "#f4f4f2", "background": "#0a0a0b", "position_seconds": 3.0, "duration_seconds": 2.4}`: the payoff word is the only accent pixel in the shot.
3. Focus ring on the one thing that matters (a pin, a pressed button): `add_guide_overlay_tool {"kind": "ring", "clip_id": "<ui_clip>", "box": {"x": 0.62, "y": 0.45, "width": 0.14, "height": 0.1}, "color": "<accent>", "stroke_width": 8, "start": 4.0, "duration": 1.2}`. The ring clip lands on a new top track.
4. Let the ring thin and decay: `set_keyframes_tool {"timeline_clip_id": "<ring_clip>", "property": "alpha", "points": [{"seconds": 4.0, "value": 1}, {"seconds": 4.43, "value": 0.7, "ease": "ease_in_cubic"}, {"seconds": 4.83, "value": 0.3, "ease": "linear"}]}`.
5. Colour arrives on the cue frame: place the accented title or ring exactly on the cut or the click, never fade it in.

## Timing & taste rules

- cinetic's timing (60 fps): The palette stays the same for the whole film. The accent swaps on the cue frame (a step, 0 f (0.00 s)). Focus outlines land 6-10 px wide with their container (26 f (0.43 s), ease_out_expo), thin to 1 px over 12 f (0.20 s) on ease_in_cubic, then decay to 30% opacity over 24 f (0.40 s) on linear.
- One accent, one job, for the whole film: the accent stays the same hue on every shot.
- Accent covers about 0.05-6 % of the frame on average (peak about 12 %); the grey stage holds 85-90 %.
- Accent swaps in on the cue frame (0 f), never through a slow fade.
- Focus ring lands 6-10 px wide over 26 f (0.43 s, ease_out_expo), thins over 12 f (0.2 s), then decays to 30 % opacity over 24 f (0.4 s).
- Exactly one accented element per shot: the payoff word, the pin, the pressed button or the focus ring.

## Sound for it

Only the action that carries the accent gets a sound: a pressed button gets `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 4.0, "gain_db": -14}` on the click frame. The grade itself is silent.

## Common mistakes

- Two accent colours or two meanings for the accent in one film.
- Greying product UI whose own colours are the subject of every shot, or a story that needs two semantic colours on screen at once.
- Fading the accent in slowly; it should land on a cut or an impact frame.
- Avoid when: The product's own colourful UI is the subject of every shot and greying it would misrepresent it, or the story needs two semantic colours on screen at once.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`cl-mono-one-accent`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
