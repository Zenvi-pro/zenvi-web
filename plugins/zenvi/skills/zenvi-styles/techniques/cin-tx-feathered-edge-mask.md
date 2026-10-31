---
id: cin-tx-feathered-edge-mask
kind: technique
summary: "When lists, reels or chats overflow the frame: rows dissolve into the stage at a soft edge instead of a hard crop."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, set_keyframes_tool, add_title_tool, add_shape_mask_tool]
pace: calm
mood: [endless, fluid, clean]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [shot-brake-scroll, shot-list-item-entrance, shot-picker-carousel]
avoid_with: [cin-tx-surface-edge-finish]
needs: []
drawn: cinetic
---

# Feathered edge mask

cinetic `tx-feathered-edge-mask` · Texture and finish · workhorse · energy any · formats walkthrough, feature, loop, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Lists, reels and overflowing lines dissolve into the stage at a soft edge instead of being cut by a hard crop, so content feels endless and the eye stays in the clear middle.

Use when: Endless-feeling lists, proof reels, logs, chats, card stacks, and type that overflows its line as it is typed.

## Build it in Zenvi

1. The moving content: `add_motion_block_tool {"block": "chat_thread", "position_seconds": 0, "duration_seconds": 8, "params": {"messages": ["Hi", "Make a launch film", "Done in 1 min"]}}`, or a tall list clip scrolled with `set_keyframes_tool {"property": "location_y", "points": [{"seconds": 0, "value": 0}, {"seconds": 0.5, "value": -0.12, "ease": "ease_out_expo"}]}` (26-40 f = 0.43-0.67 s per step).
2. Soft top and bottom edges as stage-colour covers above the content, feathered 10-15 % of the container: `add_title_tool {"text": " ", "background_color": "<stage>", "position_seconds": 0, "duration_seconds": 8, "track": "<above_content>"}` with `add_shape_mask_tool {"clip_ids": ["<top_cover>"], "shape": "rectangle", "x": 0.5, "y": 0.0, "width": 1.2, "height": 0.2, "feather": 0.14}`, and the mirror cover at `y: 1.0` for the bottom.
3. For a typed line that follows its caret: a left cover `add_shape_mask_tool {"shape": "rectangle", "x": 0.0, "y": 0.5, "width": 0.15, "height": 1.2, "feather": 0.14}` and slide the text left by its overflow.
4. The covers never move; text under the mask moves at most 20 px per frame while it must read.

Fallback: Zenvi fades content into the stage with feathered colour covers rather than a transparent mask on the content itself, so the stage must be a flat colour or the covers show on a photo.

## Timing & taste rules

- cinetic's timing (60 fps): Feather 10-15% of the container; list steps 26-40 f (0.67 s) on ease_out_cubic, or inertia(f, s, 30-60, 0.89) for a proof reel; text under the mask at most 20 px/f while it must read; the mask itself never moves.
- Feather 10-15 % of the container (120-160 px at 1080p): shorter reads as a crop, longer greys out readable rows.
- List steps 26-40 f (0.43-0.67 s, ease_out_expo) or a flicked reel coasting 30-60 f (0.5-1.0 s).
- Text under the mask moves at most 20 px per frame while it must read.
- The mask itself never moves.

## Sound for it

None, or the scroll's own soft ticks (see the micro-tick UI sound).

## Common mistakes

- Content that must be read right at the container edge.
- A hard-cropped bento look, or using it as a full-frame vignette (that is lighting, not a mask).
- Feathers so long they grey out rows the viewer is still reading.
- Avoid when: Content that must be read right at the container edge; a hard-cropped bento look; as a full-frame vignette (that is lighting, not a mask).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`tx-feathered-edge-mask`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
