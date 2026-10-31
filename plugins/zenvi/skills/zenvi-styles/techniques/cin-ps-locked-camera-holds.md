---
id: cin-ps-locked-camera-holds
kind: technique
summary: "When the interface must be read: after each camera move the frame stops dead and only the caption and cursor move."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [screen_zoom_follow_tool, set_keyframes_tool, add_motion_block_tool, add_kinetic_title_tool]
pace: calm
mood: [deliberate, calm, premium]
aspect: ["16:9", "1:1"]
pairs_with: [cin-lc-negative-space-caption, cin-ps-one-long-hold, shot-cursor-flyover]
avoid_with: [cin-ps-breath-envelope, kcut-hit-fx]
needs: []
drawn: cinetic
---

# Camera locks, the interface performs

cinetic `ps-locked-camera-holds` · Pacing and structure · workhorse · energy calm · formats walkthrough, feature, launch. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

After each move the camera stops dead, and for a 1-4 s read only the caption, the cursor and one micro-interaction move.

Use when: Dense product UI that must be read, walkthroughs, and films where every move should feel deliberate because it contrasts with stillness.

## Build it in Zenvi

1. The moves between poses: `screen_zoom_follow_tool {"clip_id": "<screen>", "zoom": 1.3, "ease": "ease_in_out_sine", "min_hold": 2.5}` or by hand `set_keyframes_tool {"timeline_clip_id": "<screen>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 0, "value": 1.0}, {"seconds": 1.4, "value": 1.3, "ease": "ease_in_out_sine"}]}` (moves 56-108 f, 0.93-1.8 s).
2. At each pose hold exactly: no keyframes after the move's last point, constant scale, 0 px/f. A micro-interaction at move end - 10 f (0.17 s): `add_motion_block_tool {"block": "cursor_path", "position_seconds": 1.2, "duration_seconds": 3.0, "placement": "over_video", "params": {"points": [{"x": 0.4, "y": 0.5}, {"x": 0.62, "y": 0.56}], "labels": ["Save"]}}`.
3. Caption from the move's end minus 25 % of its length: `add_kinetic_title_tool {"text": "<caption>", "style": "documentary", "animation": "rise", "position_seconds": 1.05, "duration_seconds": 2.4}`; it leaves as one block, alpha 1 to 0 over 26-28 f (0.43-0.47 s), `ease_in_out_sine`, ending 0-56 f (0-0.93 s) before the next move.
4. Ambient life only in the background: a `gradient_field` block or a wash breathing by 3 % opacity on a 4 s sine.
5. Make sure there is a visible change at least every 40 f (0.67 s).

## Timing & taste rules

- cinetic's timing (60 fps): Holds 60-240 f (4.00 s) (median about 150 f (2.50 s)) at exactly 0 px/f; an in-frame event at least every 40 f (0.67 s); moves between holds 56-108 f (1.80 s) ease_in_out_sine; caption exit 26-28 f (0.47 s) ease_in_out_sine, ending 0-56 f (0.93 s) before the next move.
- Holds 60-240 f (1-4 s), median about 150 f (2.5 s), at exactly 0 px/f; an in-frame event at least every 40 f (0.67 s).
- Moves between holds 56-108 f (0.93-1.8 s) on ease_in_out_sine.
- UI action at move end - 10 f (0.17 s); caption word reveal at move end - 25 % of the move; cursor travel on ease_in_out_sine.
- Caption exit 26-28 f (0.43-0.47 s) with no stagger.

## Sound for it

Cursor clicks and toggles get their ui_tap, mouse_click or toggle at -16 dB; camera moves usually get a soft swish_airy at -20 dB or nothing.

## Common mistakes

- Kinetic type or fast montages: a dead camera reads as a stalled player.
- A hold with nothing in the UI to animate.
- Adding a drift or breath at a pose: the stop must be exact.
- Avoid when: Kinetic type or fast montages where a dead camera reads as a stalled player, or holds with nothing in the UI to animate.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-locked-camera-holds`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
