---
id: shot-type-and-filter
kind: technique
summary: "When a feature is shown by doing it: a query typed at human speed, the grid answers with one card, a pointer opens it."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [add_motion_block_tool, add_sfx_tool]
pace: medium
mood: [calm, precise, demonstrative]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-control-state-change, shot-canvas-materialize, kinetic-typewriter]
avoid_with: [shot-picker-carousel]
needs: [grid-cell-reflow]
---

# Type, filter, open

## What it is
The one shot where a person visibly does the thing: letters appear in a search box, the page reacts, a pointer lands on the result and clicks. The
viewer should be able to follow along. It is the calm beat after a dense, high-energy stretch.

## Build it in Zenvi
Two states of the screen (full grid, and the filtered grid with the hit in the first slot) as stills or captures. Typing is `prompt_bar` over the full
grid; the answer is `cursor_path` whose `background` is the filtered screen (blocks that carry their own backdrop are placed full frame):
```json
add_motion_block_tool {"block": "prompt_bar", "params": {"prompt": "nano-lab", "placeholder": "Search projects", "status": "", "cursor": false, "position": "upper"},
  "position_seconds": 0, "duration_seconds": 2.7, "placement": "over_video"}
add_motion_block_tool {"block": "cursor_path", "params": {"background": "<filtered_screen_file_id>", "points": [{"x": 0.34, "y": 0.36}], "labels": ["Open project"], "zoom": 1.4, "clicks": true},
  "position_seconds": 2.7, "duration_seconds": 3.0, "placement": "full_frame"}
add_sfx_tool {"recipe": "keyboard_key", "at_seconds": 0.65, "seed": 1, "gain_db": -14}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": 4.9, "gain_db": -8}
```
One `keyboard_key` per character (vary `seed`, +0.1 s apart, matched to the typing on the sheet). The grid answering is a cut here
(`needs: grid-cell-reflow` for the staggered fade-and-sink of the non-matching cards, in reading order, 5 frames each with 0.4-frame offsets).
Nearest fallback: a `blur_dissolve` motion transition (0.25 s) on the cut, or cards faded one by one if they are separate clips.

## Timing & taste rules
- Typing at 3 frames (0.1 s) per character, steady cursor while typing and blinking after (the switch says "done"). First drafts are always too fast.
- Leave ~11 frames (0.37 s) between the last letter and the filter; instant filtering reads as scripted.
- Non-matching cards leave in reading order, staggered, each fading with an 8 px sink; the hit card slides to the real first slot in 10 frames
  (it rises a little and its shadow widens), never hovering in the middle of the page.
- Pointer: slides in the full frame at constant on-screen size, a double ring ripple in the accent (second ring 3 frames later, 10 frames each), then a
  16-frame push-in to ~2.2x that hands off to the next scene.
- Screenshot text must be re-typed on a clean search field, not on a baked-in placeholder.

## Sound for it
Keyboard foley matched to the real number of letters; the click is the loudest event in the shot (-8 dB); a short `whoosh_short` as the cards leave if used.

## Common mistakes
- Typing and filtering at machine speed.
- The result card not landing in the grid's real slot.
- Single weak ripple.

## Verified
2026-10-29, CLI on generated boxes-only dashboard mocks: scripts/shot-type-and-filter.sh → shots/shot-type-and-filter.mp4 (local only). Checked on the sheet: "nano-lab" types in the prompt bar over the 6-card grid, hard cut to the one-card screen, pointer travels to the card, accent outline, "Open project" label and click; the filter is a cut (no reflow tool). Watch judge (absolute): **6.6/10**; main note: "The typing cadence and responsive filtering effectively deliver a clear, readable UI micro-interaction... However, the hard cut when filtering cards feels jarring, and the cursor movement lacks realistic easing."

Adapted from video-shotcraft card `shots/interaction/type-and-filter.md` (Apache-2.0; see ../NOTICE).
