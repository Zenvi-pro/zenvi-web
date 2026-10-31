---
id: cin-lc-vertical-band-stack
kind: technique
summary: "When a 9:16 cut must survive the feed: caption over subject, stacked inside the clear band, moves running upward."
categories: [cinetic-launch-film, cinetic-teaser]
tools: [set_project_profile_tool, add_clip_to_timeline_tool, set_keyframes_tool, add_kinetic_title_tool]
pace: medium
mood: [mobile, tidy, vertical]
aspect: ["9:16", "4:5"]
pairs_with: [cin-lc-one-centred-subject, t060, kinetic-vo-captions]
avoid_with: [cin-lc-symmetric-flank, cin-lc-live-split-view]
needs: []
drawn: cinetic
---

# Vertical clear-band stack

cinetic `lc-vertical-band-stack` · Layout and composition · workhorse · energy any · formats vertical. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

In a 9:16 frame, the caption and the subject stack vertically inside the band the feed leaves clear, with their combined mass centred on that band rather than on the frame, and nothing important under the bottom caption zone or the right action rail.

Use when: Any vertical cut-down or vertical-first film for feeds.

## Build it in Zenvi

1. Vertical project: `set_project_profile_tool {"orientation": "portrait", "width": 1080, "height": 1920}`.
2. The clear band is about 896 x 1230 px (0.83 of the width, 0.64 of the height) centred near y = 885 (0.46 of the height); keep everything inside it, clear of the bottom caption zone and the right action rail.
3. Subject on the lower part of the stack: `add_clip_to_timeline_tool {"file_id": "<ui>", "position_seconds": 0, "duration_seconds": 3.5, "track": 2}`, sized to 0.86 of the band width, then `set_keyframes_tool {"timeline_clip_id": "<ui>", "property": "location_y", "mode": "replace", "points": [{"seconds": 0, "value": 0.19}, {"seconds": 0.67, "value": 0.07, "ease": "ease_out_expo"}]}` (rises 120 px, 0.0625, over 40 f).
4. Caption on top, at most two lines, fitted to the band width, a 48 px gap (0.025) above the subject: `add_kinetic_title_tool {"text": "<caption>", "style": "editorial", "animation": "rise", "position_seconds": 0.8, "duration_seconds": 2.7, "stagger_seconds": 0.133, "y": 0.3}`. It starts 8 f (0.13 s) after the subject.
5. Scene changes flow upward: the old stack's `location_y` to -0.12 with `alpha` to 0 over 16 f (0.27 s), `ease_in_cubic`, while the new one rises from below.

## Timing & taste rules

- cinetic's timing (60 fps): Subject rises 120 px over 40 f (0.67 s) on ease_out_cubic; caption Words (stagger 8 f (0.13 s), dur 26 f (0.43 s)) start 8 f (0.13 s) after the subject; exits 16 f (0.27 s) on ease_in_cubic; hold 60-90 f (1.50 s) per stack.
- Subject rises 120 px (0.0625 of the height) over 40 f (0.67 s) on ease_in_out_sine; caption words stagger 8 f (0.13 s), each 26 f (0.43 s), starting 8 f after the subject.
- Exits 16 f (0.27 s) on ease_in_cubic; hold 60-90 f (1.0-1.5 s) per stack.
- Stack's combined height is centred on the band, not on the frame; 48 px gap between caption and subject.
- UI cards 0.86 of the band width; never side by side.

## Sound for it

Per scene change one whoosh_short at -16 dB if the stack leaves with a push; otherwise none.

## Common mistakes

- Using it for a 16:9 master: use a side-by-side composition there.
- Full-bleed moments where one giant word fills the screen anyway.
- Letting any element cross the feed's bottom caption zone or the right rail.
- Avoid when: 16:9 masters (use a side-by-side composition there), or full-bleed moments where one giant word fills the screen anyway.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`lc-vertical-band-stack`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
