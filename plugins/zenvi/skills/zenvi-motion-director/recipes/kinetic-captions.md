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
   same track at the noun times, 0.8-1.5 s each.
3. Rail captions (connectors): `add_captions_tool` `clipId` = the narration
   clip, `maxWords: 1`, `style: "minimal"`, `font: "Arial Black"`,
   `text_size: 0.05`, `position: "center"`. Remove the emphasis words from the
   rail (`edit_captions_tool`) so they only appear big.
4. Emphasis words: per word, `add_title_tool` `text: "IDEA"`, `font:
   "Anton"`, `text_color: "#E0201B"`, `font_scale: 2.5`, `position_seconds` =
   word start, `duration_seconds` 0.6-1; then `set_clip_property_tool`
   `rotation` -6…6 and `location_x` to sit beside the head; or, on the CLI,
   `text_behind_subject_tool` (`clip_id`, `text`, `color: "#e0201b"`,
   `font: "Anton"`, `y: 0.36`) for the one hero word. One embed per sentence
   at most.
5. Card: `add_motion_block_tool` `block: "glass_cards"`, `placement:
   "full_frame"` with the head as `background`, or `add_motion_template_tool`
   `template: "ui_cards"` with `labels`.
6. Transition: `apply_motion_transition_tool` `preset: "whip"`, `direction:
   "up"` on the one cut where the scene changes.
7. Grade `warm_pop` or `bold_red_cinema` at 0.5. Music: lofi bed under the
   voice, `duck_under_speech_tool` `duck_db: -10`.
8. Sound: `auto_sound_design_tool` `intensity: "normal"`, then `add_sfx_tool`
   `pop` on each emphasis word (`at_seconds` = word start, `seed` varied,
   `gain_db: -16`: it ducks under speech anyway) and `whip` on the pan.

## Checks

`preview_frame` on 4 emphasis words: word large, never over the mouth or
eyes, inside title-safe; on 2 connector words: readable, centred, not
colliding with the big word. Word timing: pick one emphasis word and check
the frame at its start shows it.

## Pitfalls

- A subtitle bar of 6 words: not this genre. One word at a time.
- All words big: emphasis must be scarce (3-6 in 20 s).
- Captions where the subject's face is: read face position off a
  `preview_frame grid: true` first.
- Music over the voice at full level: duck it.
