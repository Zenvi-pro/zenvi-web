---
id: ui-card-over-the-speaker
kind: technique
summary: "When proof is a screen (DMs, orders, an app): a rounded card over the speaker's torso for 3-6 s, face kept clear."
categories: [podcast-clip-vertical, talking-head-captions]
tools: [add_motion_block_tool, set_clip_properties_tool, add_sfx_tool, set_keyframes_tool, add_clip_to_timeline_tool]
pace: medium
mood: [informative, credible, modern]
aspect: ["9:16", "4:5"]
pairs_with: [karaoke-word-highlight-captions, screen-capture-zoom-onto-the-number, slide-in-pill-badge-and-name-cards]
avoid_with: [text-between-subject-layers]
needs: []
---

# UI card over the speaker

## What it is
A rounded screen card (notifications, a DM, an order list, a screenshot) floats
over the speaker's lap or chest at about 85 % frame width, below the eyes, for
3-6 s. Proof shows without cutting away from the face.

## Build it in Zenvi
1. The card: a motion block over the video,
   ```json
   add_motion_block_tool {"block": "notification_stack", "placement": "over_video",
     "position_seconds": 1.0, "duration_seconds": 4.0,
     "params": {"items": ["Order #1042 shipped", "Order #1043 shipped",
       "You made $1,280 today"], "app": "Shop", "position": "auto"}}
   ```
   (`glass_cards` with the head clip as `background`, `chat_thread`, `code_card`
   for other proofs; real words, never placeholder lines.)
2. Move it off the face: the block's `position` only knows auto/top/center/right,
   and auto put it over the eyes. Take its clip id from the receipt and
   `set_clip_properties_tool {"timeline_clip_ids": ["<block clip>"],
   "properties": {"location_y": 0.42}}` (lower third of the frame).
3. A real screen recording instead: `add_clip_to_timeline_tool` on a track above,
   `set_clip_properties_tool` scale 0.8, location_y 0.25, `set_keyframes_tool`
   alpha 0 to 0.65 in 6 frames for the ghosted version.
4. `add_sfx_tool {"recipe": "notification_blip", "gain_db": -18}` on the first
   card; vary or skip on the rest.

## Timing & taste rules
- 3-6 s on screen; enter within 0.3 s of the line that names it.
- Card bottom edge inside the 9:16 safe area (above the bottom 20 %); top edge
  below the chin.
- One card system per piece; the last item can turn accent colour as payoff.

## Sound for it
One blip or click per card at -18 dB (12-20 dB under the hero hit); a whoosh
-20 dB if the card flies in. Never stack identical blips.

## Common mistakes
- Default position over the face (seen in the test).
- Placeholder grey lines instead of real words.
- Cards vanish on a hard cut with no exit: let the block's own exit play or cut
  with the shot change.

## Verified
2026-10-28: 6 s ring-light head (stock), notification_stack over video, blip.
First render: the stack sat over the eyes; moved down with `location_y` 0.42.
Contact sheet: cards stack on the chest, face clear. Watch judge typography 6,
overall 4.91; fixes: give the cards an outro and vary the dings.
