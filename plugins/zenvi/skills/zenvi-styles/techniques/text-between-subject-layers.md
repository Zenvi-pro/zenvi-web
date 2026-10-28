---
id: text-between-subject-layers
kind: technique
summary: "When one word is the emotional peak: a 30-35% height word behind the speaker, in front of the background, once."
categories: [ugc-ad-testimonial]
tools: [generate_subject_matte_tool, text_behind_subject_tool, set_keyframes_tool, add_sfx_tool]
pace: medium
mood: [bold, premium, dramatic]
aspect: ["9:16", "4:5", "1:1"]
pairs_with: [vo-keyed-emphasis-stack, karaoke-word-highlight-captions, blackout-and-dead-silence-pause]
avoid_with: [ui-card-over-the-speaker, split-screen-compare-layout]
needs: [planar-surface-track-overlay]
---

# Text between subject layers

## What it is
One huge word (TIME, FREE, NOW) sits behind the person and in front of the
wall: the head occludes part of it, which makes it read as designed, not
pasted. Used once, at the line it names.

## Build it in Zenvi
1. `generate_subject_matte_tool {"clip_id": "<head clip>"}` (CLI or cloud:
   about a minute per 10 s; the editor alone cannot matte).
2. ```json
   text_behind_subject_tool {"clip_id": "<head clip>", "text": "TIME",
     "color": "#e0201b", "font": "Anton", "y": 0.3}
   ```
   `y` 0.22-0.36 puts the word behind the head and shoulders; use a word with
   3-5 letters so enough stays readable around the head.
3. Make it move: the title clip id is in the receipt; `set_keyframes_tool`
   `scale_x`/`scale_y` 0.92 to 1.0 over 8 frames (`ease_out_back`), or alpha
   0 to 1 over 4 frames, starting on the word.
4. `add_sfx_tool {"recipe": "impact_thud", "at_seconds": <word start>, "gain_db": -12}`.
5. Keep it out of the caption `emphasis` list (it would show twice).

## Timing & taste rules
- 1.2-2.5 s on screen, starting on the spoken word; once per piece.
- 30-35 % frame height; condensed caps (Anton, Bebas Neue); one accent colour.
- Pick shots with head-room and a plain background; busy walls kill it.
- The ground-plane 3D version (word lying on the floor, camera move) needs
  `planar-surface-track-overlay`; fallback `add_3d_scene_tool` title_3d.

## Sound for it
A low thud or sub hit at -12 dB under the word, nothing else in that 0.3 s.

## Common mistakes
- Static word for 4 s (the test's first version): animate the entrance.
- Long words where the head hides the middle letters (T I _ E read as
  "TIE" in the test); choose the word for the head position.
- Using it on every emphasis word.

## Verified
2026-10-28: 4 s ring-light head (stock), matte generated in the CLI,
`text_behind_subject_tool` TIME red Anton y 0.3, a thud. Contact sheet: the
word sits behind the head, head occludes the M. Watch judge typography 4,
overall 2.55: static from frame one and no sound under it; hence steps 3-4.
