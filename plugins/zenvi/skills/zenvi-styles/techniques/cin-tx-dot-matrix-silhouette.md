---
id: cin-tx-dot-matrix-silhouette
kind: technique
summary: "When a claim is about reach or place: a barely visible dot field forms a map or product silhouette behind the type."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, apply_fx_tool, set_keyframes_tool, add_kinetic_title_tool]
pace: calm
mood: [quiet, informational, subtle]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-dataviz-landscape-open, cin-cl-living-stage, cin-cl-type-solidity-arc]
avoid_with: [cin-tx-ramp-masked-stipple]
needs: []
drawn: cinetic
---

# Faint dot-matrix silhouette

cinetic `tx-dot-matrix-silhouette` · Texture and finish · accent · energy calm · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Behind a claim, a barely visible field of dots forms a meaningful silhouette (a world map, a region, the product's own shape), adding literal context without competing with the type.

Use when: Claims about reach, coverage, location or scale, and any shot where a silhouette adds literal meaning behind the copy.

## Build it in Zenvi

1. The silhouette bitmap (a black world-map or shape on white) on track 1: `add_clip_to_timeline_tool {"file_id": "<silhouette_png>", "position_seconds": 0, "track": "1", "duration_seconds": 1.5}`.
2. Dots 4 % off the ground, ground colour `#14171f`: `apply_fx_tool {"clip_id": "<silhouette>", "effects": [{"effect": "halftone", "amount": 1, "params": {"cell": 20, "ink": "#1c2029", "paper": "#14171f"}}]}`. (Cell 20 at 1080p; on a vertical frame scale the cell up.)
3. Keep it alive with a 1.00 to 1.02 scale across the shot: `set_keyframes_tool {"timeline_clip_id": "<silhouette>", "property": "scale_x", "ease": "linear", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.5, "value": 1.02}]}` (and `scale_y`).
4. Claim on top: `add_kinetic_title_tool {"text": "Used in 140 countries", "style": "documentary", "animation": "fade", "position_seconds": 0, "duration_seconds": 1.5}`. It enters and leaves on cuts, no fades.

## Timing & taste rules

- cinetic's timing (60 fps): Holds one shot of 80-100 f (1.67 s); scale 1.00 to 1.02 linear across it (well under 1 px/f); arrives and leaves on cuts, no fades.
- Dots on a 20 px grid at 1080p, 13 px circles, filled with the ground colour shifted about 4 % in lightness (OKLCH 0.03-0.04), lighter on dark grounds, darker on light ones.
- Holds one shot of 80-100 f (1.3-1.7 s); scale 1.00 to 1.02 linear across it, well under 1 px per frame.
- Contrast stays under about 6 %, or it competes with the copy.
- Arrives and leaves on cuts; no fades.

## Sound for it

None.

## Common mistakes

- Generic decoration with no meaning.
- Contrast above about 6 %, which fights the copy.
- Small vertical frames where 13 px dots read as noise; scale the pitch up instead.
- Avoid when: Generic decoration with no meaning; contrast above ~6%, where it starts competing with the copy; small vertical frames where 13 px dots read as noise (scale the pitch up instead).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-dot-matrix-silhouette`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
