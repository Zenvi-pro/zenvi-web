---
id: cin-tx-wireframe-scan-build
kind: technique
summary: "When an idea turns into the product: an accent line sweeps across a UI card, wireframe ahead of it, finished UI behind."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [duplicate_clips_tool, apply_fx_tool, search_transitions_tool, add_transition_tool, add_title_tool, add_shape_mask_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [generative, engineered, reveal]
aspect: ["16:9", "1:1"]
pairs_with: [shot-outline-trace-reveal, shot-scan-annotate, shot-canvas-materialize]
avoid_with: [cin-tx-scanline-transmute]
needs: [wireframe-render-of-ui]
drawn: cinetic
---

# Wireframe-to-product scan

cinetic `tx-wireframe-scan-build` · Texture and finish · signature · energy medium · formats launch, feature. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

A thin accent line sweeps across a UI card: ahead of it the card is still a wireframe of outlines and skeleton bars, behind it the finished product is already there.

Use when: Idea-to-product, design-to-code, generation or build stories; the first appearance of the hero UI.

## Build it in Zenvi

1. The finished UI clip on track 2 (a screen recording or card, about 0.2-0.8 of the frame width). Copy it above as the wire layer: `duplicate_clips_tool {"timeline_clip_ids": ["<ui>"], "to_track": "3"}`, then turn the copy into outlines on the stage colour: `apply_fx_tool {"clip_id": "<wire>", "effects": [{"effect": "print_ink", "amount": 1, "params": {"ink": "#8a8f9c", "plate": "#0b0c0f", "paper": "#0b0c0f", "levels": 2, "misregister": 0, "bleed": 0.1, "grit": 0}}]}` (edges as 1.5 px lines, flat fills gone).
2. Reveal the real UI left to right behind the line: find the wipe with `search_transitions_tool {"query": "wipe right"}` then `add_transition_tool {"track": "3", "position_seconds": 3.0, "duration_seconds": 0.73, "transition": "<wipe_name>", "direction": "right"}`.
3. The line, 2 px accent, reaching 24 px past the card's top and bottom: `add_title_tool {"text": " ", "background_color": "<accent>", "position_seconds": 3.0, "duration_seconds": 0.9, "track": "4"}` with `add_shape_mask_tool {"clip_ids": ["<line>"], "shape": "rectangle", "x": 0.5, "y": 0.5, "width": 0.0015, "height": 0.7, "feather": 0}`.
4. Sweep it across the card in 44 f: `set_keyframes_tool {"timeline_clip_id": "<line>", "property": "location_x", "points": [{"seconds": 3.0, "value": -0.324}, {"seconds": 3.73, "value": 0.3, "ease": "ease_in_out_sine"}]}`, then fade it over 10 f (0.17 s): `alpha` 1 to 0 over 3.73-3.9 s.
5. `add_sfx_tool {"recipe": "whoosh_medium", "at_seconds": 3.3, "gain_db": -14}` for the swell, `{"recipe": "pop", "at_seconds": 3.73, "gain_db": -12}` as the line leaves the card.

Fallback: Zenvi has no true wireframe of a UI (outlined boxes and skeleton bars); the print_ink edge FX gives line art of a recording. If the lines read as noise, rebuild the UI as a motion block twice (once with `plate: none` and a mono palette) and use that as the wire layer.

## Timing & taste rules

- cinetic's timing (60 fps): Sweep 40-48 f (0.80 s) on ease_in_out_sine across a 600-900 px card (edge peak ~40-58 px/f; the UI itself never moves); line fade 10 f (0.17 s); the finished card then holds at least 30 f (0.50 s) under a 0.5-1.5 px/f camera drift.
- Sweep 40-48 f (0.67-0.8 s, ease_in_out_sine) across a 600-900 px card (edge peak about 40-58 px per frame); the UI itself never moves.
- Line 2 px accent, 24 px past the card's top and bottom, no glow; fade 10 f (0.17 s).
- Wireframe: 1.5 px outlines, text as rounded bars at about 40 % opacity.
- The finished card then holds at least 30 f (0.5 s) under a 0.5-1.5 px per frame camera drift.

## Sound for it

A soft swell across the sweep and a snap as the line leaves the card.

## Common mistakes

- More than once per film, or a film that already uses another scan device.
- UI too sparse to read as a wireframe.
- A glowing line or a moving UI during the sweep.
- Avoid when: More than once per film; UI too sparse to read as a wireframe; a film that already uses another scan device such as scanline transmutation.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-wireframe-scan-build`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
