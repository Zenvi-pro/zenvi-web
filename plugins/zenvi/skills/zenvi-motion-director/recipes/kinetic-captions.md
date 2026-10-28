---
id: kinetic-captions
kind: style
summary: A person talking to camera where the captions are the show - word by word, emphasis words huge, behind the head
categories: [talking-head-captions, podcast-clip-vertical, ugc-ad-testimonial]
tools: [kinetic_captions_tool, generate_subject_matte_tool, text_behind_subject_tool, add_kinetic_title_tool]
pace: fast
mood: [direct, energetic]
aspect: ["9:16"]
pairs_with: []
avoid_with: []
---
# Kinetic-caption talking head

A person talks; the captions are the show: one word at a time in sync with
the voice, connector words small and white, emphasis words huge, condensed,
in the accent colour, placed around the subject (some behind the head), a few
insert shots and one pan transition. Reference feel: ~1 s shots, words every
0.25-0.4 s, a pop or whoosh on every caption change that matters.

## Structure (20 s)

| t (s) | what |
| --- | --- |
| 0-0.5 | the first word on screen at frame 0: no intro, no fade |
| 0-18 | talking head, cut every 1-3 s with inserts (desk, calendar, product) on the nouns |
| on each emphasis word | the word huge (40-60 % of frame height), red, beside or behind the head, held 0.6-1 s |
| one cut | a tilt-up or whip pan (`whip`, `direction: "up"`) |
| ~2/3 in | a floating comment/DM card (`glass_cards` or `ui_cards`) |
| last 2 s | the payoff line, then hard stop |

## Tools

1. Voice: `generate_tts_and_add_to_timeline_tool` `text` (write it to be
   said: short sentences, the emphasis words on stressed beats), `voice:
   "onyx"` or `"nova"`, `position_seconds: 0`. Then `transcribe_media_tool`
   (`file_id` of the narration) and `get_transcript_tool` with
   `includeWords: true` for word times.
2. Picture: talking-head clip on track 1 for the whole length; inserts on the
   same track at the noun times, 0.8-1.5 s each. Then the head's matte, once:
   `generate_subject_matte_tool` `{"clip_id": "<head clip>"}` (CLI; about 15
   frames a second). With it the captions find the head in every shot and
   put the emphasis words behind it; a refusal (no matting here) only costs
   that, the captions still work.
