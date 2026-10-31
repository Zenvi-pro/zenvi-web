---
id: cin-tr-dot-relay
kind: technique
summary: "When something goes in and comes out changed: the hero collapses to a dot that opens into a check, avatar or mark."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_shape_mask_tool, set_keyframes_tool, add_type_block_tool, add_sfx_tool]
pace: medium
mood: [precise, satisfying, product]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-type-to-pill, shot-ui-to-brand-morph, cin-tr-shape-match-cut]
avoid_with: [kcut-collapse-cut]
needs: []
drawn: cinetic
---

# Collapse to a dot relay

cinetic `tr-dot-relay` · Transition · signature · energy medium · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The hero collapses into one small dot, or the whole world shrinks into it. The dot, the only thing that survives, opens into the next object: a check ring, an avatar, the mark.

Use when: Submit, send, process, receive: actions that mean 'this went in and came out as that'. Also the film's signature device when the mark contains a dot.

## Build it in Zenvi

1. Collapse the hero to a 24-52 px dot: `add_shape_mask_tool {"clip_ids": ["<hero>"], "shape": "ellipse", "x": 0.5, "y": 0.5, "width": 0.5, "height": 0.3, "feather": 0.01, "keyframes": [{"seconds": <t>, "grow": 0}, {"seconds": <t+0.067>, "grow": -0.46}]}` over 4 f (0.07 s) into a cut, or 16 f (0.27 s) when it snaps and holds. Keep the dot at full opacity through the seam.
2. To take the world with it, start 15 f (0.25 s) later: `set_keyframes_tool {"timeline_clip_id": "<world>", "property": "scale_x", "mode": "replace", "points": [{"seconds": <t+0.25>, "value": 1.0}, {"seconds": <t+0.65>, "value": 0.03, "ease": "ease_in_cubic"}]}` (and `scale_y`): 24 f (0.4 s) for a dot near centre, 40 f (0.67 s) for a dot near a corner.
3. Open the dot into a check ring: `add_type_block_tool {"block": "write_on", "paths": ["M 8 22 L 18 31 L 36 12", "M 24 2 A 22 22 0 1 1 23.9 2"], "view_box": [0, 0, 48, 48], "position_seconds": <t+0.67>, "duration_seconds": 1.2, "draw_seconds": 0.13, "stroke_width": 4, "width": 0.14, "x": 0.5, "y": 0.5}` and its label 4 f (0.07 s) later with `add_kinetic_title_tool`. For an avatar disc, `add_shape_mask_tool` grows an ellipse; for the mark, `add_clip_to_timeline_tool` with scale 0.6 to 1.
4. `add_sfx_tool {"recipe": "pop", "at_seconds": <t+0.67>, "gain_db": -12}`.

## Timing & taste rules

- cinetic's timing (60 fps): Collapse: 4 f (0.07 s) (ease_in_cubic, into a cut) or 16 f (0.27 s) (ease_out_expo, snap and hold). World shrink: 24 f (0.40 s) on ease_in_cubic for a dot near centre (edges ≤ 66 px/f), or 40 f (0.67 s) for a dot near a corner, starting 15 f (0.25 s) after the collapse. Reopen over 8-12 f (0.20 s). Any device rotation that follows settles over 28 f (0.47 s) on ease_out_expo.
- Collapse 4 f (0.07 s) on an ease-in when feeding a cut, or 16 f (0.27 s) on ease-out when it snaps and holds.
- World shrink 24 f (0.4 s) with a dot near centre (edges <= 66 px/f), 40 f (0.67 s) near a corner, starting 15 f (0.25 s) after the collapse.
- Dot is 24-52 px at 1080p and never changes size or colour at the seam.
- Reopen over 8-12 f (0.13-0.20 s); a check ring draws in 8 f, its label 4 f later; a device turn that follows settles over 28 f (0.47 s).
- Corner radius grows to 50 % with a 40 px feathered mask edge.

## Sound for it

One `pop` when the dot opens into the check or mark; the collapse is silent or a very soft `whoosh_short`.

## Common mistakes

- The dot blinks out or changes size or colour at the seam, or the film already has an implosion seam (avoid_when).
- Collapsing and reopening at different screen points.
- Starting the world shrink on the same frame as the collapse: it should follow 15 f later.
- Avoid when: The dot would blink out or change size or colour at the seam, or the film already has an implosion seam.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tr-dot-relay`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
