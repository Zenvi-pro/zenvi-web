---
id: cin-le-bookend-replay
kind: technique
summary: "When the film opened with a signature move: the ending runs the same stage and mechanic again, now carrying the brand."
categories: [cinetic-launch-film, cinetic-teaser, cinetic-feature-loop, cinetic-logo-sting, cinetic-ui-walkthrough]
tools: [get_timeline_state_tool, duplicate_clips_tool, copy_clip_keyframes_tool, edit_title_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [rhyming, satisfying]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [circular-problem-to-proof-bookend, cin-le-living-hold, cin-le-mark-slide-name-follow]
avoid_with: [cin-le-device-becomes-mark]
needs: []
drawn: cinetic
---

# End card replays the opening

cinetic `le-bookend-replay` · Logo and end card · workhorse · energy any · formats any. Drawn by the brief for the cinetic styles (never picked from a list by hand); build it in the film's own objects.

## What it is

The ending reuses the opening's stage and its mechanic, now carrying the brand, so the film closes on a rhyme the viewer has already learned.

Use when: Films with a distinctive opening mechanic or stage. The signature move's third use. Loops, where the end hands back to frame 0.

## Build it in Zenvi

1. Find the opening mechanic's clips and keyframes: `get_timeline_state_tool {"detail_level": "full"}`.
2. Copy them to the end at the same size, position and curves: `duplicate_clips_tool {"timeline_clip_ids": ["<open_a>", "<open_b>"], "position_seconds": 52.0, "to_track": "<same tracks>"}`; `copy_clip_keyframes_tool {"source_clip_id": "<open_a>", "timeline_clip_ids": ["<copy_a>"], "timing": "keep"}`.
3. Run it mirrored or with the brand as payload: time-reverse the entrance for exits (`set_keyframes_tool` with the mirrored points), roll the flanking words away and "made with" plus the name in; for a word-roll use the staggered word roll timing (28 f, 0.47 s, 5 f stagger): `edit_title_tool {"timeline_clip_id": "<copy_b>", "text": "Made with Zenvi"}`.
4. Bring the stage back only for brand beats: 25 f (0.42 s) rise from the bottom edge, `set_keyframes_tool` `location_y` 0.1 to 0 `ease_out_expo`.
5. The third use must add the name or the CTA; never replay frame for frame. Hold 96-120 f (1.6-2 s) under a push.

## Timing & taste rules

- cinetic's timing (60 fps): Word-roll: 28 f (0.47 s) with a 5 f (0.08 s) stagger. Mirrored exits keep the entrance's distance and duration. Stage rise: 25 f (0.42 s) on ease_out_expo. Final hold: 96-120 f (2.00 s) under the push.
- Word-roll 28 f (0.47 s) with a 5 f (0.08 s) stagger; mirrored exits keep the entrance's distance and duration.
- Stage rise 25 f (0.42 s) ease_out_expo; final hold 96-120 f (1.6-2 s) under the push.
- Use the same type size, position and curves as the opening so the rhyme is recognised.
- Films should run at least 10 s for the rhyme to land.

## Sound for it

Reuse the opening's sound recipe at the same relative frame, plus one hit on the name; do not add new sounds.

## Common mistakes

- A generic opening: replaying it just repeats a template.
- A frame-for-frame replay that adds nothing: the third use must add the name or CTA.
- Films under 10 s, where the rhyme has no time to land.
- Avoid when: The opening was generic (replaying it only repeats a template). The reprise would be a frame-for-frame replay that adds nothing. Films under 10 s, where the rhyme has no time to land.

## Verified

Not rendered yet.

Translated from cinetic's technique library (`le-bookend-replay`, MIT, (c) 2026 Leonxlnx; see NOTICE): the intent and the numbers, rebuilt with Zenvi tools; no cinetic code.
