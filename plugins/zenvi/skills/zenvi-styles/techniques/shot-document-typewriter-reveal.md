---
id: shot-document-typewriter-reveal
kind: technique
summary: "When a doc or report feature must be read: a page writes itself in a floating window, a history rail fills."
categories: [saas-app-launch, product-launch-film, tech-review, animated-explainer]
tools: [add_motion_block_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [clear, productive, information-dense]
aspect: ["16:9"]
pairs_with: [shot-blur-slide, kinetic-typewriter, shot-title-demote-to-label]
avoid_with: [kinetic-beat-strobe, kinetic-word-pop, shot-glitch-cycle]
needs: [document-window-typewriter]
---

# Document that writes itself

## What it is
A full page of properly typeset text floats as a rounded, back-lit window in a dark field. A pen-tip caret writes it block by block
(pairs of blocks, a single caret at a time), names get an accent highlight after they are written, two side columns wipe on, and
history entries drop into a side rail one by one with a pop each. The camera starts tight and oblique on the title and pulls back
to the full window. The persuasion is that the document is real and readable: report, notes and doc features.

## Build it in Zenvi
There is no block that types a typeset document (`needs: document-window-typewriter`). Closest native pieces:
```json
add_motion_block_tool {"block": "code_card", "position_seconds": 0.2, "duration_seconds": 5, "placement": "over_video",
  "params": {"filename": "weekly-report.md", "language": "shell", "code": "# Weekly report\n\n- Shipped the opener\n- Renders down to 2 min\n\nNext: client review", "output": "Saved weekly-report.md"}}
add_motion_block_tool {"block": "notification_stack", "position_seconds": 2.2, "duration_seconds": 2.8, "placement": "over_video",
  "params": {"style": "notification", "app": "History", "items": ["Draft saved", "Notes merged", "Chart added", "Shared with team"], "position": "right", "highlight_last": false}}
add_sfx_tool {"recipe": "typing_burst", "at_seconds": 0.3, "align": "start", "duration": 1.8, "gain_db": -18}
add_sfx_tool {"recipe": "pop", "at_seconds": 2.2, "gain_db": -14}     (then four more, each 5 frames later, gain -14, -16, -18, -20, -22)
```
For a real-looking page, capture or import a screenshot / screen recording of an actual document and use `add_clip_to_timeline_tool`;
reveal it with a keyframed `Crop` per block, or lay `add_motion_template_tool {"template": "crop_labels"}` over it. The camera
pull-back is `set_keyframes_tool` on the page clip's scale_x/scale_y from 1.42 to 0.86 with a small downward drift (titles and
clips scale from their top-left corner: move location with the scale to keep the centre).

## Timing & taste rules
- Write pace: 20 blocks in pairs, pair g starts at frame 8 + 4.4 g, each block's wipe 9 frames, the last pair done by frame 57; do the arithmetic first (blocks x pace must fit the budget).
- One caret only (3 px, accent), riding the wipe front inside the real text width and gone 2 frames after the last glyph.
- Name highlight starts 4 frames after its wipe, grows over 8 frames at 40 % opacity, multiply blend (normal washes the ink pale).
- Side columns enter off the main beat (frames 54 and 62), 10 frames top to bottom with a 2 px accent edge line that fades over 24 frames.
- History entries: six, one every 5 frames from frame 66, each dropping 48 px in 9 frames with a tiny bounce, after the side wipe has finished.
- Camera: zoom 1.42, yaw -18, pitch 8 at the start (window corner and glow in frame), full window at 0.86 by frame 64, then 0.74 with a 78 px lift to make room for the tagline; start closer than 1.6x and only paper is left.
- Window floats (rounded, lit edge, back glow, long shadow), it does not fill the frame; warm page in a cool dark field.

## Sound for it
Keyboard foley trimmed to the write window (about 50 frames, equal length to the action). Six pops, one every 5 frames, stepping down 0.40 to 0.25 in level to fake distance.

## Common mistakes
- A mock page that is a texture with a caption: it must be fully typeset and legible, side rail visible.
- Real people's names or customer data in the page.
- Several carets at once, or the history entries dropping before the side column has finished.

## Verified
Not rendered yet: translated from the card; the tool calls are checked against the tool reference.

Adapted from video-shotcraft card `shots/typography/document-typewriter-reveal.md` (Apache-2.0; see ../NOTICE).
