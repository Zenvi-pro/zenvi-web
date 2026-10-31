---
id: cin-ps-silent-sign-off
kind: technique
summary: "When a fast launch ends: a riser, the music stops dead on the last line, a near-still frame, then a hit on the logo."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [detect_music_structure_tool, add_sfx_tool, automate_volume_tool, set_keyframes_tool, add_motion_block_tool]
pace: fast
mood: [confident, decisive, punchy]
aspect: ["16:9", "9:16", "1:1", "4:5"]
pairs_with: [cinematic-silence-before-hit, t061, t084]
avoid_with: [cinematic-trailer-sound, cin-ps-silence-first-sound]
needs: []
drawn: cinetic
---

# Hard stop into a silent sign-off

cinetic `ps-silent-sign-off` · Pacing and structure · workhorse · energy high · formats launch, feature, sting. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

Tension rises under the back half, the music stops dead on the cut to the last line or URL, the picture all but freezes, and the lockup arrives at full speed under a single low stinger.

Use when: The last 4-6 s of launch films and feature reels for fast, confident brands.

## Build it in Zenvi

1. Find the bar the last line starts on: `detect_music_structure_tool {"clip_id": "<music>", "add_markers": true}`. Call that time S (the first frame of the silence); here S = 26.0 s.
2. Riser that ends exactly at S, 180-300 f (3-5 s) long: `add_sfx_tool {"recipe": "riser_noise", "at_seconds": 22.0, "duration": 4.0, "gain_db": -12}`. Skip it if a whoosh already leads into the same downbeat.
3. Music stops within 2 f (0.03 s) of S: `automate_volume_tool {"role": "music", "shape": "points", "points": [{"t": 25.97, "db": 0}, {"t": 26.0, "db": -60}], "curve": "linear"}`; thin the score before that (drums and arp out) with `automate_volume_tool {"role": "music", "shape": "dip", "start_seconds": 22.0, "end_seconds": 26.0, "db": -6}`.
4. URL or last line near-still for at least 102 f (1.7 s), drift at most 0.03 %/f: `set_keyframes_tool {"timeline_clip_id": "<last_line>", "property": "scale_x", "mode": "replace", "points": [{"seconds": 26.0, "value": 1.0}, {"seconds": 27.7, "value": 1.018, "ease": "ease_in_out_sine"}]}` (and `scale_y`). The final 12-15 f (0.2-0.25 s) before the logo hold dead still with true silence.
5. Logo move starts at full speed: `add_motion_block_tool {"block": "logo_reveal_end", "position_seconds": 27.9, "duration_seconds": 4.0, "params": {"brand": "<name>", "url": "<url>"}}`; the move runs 30-68 f (0.5-1.13 s) on an ease_out_expo curve that begins at speed. Then `add_sfx_tool {"recipe": "sub_drop", "at_seconds": 28.4, "gain_db": -6}` with `impact_boom` on the frame the wordmark resolves; its 1.2-1.5 s tail covers the 90-120 f (1.5-2 s) lockup hold with a push of at least 10 % (`scale_x/y` 1.0 to 1.1, linear).

## Timing & taste rules

- cinetic's timing (60 fps): Riser 180-300 f (5.00 s) ending where the silence begins; music falls to silence within 2 f (0.03 s); URL readable for at least 102 f (1.70 s) with drift of at most 0.03%/f; designed freeze 12-15 f (0.25 s) on true silence; logo move 30-68 f (1.13 s) ease_out_expo from full speed; stinger on the wordmark's resolve frame; lockup hold 90-120 f (2.00 s); tail of at least 60 f (1.00 s).
- Riser 180-300 f (3-5 s) ending where the silence begins; music falls to silence within 2 f (0.03 s).
- URL readable at least 102 f (1.7 s) with drift of at most 0.03 %/f; designed freeze 12-15 f (0.2-0.25 s) on true silence.
- Logo move 30-68 f (0.5-1.13 s) from full speed; stinger on the wordmark's resolve frame; lockup hold 90-120 f (1.5-2 s); tail at least 60 f (1 s).
- Fast, confident brands only.

## Sound for it

Riser into the silence, music cut in 2 f, then a single sub_drop plus impact on the frame the wordmark resolves; nothing in between.

## Common mistakes

- Calm brands, where a sub stinger reads as trailer noise: end on one soft chord instead.
- A loop with no ending.
- Easing the logo in from rest: it must start at full speed.
- Avoid when: Calm brands, where a sub stinger reads as trailer noise (end on one soft chord instead), and loops with no ending.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`ps-silent-sign-off`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
