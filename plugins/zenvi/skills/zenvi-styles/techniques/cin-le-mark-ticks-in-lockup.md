---
id: cin-le-mark-ticks-in-lockup
kind: technique
summary: "When the story device became part of the mark: during the hold that piece gives one or two small ticks on the beat."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [add_clip_to_timeline_tool, set_keyframes_tool, add_sfx_tool]
pace: calm
mood: [alive, subtle]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [cin-le-living-hold, cin-le-device-becomes-mark]
avoid_with: [blackout-and-dead-silence-pause]
needs: []
drawn: cinetic
---

# Device keeps time inside the lockup

cinetic `le-mark-ticks-in-lockup` · Logo and end card · accent · energy calm · formats launch, feature, loop, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

During the hold, the story device that became part of the mark (a dot, a bar, a stripe) gives one or two small ticks on the beat, so the bookend plays inside the finished lockup instead of after it.

Use when: Films whose story device became a piece of the mark. Ends that should close the device's loop without ending on the device alone.

## Build it in Zenvi

1. Keep the device as its own clip layered over the mark: `add_clip_to_timeline_tool {"file_id": "<device piece>", "position_seconds": 5.0, "duration_seconds": 3.0, "track": "4"}` aligned with the lockup.
2. One or two ticks on downbeats inside the first second of the hold (at least 30 f, 0.5 s apart): `set_keyframes_tool {"timeline_clip_id": "<device>", "property": "scale_x", "points": [{"seconds": 5.4, "value": 1.0}, {"seconds": 5.433, "value": 1.12, "ease": "ease_out_expo"}, {"seconds": 5.53, "value": 1.0, "ease": "ease_out_expo"}]}` (same on `scale_y`; 2 f attack, 6 f decay, 10-14 % scale), or a 2-4 px nudge on `location_x/y` along the device's signature direction.
3. If the accent means what just landed: `alpha` of an accent copy 0 to 1 to 0 over 12 f (0.2 s) on the same frame.
4. None in the last 30 f (0.5 s) so the final frame is calm and equals the poster.
5. `add_sfx_tool {"recipe": "ui_tap", "at_seconds": 5.4, "gain_db": -18}`, in time with the stinger's tail.

## Timing & taste rules

- cinetic's timing (60 fps): 1-2 ticks at least 30 f (0.50 s) apart. hitPulse attack 2 f (0.03 s), tau 6 f (0.10 s) (gone in ~38 f (0.63 s)). Amplitude 10-14% scale or 2-4 px. None in the final 30 f (0.50 s).
- 1-2 ticks, at least 30 f (0.5 s) apart, on downbeats in the first second of the hold.
- Pulse attack 2 f (0.03 s), decay about 6 f (0.1 s), gone in about 38 f; amplitude 10-14 % scale or 2-4 px.
- None in the final 30 f (0.5 s).
- The ticks sit inside the hold, never extending it.

## Sound for it

A quiet ui_tap at -18 dB on each tick, matching the stinger's tail.

## Common mistakes

- Marks without a separable piece.
- Very still closes, where any pulse breaks the calm.
- Loops that need the device to travel back to its frame-0 position.
- Avoid when: Marks without a separable piece. Very still closes, where any pulse breaks the calm. Loops that need the device to travel back to its frame-0 position instead.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-mark-ticks-in-lockup`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
