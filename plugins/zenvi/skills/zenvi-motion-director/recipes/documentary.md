---
id: documentary
kind: style
summary: A voice-over essay or true story over B-roll - small captions, dark desaturated grade, quiet bed
categories: [documentary-true-story, video-essay-explainer, science-curiosity, news-short-vertical-explainer]
tools: [generate_tts_and_add_to_timeline_tool, kinetic_captions_tool, build_reel_tool, unify_grade_tool, auto_sound_design_tool]
pace: medium
mood: [serious, curious, moody]
aspect: ["16:9", "9:16"]
pairs_with: []
avoid_with: []
---
# Documentary / video essay

A voice tells a story over a B-roll montage: small centred one-word captions,
shots of 0.5-1.5 s, a dark slightly desaturated grade, a photo-collage split,
a small logo bug, low impacts on topic changes and a quiet music bed.

## Structure (24 s)

| t (s) | what |
| --- | --- |
| 0-0.5 | first word spoken on frame 1 over the strongest image |
| 0-24 | B-roll cut on the narration's phrases, 0.5-1.5 s per shot, faster on lists |
| on topic changes (2-3) | `flash_black` or a hard cut + `impact_thud` / `sub_drop` |
| once | a 3-image collage (`grid` `layout: "mosaic"` or `tiles: 3`) for 2 s |
| corner, whole piece | logo bug, 70 % opacity |

## Tools

1. Script → `generate_tts_and_add_to_timeline_tool` (`voice: "onyx"`,
   `speed: 1.05`, `position_seconds: 0`); 2.5 words per second of video.
2. B-roll: 8-12 clips over 6 searches, cut on phrase boundaries (word times
   from `get_transcript_tool` `includeWords: true`), noun → shot. Use
   `build_reel_tool` `style: "cinematic"` (`file_ids`, `music_file_id`,
   `duration_seconds`) for a quick first cut, then trim shots to the
   narration; or place each with `add_clip_to_timeline_tool` and
   `start_seconds`/`end_seconds`.
3. Collage: `add_motion_template_tool` `template: "grid"`, `layout:
   "mosaic"`, `tiles: 3`, `reveal: "slide"`, `file_ids` (3 stills), over the
   matching sentence.
4. Captions in each shot's negative space (DekLMhxqrFE: small words beside
   the subject, on the calm side): `kinetic_captions_tool` `style:
   "documentary"` (a phrase at a time) or `"split"` (two words either side
   of the subject), `animation: "rise"`, `cues` from the narration's word
   times (`get_transcript_tool` `includeWords: true`, plus the narration
   clip's position), `timeline_clip_ids`: the b-roll under them. The tool
   reads each shot and places the line where the picture is calm and dark.
   Chapter cards (2-4 words, at most three): `add_kinetic_title_tool`
   `{"text": "Part two: the money", "style": "editorial", "animation":
   "rise", "position_seconds": 12, "duration_seconds": 1.6}`, `"scramble"`
   on a number (`"491GB"`). Fallback (no drawings on this host):
   `add_captions_tool` `clipId` = narration, `maxWords: 1`, `style:
   "minimal"`, `text_size: 0.045`, `position: "center"`.
5. Logo bug: `add_title_tool` with a short mark (`text`, `font: "Space
   Mono"`, `font_scale: 0.5`) placed top right with `set_clip_property_tool`
   (`property: "location_x"` / `"location_y"`, then `property: "alpha"`,
   `value: 0.7`), for the full length.
6. Grade, on matched plates: `unify_grade_tool` `{"look":
   "elegant_dark_cinema", "look_intensity": 0.6}` (or `"cool_haze"`), then
   grain only: `apply_look_tool` `all_clips: true`, `look_id:
   "grain:16mm_classic"`. Transitions, on by default: `apply_motion_transitions_tool`
   `{"track": "1", "style": "cinematic", "direction": "left"}` on the b-roll
   track (slides and blur dissolves; hard cuts stay where the voice turns).
7. Sound: music bed + `duck_under_speech_tool` (`duck_db: -12`);
   `auto_sound_design_tool` `intensity: "subtle"`; `add_sfx_tool`
   `impact_thud` / `sub_drop` on each topic change, `riser_noise` into the
   last line, `reverse_swell` before a reveal.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 7 above (`intensity: "subtle"`, ducked under the voice).
2. `master_audio_tool` `{"preset": "social", "genre": "video_essay", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

Captions centred and readable on dark shots, never over a face; one frame per
topic change; the bug present on first and last frame; speech intelligible
over the bed (the bed's RMS 10-12 dB under the voice).

## Pitfalls

- Shots of 3-4 s under a 24 s VO: too slow for social; the reference averages
  under 1 s.
- Literal stock for every word: cut to the idea, not each noun.
- Captions in a subtitle box: tiny centred words, no box.
