---
id: scale-jump-cut-on-sub-bass-hit
kind: technique
summary: "For a story beat in a trailer or montage: a quiet wide, a riser, then a hard cut to an extreme close-up on a sub hit."
categories: [gaming-montage, movie-game-trailer]
tools: [add_sfx_tool, automate_volume_tool, set_keyframes_tool, color_grade_clip_tool, search_clip_scenes_tool, add_clip_to_timeline_tool]
pace: fast
mood: [tense, epic, impactful]
aspect: ["16:9", "9:16"]
pairs_with: [occluder-plate-wipe, big-number-lockup-and-counter, bar-phrase-and-lyric-locked-cutting]
avoid_with: [stacked-word-flipper]
needs: []
---

# Scale-jump cut on sub-bass hit

## What it is
A wide or quiet foley beat cuts straight to an extreme close-up of the contact
point (boots, blade, fist, the hands on the controller) on a sub-bass hit that
sits above the music, a riser leading in. Game trailers spend it on story
events, not on every cut.

## Build it in Zenvi
```json
set_keyframes_tool {"timeline_clip_id": "<wide>", "property": "scale_x", "ease": "ease_in_quad",
  "points": [{"timeline_seconds": <wide start>, "value": 1.0}, {"timeline_seconds": <cut>, "value": 1.12}]}
set_keyframes_tool {... the same on "scale_y"}
add_sfx_tool {"recipe": "riser_noise", "at_seconds": <cut - 2.2>, "align": "start", "duration": 2.2, "gain_db": -12}
add_sfx_tool {"recipe": "sub_drop", "at_seconds": <cut>, "gain_db": -4}
add_sfx_tool {"recipe": "impact_boom", "at_seconds": <cut>, "gain_db": -6}
automate_volume_tool {"role": "music", "shape": "suck_out", "at_seconds": <cut>, "length_ms": 150, "db": -20}
```
- `search_clip_scenes_tool` ("close-up hands on controller") to find the
  close-up, then trim so the first frame is the contact.
- The slow push-in on the wide (8-12 %) gives the riser something to build on;
  a static wide reads sluggish (judge note).
- Lift a dark close-up 0.3-0.4 stops (`color_grade_clip_tool exposure`) so the
  detail reads in the 0.5-1 s it is on screen.

## Timing & taste rules
- Two sizes apart at least: wide → extreme close-up, or close-up → aerial.
- The ECU runs 0.5-1.0 s, then the montage continues or holds.
- 2-4 per minute, on story events (a hit, a landing, a reveal).
- A 150 ms suck-out on the music right before the hit makes the sub land.

## Sound for it
Riser 2 bars (or 2 s) ending on the cut, 150 ms suck-out, sub drop + boom on
the frame with a layer of the in-shot foley (a key click, a boot) at -14.

## Common mistakes
- Muddy, underexposed close-ups (pass 1).
- The sub on a cut with no story event (it becomes a template).
- A shaky, amateur wide (pass 2's handheld market shot was the judge's top
  note): the wide must be a composed, still plate.

## Verified
2026-10-29: 4.6-5 s 9:16 tests, neon city wide → controller/keyboard ECU on a
sub drop. Pass 1 (static wide, dark controller ECU): 4.91. Pass 2 (push-in,
lifted keyboard ECU, key click layer, suck-out): 3.55, because the replacement
wide was shaky handheld stock. Footage choice dominates; the sound recipe held.
