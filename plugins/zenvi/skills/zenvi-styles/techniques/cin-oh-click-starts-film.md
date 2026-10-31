---
id: cin-oh-click-starts-film
kind: technique
summary: "When one action is the product: a cursor already travelling presses the only button and it floods into scene one."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, add_clip_to_timeline_tool, add_shape_mask_tool, add_sfx_tool]
pace: medium
mood: [clean, decisive, minimal]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, prompt-bar-typing-hero]
avoid_with: [cin-oh-live-grid-cold-open]
needs: []
drawn: cinetic
---

# A click starts the film

cinetic `oh-click-starts-film` · Opening hook · accent · energy medium · formats feature, walkthrough, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

From frame 0 a cursor is already travelling toward the one button on an otherwise bare stage; it presses, and the button floods open into the first scene.

Use when: UI walkthroughs and feature films where a single action is the product ('one click to ...').

## Build it in Zenvi

1. Cursor and button on a bare paper stage: `add_motion_block_tool {"block": "cursor_path", "position_seconds": 0, "duration_seconds": 0.75, "placement": "full_frame", "params": {"points": [[0.2,0.25],[0.5,0.56]], "labels": ["Generate"], "clicks": true, "cursor_size": 1.6, "palette": "paper"}}`. The cursor is already mid-path at f0 (clock starts 6 f / 0.1 s early); arrive f18 (0.3 s), press f22 (0.37 s).
2. Button dip: if the button is a separate title or shape, `set_keyframes_tool {"timeline_clip_id": "<button>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0.33, "value": 1.0}, {"seconds": 0.37, "value": 0.97}, {"seconds": 0.5, "value": 1.0, "ease": "ease_out_back"}]}` (4 f down, 8 f recoil).
3. First scene on the track above, masked to a growing circle from the button: `add_clip_to_timeline_tool {"file_id": "<scene1>", "position_seconds": 0.35, "track": 3}` then `add_shape_mask_tool {"clip_ids": ["<scene1>"], "shape": "ellipse", "x": 0.5, "y": 0.56, "width": 0.12, "height": 0.12, "feather": 0.01, "keyframes": [{"seconds": 0.35, "grow": -0.5}, {"seconds": 0.75, "grow": 3.0}]}`, f21-f45 (0.35-0.75 s), ease-out.
4. Scene live from f45 (0.75 s).
5. `add_sfx_tool {"recipe": "mouse_click", "at_seconds": 0.36, "gain_db": -10}`: 0-1 f before the press, nothing before it.

Fallback: The iris grows linearly; for the ease-out look add two keyframes (a fast first half) rather than one long ramp.

## Timing & taste rules

- cinetic's timing (60 fps): Cursor arrives f18 (0.30 s); press f22 (4 f (0.07 s) down, 8 f (0.13 s) recoil); iris f21 (0.35 s)-45; first scene live from f45 (0.75 s).
- Cursor arrives f18 (0.30 s); press f22 (0.37 s), 4 f down, 8 f recoil, button dips 3 %.
- Iris starts one frame before the press, runs 24 f (0.40 s, f21-45) on an ease-out, from the button's centre.
- First scene is live from f45 (0.75 s).
- Stage is paper, a single button slightly below centre, nothing else.
- Frame 0 is already mid-path.

## Sound for it

One `mouse_click` on the press frame (0-1 f early); nothing before it.

## Common mistakes

- Products that act on their own, or films where the cursor never returns after the hook (avoid_when): the cursor then breaks continuity.
- A cursor that starts at rest on frame 0: it must already travel.
- More than one button: the stage is bare so the click is the only event.
- Avoid when: Products that act on their own, or films where the cursor never returns after the hook (it breaks continuity).

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-click-starts-film`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
