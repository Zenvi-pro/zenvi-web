---
id: shot-stack-press-count
kind: technique
summary: "When new things keep arriving (feed, inbox, sources): cards land and stack with weight while a counter ticks per card."
categories: [saas-app-launch, tech-review, video-essay-explainer, news-short-vertical-explainer, ugc-ad-testimonial, brand-story-corporate]
tools: [add_motion_block_tool, add_sfx_tool, set_clip_properties_tool]
pace: medium
mood: [busy, productive, modern]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [kinetic-counter, T062, shot-card-stack-fan]
avoid_with: [shot-list-item-entrance, shot-carousel-ring]
needs: []
---

# Stack-press feed with a ticking counter

## What it is
Cards fly in one after another and pile up; each new card presses the pile down and the older ones recede, smaller, dimmer
and softer (only the newest is crisp and readable). A number ticks one step per landed card, so the count is felt before
it is read. Shines on "every day there is something new": feeds, radar, inboxes, sources read, documents processed.

## Build it in Zenvi
Dim the footage so the UI reads, then two blocks over it (landscape: stack on the right, counter on the left):
```json
set_clip_properties_tool {"scope": "all", "properties": {"alpha": 0.5}}
add_motion_block_tool {"block": "notification_stack", "position_seconds": 0, "duration_seconds": 5,
  "params": {"items": ["Source one: Report filed", "Source two: Dataset added", "Source three: Paper indexed",
  "Source four: Page saved", "Source five: Notes merged"], "style": "notification", "app": "Library", "time": "now",
  "highlight_last": true, "position": "right", "palette": "dark"}}
add_motion_block_tool {"block": "counter", "position_seconds": 0.2, "duration_seconds": 4.6,
  "params": {"values": ["0","1","2","3","4","5"], "suffix": "", "label": "ADDED TODAY", "style": "odometer",
  "weight": 700, "align": "left", "palette": "dark"}}
add_sfx_tool {"recipe": "pop", "at_seconds": 0.35, "gain_db": -18, "seed": 1}   // then 0.9, 1.45, 2.0, 2.55; new seed each
```
On 9:16 use `"position": "top"` and keep the counter out of the card area (it is centred; shorten the cards or accept it
below them). Counter values = one per card plus the start; the block's own pacing puts cards about 0.55 s apart, so match the
pops to that.
`needs` nothing; the "pile gets pressed down 6 px per landing" detail is inside the block.

## Timing & taste rules
- A card every 0.4-0.55 s (12 f) is "tight but readable"; below 8 f the titles cannot be read, above 20 f it is a slideshow.
- Each landing presses the pile 6 px for 8 f; the pile never has more than about 3 half-sharp cards.
- 5-6 cards max per block; the last one in the accent colour is the punchline, once.
- Counter ticks once per landing and must finish before the next (single digit roll under 0.4 s).
- Keep the footage under it at 50 % or less; a straight-on camera, no tilt on list/stack shots.

## Sound for it
One soft `pop` per card at -18 dB, new `seed` each (never the same sample twice running); no whoosh per card. A single
`ui_tap` or `impact_thud` on the accent card if it is the payoff.

## Common mistakes
- Counter and stack colliding (the counter is huge): put them on opposite sides, drop the suffix.
- Counter out of step with the landings: every ticked number must have a card landing under it.
- Stacking the cards without the press-down (reads as plain layout); or 8+ cards (a wall, not a pile).
- Using this and a second stack/list move in the same piece: one hero stack per edit.

## Verified
2026-10-29, CLI on bench footage (pexels_9057559): scripts/shot-stack-press-count.sh → shots/shot-stack-press-count.mp4 (local only). Checked on the sheet: five dark cards land on the right and recede, the odometer counts 0 to 5 on the left, the last card turns accent; the first take had the counter under the cards on a 16:9 frame, so it moved left (and lost its suffix). Watch judge (absolute): **6.1/10**; main note: "The stacking card physics and synchronized counter tick deliver the exact technical brief smoothly and cleanly. However, the background stock footage is slightly muddy and competes with the UI overlays."

Adapted from video-shotcraft cards `shots/ui-entrance/list-stack-press.md` and `shots/ui-entrance/research-card-stack-scroll.md` (Apache-2.0; see ../NOTICE).
