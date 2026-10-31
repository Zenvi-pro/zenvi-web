---
id: prompt-bar-typing-hero
kind: technique
summary: "For an AI or app hook: a prompt bar types the request with keyboard foley, the cursor clicks send, cut on the click."
categories: [kinetic-type-motion-design, saas-app-launch]
tools: [add_motion_block_tool, list_motion_blocks_tool, add_sfx_tool, automate_volume_tool, apply_motion_transition_tool, detect_beats_tool]
pace: medium
mood: [modern, clean, curious]
aspect: ["9:16", "16:9", "1:1"]
pairs_with: [beat-locked-kinetic-type-cuts, withheld-music-cold-drop, grid-cell-reflow-and-collapse]
avoid_with: [comic-burst-insert, commentary-hits-with-dense-designed-cues]
needs: []
---

# Prompt bar typing hero

## What it is
The first frame is a pill-shaped input that types the premise with a blinking
caret; the pointer clicks send, a status pill appears, and the edit cuts on
the click into the result. 6 of 20 motion-design reels open this way; it is
also the AI-product promo hook.

## Build it in Zenvi
```json
add_motion_block_tool {"block": "gradient_field", "position_seconds": 0, "duration_seconds": 4,
  "params": {"style": "orbs", "colors": ["#1e6fff", "#0a0f24", "#7f5cff"], "exit": false}}
add_motion_block_tool {"block": "prompt_bar", "position_seconds": 0, "duration_seconds": 4,
  "params": {"prompt": "cut my ride footage to the drop", "placeholder": "Describe the edit",
             "status": "Editing…", "palette": "night"}}
add_sfx_tool {"recipe": "typing_burst", "at_seconds": 0.7, "align": "start", "duration": 1.8, "gain_db": -14}
add_sfx_tool {"recipe": "mouse_click", "at_seconds": <click>, "gain_db": -12}
add_sfx_tool {"recipe": "impact_punch", "at_seconds": <cut>, "gain_db": -7}
automate_volume_tool {"role": "music", "shape": "dip", "start_seconds": 0, "end_seconds": <cut - 0.05>, "db": -10}
```
- The click lands about 75 % into the block (3.0 s of 4); cut 1 s later, or
  shorten the block so the click is the cut.
- Start the music so its drop lands on the cut (start_seconds = drop - cut).
- Over footage: put a still or the product UI in `glass_cards` instead of the
  gradient.

## Timing & taste rules
- Prompt 4-8 words, typed in 1.5-2 s; a 12-word prompt is unreadable on 9:16.
- The payoff must answer the prompt (judge: "the prompt asked for ride footage,
  then showed a surfer"). Cut 3-4 result shots on beats, all the same world.
- One prompt bar per piece, at the open.

## Sound for it
Keyboard foley at -14 to -18 (UI under hero), a click on send, then the drop
and a punch on the cut: the silence-to-drop contrast is the hook.

## Common mistakes
- A single uncut clip after the click (pass 1, judge 5.45).
- Music at full level under the typing; it masks the keys.

## Verified
2026-10-29: 7.5 s 9:16 tests. Pass 1: one bike shot after the click, 5.45.
Pass 2: four beat-cut shots after the click with the trap drop on the cut,
5.09 (the off-theme surf shot cost it). Typing, caret and cursor click render
cleanly; keep the payoff on-brief.
