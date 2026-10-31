---
id: cin-oh-pile-up-freeze-turn
kind: technique
summary: "When the pain is volume: cards pile in faster and faster, freeze in silence, then the turn lands on a downbeat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [add_motion_block_tool, freeze_frame_tool, add_sfx_tool, automate_volume_tool]
pace: frantic
mood: [overwhelmed, tense, comic]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [shot-stack-press-count, blackout-and-dead-silence-pause, kcut-collapse-cut]
avoid_with: [cin-oh-quiet-intro-drop, cinematic-push-in]
needs: [accelerating-stagger-control]
drawn: cinetic
---

# Problem pile-up, freeze, turn

cinetic `oh-pile-up-freeze-turn` · Opening hook · workhorse · energy high · formats launch, feature, vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The film opens inside the problem: cards, alerts or rows pile in faster and faster while a counter climbs, the picture freezes for a breath of true silence, and the turn hits on the downbeat.

Use when: Problem-first launches whose pain is volume: notifications, tickets, tabs, invoices.

## Build it in Zenvi

1. The pile: `add_motion_block_tool {"block": "notification_stack", "position_seconds": 0, "duration_seconds": 1.7, "params": {"items": ["Invoice overdue","Build failed","New ticket (14)","Sync error","Alert: CPU 94%","Inbox (212)"], "style": "notification", "position": "center"}}`: 14 arrivals in ~100 f (1.7 s), gaps 14, 12, 11, 9.5 ... down to 4 f (0.23 s, 0.07 s).
2. Counter in a corner: `add_motion_block_tool {"block": "counter", "position_seconds": 0, "duration_seconds": 1.7, "params": {"values": ["0","212"], "style": "count", "align": "left"}}`, scaled to 0.4 with `set_keyframes_tool` on `scale_x/y` and `location_x -0.3`, `location_y -0.3`.
3. Camera creep on the pile: `scale_x/scale_y` `[{"seconds": 0, "value": 1.0}, {"seconds": 1.7, "value": 1.04, "ease": "ease_in_cubic"}]`.
4. Freeze at peak density: `freeze_frame_tool {"timeline_clip_id": "<pile>", "frame": "last", "hold_seconds": 0.25}`; cut the bed dead: `automate_volume_tool {"role": "music", "shape": "dip", "start_seconds": 1.7, "end_seconds": 1.95, "db": -60, "fade_ms": 10}`.
5. The turn on the next downbeat (1.95 s): cut to the answer shot or `apply_motion_transition_tool {"preset": "squash", "time": 1.95, "duration": 0.2}`. Ticks: `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 0.1, "gain_db": -26}`, repeated per card, each 1 dB louder, ending in the silence.

Fallback: The block spaces cards evenly; for an accelerating pile, split into three notification_stack blocks of 4, 5 and 5 items at 1.0 s, 0.5 s and 0.2 s total length, back to back.

## Timing & taste rules

- cinetic's timing (60 fps): 14 arrivals in about 100 f (1.67 s) (gaps 14, 12, 11, 9.5, 8.4 ... down to 4 f (0.07 s)); freeze of 15 f (0.25 s) at most; turn on the next downbeat.
- Arrival gaps: gap_k = max(4, 14 x 0.88^k) f, i.e. 14, 12, 11, 9.5 ... 4 f (0.23 s down to 0.07 s); 14 cards in ~100 f.
- Each card rises from +40 px with opacity over 8 f (0.13 s), rotation random within +/-3 degrees.
- Freeze at most 15 f (0.25 s); bed and every tail cut dead.
- Frame 0 already holds 2-3 overlapping cards.
- The turn lands on the next downbeat: the pile implodes on an ease-in, or the frame cuts to the answer.

## Sound for it

One soft `ui_tap` per card, each 1 dB louder than the last, ending in the 0.25 s of silence; the downbeat gets the hit.

## Common mistakes

- Using it when the pain is not about quantity, or in a calm brand film (avoid_when).
- A freeze longer than ~15 f: it reads as a dropped frame.
- Even card spacing: the acceleration is the point.
- Avoid when: The pain is not about quantity, the brand film is calm, or the film already uses its one freeze elsewhere.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`oh-pile-up-freeze-turn`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
