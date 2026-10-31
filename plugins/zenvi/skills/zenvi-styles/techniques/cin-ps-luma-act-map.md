---
id: cin-ps-luma-act-map
kind: technique
summary: "When a film has two halves: dark for the problem, light for the product, flipped on downbeats, no title cards."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [detect_beats_tool, add_marker_tool, add_title_tool, add_shape_mask_tool, apply_motion_transition_tool, add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [structured, graphic, rhythmic]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cin-ps-four-sequence-launch, kcut-flood-climax, shot-aurora-flip]
avoid_with: [cinematic-teal-orange, shot-theme-switch]
needs: []
drawn: cinetic
---

# Light and dark as chapters

cinetic `ps-luma-act-map` · Pacing and structure · workhorse · energy any · formats launch, feature, walkthrough. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Acts are planned by stage polarity, dark for the abstract or problem beats and light for the product, so chapter changes read without any title cards.

Use when: Films with distinct problem/solution or prompt/result halves, and 20-60 s pieces that need a rhythm at the scale of whole acts.

## Build it in Zenvi

1. Plan: alternation (about 50/50 flipping at each ask/answer change) or arc (dark open, mixed middle, light product finish). Mark each flip on a downbeat: `detect_beats_tool {"file_id": "<music>"}` then `add_marker_tool {"name": "Flip to light", "position_seconds": 12.0, "color": "white"}`. Three to five flips per film.
2. Stage colours: dark at value 0.10-0.30, light at 0.85-0.95, the accent unchanged: `add_title_tool {"template": "Standard_1", "text": "", "background_color": "#14161a", "position_seconds": 0, "duration_seconds": 12, "track": 1}` and a light card (`#f1efe9`) after it.
3. Flip devices, never the same twice in a row: an inverse hard cut; an inverse match cut on a shared icon; an iris from a glyph, 20 f (0.33 s): `add_shape_mask_tool {"clip_ids": ["<light_card>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "keyframes": [{"seconds": 12.0, "grow": -0.5}, {"seconds": 12.33, "grow": 0}]}`; a bleach to white, 26 f (0.43 s): `apply_motion_transition_tool {"preset": "flash_white", "clip1_id": "<a>", "clip2_id": "<b>", "duration": 0.43}`; a theme flip during a move, 6 f (0.1 s).
4. Optional brand wash that shows only on brand beats: `add_motion_block_tool {"block": "gradient_field", "position_seconds": 18.0, "duration_seconds": 3.0, "params": {"style": "aurora"}}` rising from the bottom edge, `location_y` +0.4 to 0 over 50 f (0.83 s), `ease_out_expo`, draining in 8 f (0.13 s).
5. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": 12.0, "gain_db": -10}` on each flip.

## Timing & taste rules

- cinetic's timing (60 fps): 3-5 flips per film, each on b(n); iris 20 f (0.33 s) ease_in_out_expo; bleach 26 f (0.43 s) ease_in_out_sine; theme flip during a move 6 f (0.10 s); wash rise 50 f (0.83 s) ease_out_expo, drain 8 f (0.13 s) ease_in_cubic.
- 3-5 flips per film, each on a downbeat.
- Iris 20 f (0.33 s) ease_in_out_sine; bleach to white 26 f (0.43 s); theme flip during a move 6 f (0.1 s); wash rise 50 f (0.83 s) ease_out_expo, drain 8 f (0.13 s) ease_in_cubic.
- Dark stage value 0.10-0.30, light 0.85-0.95; one accent colour across both.
- Never the same flip device twice in a row.

## Sound for it

A thud or hit on each flip frame, always on a downbeat; the wash is silent.

## Common mistakes

- Very short stings: there is no room for acts.
- Brands locked to a single stage colour.
- Flipping on off-beat frames or by the same device each time.
- Avoid when: Very short stings, and brands locked to a single stage colour.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-luma-act-map`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