3. Captions, one call: `kinetic_captions_tool` `style: "creator"` (word by
   word, connectors white, the emphasis words huge red condensed capitals).
   `emphasis`: the 3-6 words that carry the line, each once. `animation:
   "tilt"` (Dc3mgNJO73W: words swing in, emphasis words stay turned 7°),
   `"pop"` for a calmer piece, `"slam"` for a harder one, `"scramble"` (tech,
   numbers: the emphasis word decodes from random letters), `"letters"`
   (brand, playful: its letters bounce in), `"slide_up"` with `style:
   "stack"`, `"typewriter"` for UI text. Placement is automatic: the tool
   looks at each shot, keeps off the head (the matte's) and takes the calm,
   dark side; with the matte, emphasis words go behind the head where there
   is headroom. Leave `behind_subject` out: its default `"auto"` does this
   only where the word stays readable, and `"none"` throws it away (the
   receipt says `behind_subject: "emphasis"` or `"none"`). `avoid` (the face box, from
   `preview_frame grid: true`) only without a matte; leave `y` out unless a
   frame check says otherwise. `text_size: 0.06` (connectors readable on a
   phone; emphasis keeps its ratio). The captions sit on their own tracks,
   so they stay on screen over the
   inserts. `timeline_clip_ids`: the talking-head clip (the captions belong
   to it). The words: `cues` in timeline seconds. With a TTS narration, the
   word times from step 1's `get_transcript_tool` (one cue per word, start
   + the narration clip's position); with no voice or a failed TTS, one cue
   per phrase of the script at about 2.5 words a second (the tool times each
   word inside its cue). Footage that speaks itself needs no cues: the tool
   transcribes the clip.

```json
generate_subject_matte_tool {"clip_id": "<head clip>"}
kinetic_captions_tool {"timeline_clip_ids": ["<head clip>"], "style": "creator", "animation": "tilt",
  "text_size": 0.06, "emphasis": ["deadline", "idea", "today"],
  "cues": [{"text": "Stop chasing the", "start": 0, "end": 1.1}, {"text": "deadline", "start": 1.1, "end": 1.8}]}
```

   Check 2 frames: the emphasis word whole and off the mouth (behind the
   head it shows above it, the head over its lower third), the connector
   line readable. Too small or misplaced: run it again with other
   `text_size`, `y` or `animation` (it replaces its own captions, one undo
   step).
4. Optional, the one word the piece is about as a full-width line behind
   the head: `text_behind_subject_tool` `{"clip_id": "<head clip>", "text":
   "IDEA", "color": "#e0201b", "font": "Anton", "y": 0.36}` (leave it out of
   `emphasis`). The opening or closing title card:
   `add_kinetic_title_tool` `{"text": "STOP SCROLLING", "style": "stack",
   "animation": "slam", "position_seconds": 0, "duration_seconds": 1.2}`.
   Without `kinetic_captions_tool` (it refuses
   when the host cannot store drawings): `add_captions_tool` (`cues`,
   `maxWords: 1`, `text_size: 0.065`: above TASTE's 0.045-0.055 rail size on purpose, at 0.05
   the bench frames read too small in Arial Black on 9:16) for the connectors and `add_title_tool`
   (`font: "Anton"`, red, `font_scale` 3-4) per emphasis word.
5. Card: real words, never grey placeholder lines: `add_motion_block_tool`
   `block: "glass_cards"`, `placement: "full_frame"`, the talking head as
   `background`, `headline: ""` (else the block's sample headline shows),
   `cards: ["@maya_edits"]`, `details: ["this changed how I work"]`,
   `click: -1`; or `add_motion_template_tool` `template:
   "ui_cards"` with `labels` and `subtitle`. 1.5-2 s.
6. Transition: `apply_motion_transition_tool` `preset: "whip"`, `direction:
   "up"` on the one cut where the scene changes.
7. Grade the head and the inserts into one world: `unify_grade_tool`
   `{"reference_clip_id": "<head clip>", "look": "bold_red_cinema",
   "look_intensity": 0.5}` (or `"warm_pop"`). Music: lofi bed under the
   voice, `duck_under_speech_tool` `duck_db: -10`.
8. Sound: `auto_sound_design_tool` `intensity: "normal"`, then `add_sfx_tool`
   `pop` on each emphasis word (`at_seconds` = word start, `seed` varied,
   `gain_db: -16`: it ducks under speech anyway) and `whip` on the pan.

## Finish (every run, in this order; never skip it)

1. Sound on every cut: step 8 above (`intensity: "normal"`, a pop on each
   emphasis word), the music ducked under the voice.
2. `master_audio_tool` `{"preset": "social", "genre": "talking_head", "iterate": true}` (fixes what analyze_mix_tool finds, then masters), after the last audio change (any later
   audio edit means mastering again).
3. `render_video`, then `review_render_tool` `{"path": "<the file render_video wrote>"}`.
4. One fix pass: every `PROBLEM` line with the tool it names (a repeated
   shot: the `swap_shot_tool` calls the review lists; ends on black: trim
   what runs past the last picture; true peak or loudness: master again),
   then render and review once more and report that review's numbers.

## Checks

`preview_frame` on 4 emphasis words: word large, never over the mouth or
eyes, inside title-safe; on 2 connector words: readable, centred, not
colliding with the big word. Word timing: pick one emphasis word and check
the frame at its start shows it.

## Pitfalls

- A subtitle bar of 6 words: not this genre. One word at a time.
- All words big, or the same big word twice: emphasis is scarce (3-6 in
  20 s) and each appears once.
- Rail words tiny at the bottom edge: `text_size` 0.055-0.07 and `y` near
  the subject, centred, big enough to read on a phone.
- Captions where the subject's face is: make the matte first (step 2), or
  give `avoid` from a `preview_frame grid: true`.
- Every caption fading in place: that is subtitles. Pick an animation.
- Music over the voice at full level: duck it.
