---
id: cinematic-j-l-cut
kind: technique
summary: When scenes should flow like film, not slides - the next shot's sound starts early (J) or this shot's sound runs on (L).
categories: [documentary-true-story, brand-story-corporate, wedding-event-film, travel-cinematic-montage, video-essay-explainer, movie-game-trailer]
tools: [separate_clip_audio_tool, trim_clip_tool, fade_clip_tool, set_clip_property_tool]
pace: calm
mood: [immersive, natural, storytelling]
aspect: ["16:9", "9:16", "2.39:1", "1:1"]
pairs_with: [cinematic-shot-scale-grammar, cinematic-warm-nostalgia, cinematic-title-sequence, cinematic-push-in]
avoid_with: [cinematic-montage-rhythm, cinematic-whip-cut]
needs: []
---

# J-cut and L-cut

## What it is

Picture and sound cut at different moments. J-cut: the sound of the next shot arrives before
its picture (the ear leads the eye into the scene). L-cut: the sound of a shot carries on under
the next picture (a line, a clock, waves continue). It is how story films hide their cuts.
Shines in documentaries, interviews, brand stories, weddings (vows over the reception).

## Build it in Zenvi

J-cut, the incoming clip's sound 0.5-1.5 s early:
1. `separate_clip_audio_tool` `{"timeline_clip_ids": ["<incoming>"], "to_track": "3"}` (its sound
   becomes its own audio-only clip; the original is muted).
2. Find the new audio clip (receipt or `list_clips_tool` on that track), then
   `trim_clip_tool` `{"clip_id": "<audio>", "edge": "left", "at_seconds": <cut - 1.0>}` (drags the
   start earlier; the source needs that much head).
3. `fade_clip_tool` `{"clip_id": "<audio>", "fade_in_seconds": 0.6, "video": false, "audio": true}`.
L-cut: the same on the outgoing clip with `"edge": "right"` past the cut, and a fade-out.
Music beds count too: start the bed 0.5 s before the picture change it belongs to.

## Timing & taste rules

- Lead or lag 0.5-1.5 s; under 0.3 s it sounds like a sync error.
- Fade the early/late part (0.4-0.8 s); a hard start under the old picture is jarring.
- The overlapping sound sits 3-6 dB under the current shot's sound, then takes over at the cut.
- Use it at scene changes and on dialogue; not on beat-cut montages (the beat is the sound).

## Sound for it

It is sound. Diegetic sources work best: room tone, ticks, needles, waves, voices.

## Common mistakes

- Trimming the video edge instead of the separated audio (moves the picture cut).
- No source handle: the clip's sound starts at its first frame, so a J-cut needs `start_seconds`
  later than 0 for the head to exist.

## Verified

2026-10-28, `tech/j-l-cut` (a fern, then a turntable whose own sound starts 1 s before its picture,
6 s 720p24). First attempt trimmed the wrong clip (the receipt does not list the new audio clip;
find it on its track). Watch judge (abs): transitions 7/10, sound 6, overall 5.0, "the classic
J-cut audio pre-lap functions as intended, pulling the viewer into the next scene". In the documentary
showcase an L-cut (the clock ticks on under two more shots): "the diegetic L-cut of the ticking clock
establishes an immediate, claustrophobic sense of routine" (overall 7.7); in the brand film a J-cut of
the turntable plus every clip's own sound: sound design 9/10.
