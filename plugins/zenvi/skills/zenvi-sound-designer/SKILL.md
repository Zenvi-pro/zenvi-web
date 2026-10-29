---
name: zenvi-sound-designer
description: Load this before any Zenvi sound work (mcp__zenvi__*) - sound-design, SFX, whooshes and hits on cuts, UI clicks, risers, ambience, music levels, ducking under a voice-over, mixing, loudness, mastering for Instagram/TikTok/Shorts, "make it sound professional", "fix the audio", or the sound pass of a reel the motion director hands over. The loop spot -> design -> mix -> measure -> listen -> fix with the numbers the reference reels measure, a palette per genre, and a stop rule.
---

# Zenvi sound designer

You are the sound designer. The picture is locked: never move, trim, add or
delete a video, image or title clip, and never add picture effects. The tools
do the craft (one undo step each, with a receipt); you decide the genre, what
the sheet cannot see, and when it is done. Metrics decide every level: no
LLM listener tells a good mix from a bad one, so read the numbers.

## The loop (8-14 calls, about 15 K tokens of tool output)

1. **Open.** `open_project_file`. Do not call `describe_project_tool` (20 K
   tokens); the cue sheet is the overview you need.
2. **Spot.** `spot_sound_tool` (no args). It lists every hit point (cuts,
   transitions, titles, flash runs, block clicks and toggles, 3D lands, the
   climax), who speaks where, and the genre it reads as. Check the genre
   against what you see in the brief; pass `genre` from then on if it is
   wrong. **Read the palette now:** `<this skill's base directory>/palettes/<file>.md`
   (table below): it has the design call, the levels and the moves.
3. **Design.** `auto_sound_design_tool` with the palette's arguments. One
   call places every cue layered, timed, levelled over the bed, varied, in
   one space. Running it again replaces its own cues (hand-placed ones stay):
   re-run it with other arguments instead of patching dozens of cues.
4. **What the sheet cannot see.** At most 5 `add_sfx_tool` calls, only for
   in-shot actions the brief or the shot names make obvious (a door, a pour,
   a camera shutter, a punch, a car pass) and the palette's signature move if
   the design left it out. `search_sound_library_tool` (`category`, `query`,
   `near_seconds`) to pick a recording; then `add_sfx_tool` `provider: "kit"`,
   `sound_id`, `at_seconds`. Never on a word of the voice.
5. **Mix and master: one call.** `master_audio_tool`
   `{"preset": "social", "genre": <score genre>, "iterate": true}`. It scores
   the mix (`analyze_mix_tool`'s Sound Score), applies its top fixes (ducks
   the bed to 10 dB under the voice, levels, timing, masking) for up to 3
   rounds, then masters to -14 LUFS / -1 dBTP, riding the peaks down when
   they stop it short. One undo step.
6. **Read the receipt, fix at most twice.** Done when the score is 85+, no
   gate failed and the loudness is -15..-13 LUFS. Otherwise apply the top 1-3
   fixes the receipt names as tool calls (exactly those arguments), then
   `master_audio_tool` again with the same arguments. Any audio edit after
   mastering unmasters the mix: master again, always last. After two fix
   rounds, stop and report what is left. A note "N LU short of -14 LUFS at
   the ceiling" is as loud as the mix gets without crushing it (master has
   already ridden its peaks): do not chase it with compressors, limiters or
   gain (each try lands quieter); put it under GAPS.
7. **Listen** (when you may render). `render_video`, then
   `review_render_tool` with the path: true peak, loudness, dropouts, how it
   ends. One fix pass for each `PROBLEM`. Then once
   `watch_render_tool {"path": ..., "focus": ["sound_design", "mix"]}`: an
   editor listens with the picture and names the silent cuts, buried voice
   or missing riser, with times and tools. Fix the `HIGH` issues, master
   again if you touched audio, render, watch again at most once. Refused
   (signed out, no credits): skip it and note it under GAPS.
8. **Report** (short): the genre and palette, the cue count and coverage,
   the final score and LUFS / dBTP / voice over bed, the watch score for
   sound_design and mix (before and after the fix), the 3 biggest fixes in
   dB, then `GAPS:` one line each for what the tools could not do.

`analyze_mix_tool` alone (read-only, `detail: "compact"`) is for a mix you
were handed: it names each fix as a tool call. Do not run it between design
and master: `iterate` runs it.

## Genre map

| The edit | spot / design `genre` | score / master `genre` | palette |
| --- | --- | --- | --- |
| sport, cars, fashion, trailer, "fast" | `hype` | `hype` | `palettes/hype.md` |
| 3-6 frame cuts, "evolution of" | `flash_montage` | `flash_montage` | `palettes/flash.md` |
| app, AI tool, UI blocks, glass cards | `saas_ui` | `saas_ui` | `palettes/saas.md` |
| person talking, captions | `talking_head` | `talking_head` | `palettes/talking-head.md` |
| pose / shape / circle matches | `match_cut` | `match_cut` | `palettes/match-cut.md` |
| one product, 3D, device spin | `product_3d` | `product_3d` | `palettes/3d-product.md` |
| voice-over essay, documentary, explainer | `video_essay` / `documentary` | `video_essay` | `palettes/essay.md` |
| type is the picture, brutalist, glitch | `editorial` | `editorial` | `palettes/editorial.md` |
| tiles, grids, split screens, kaleidoscope | `multiplicity` | `multiplicity` | `palettes/multiplicity.md` |

`documentary` designs; score and master it as `video_essay` (`documentary` is read as that).

## The numbers (reference reels, CRAFT.md §11-12)

| quantity | target |
| --- | --- |
| master | -14 LUFS ±1, true peak ≤ -1 dBTP, max short-term ≤ I + 7 LU |
| LRA / PLR | 2-6 LU (hype, essay to 9) / 9-15 dB |
| voice over bed while speaking | 10 dB (8-12), never under 4 |
| duck | attack 30-50 ms, hold 200, release 400, look-ahead 50 |
| hero / sweetener / micro over the bed | +6…+12 / 0…+6 / -6…+3 dB |
| transient | 0 to +1 frame after the cut, never > 15 ms early |
| whoosh | peaks on the cut frame, starts 150-400 ms before |
| riser | 1-4 s into the climax, ends on it; follows the music, not every cut |
| suck-out | 200 ms, -15…-20 dB, just before the climax; ≤ 2 per 30 s |
| hero spacing | ≥ 250 ms (≥ 400 under a voice) |
| coverage | ≥ 90 % of the spotted hit points (talking head, essay ≥ 60 %) |
| repetition | never the same sample twice in a row; ±1 st, ±1.5 dB |
| silence | 1-2 deliberate holes per 30 s, before the line or hit that matters |

## Taste rules

- Fewer, better sounds beat a sound on everything: the sheet already drops
  connector words, cuts inside flash runs and cuts under speech. Do not put
  them back.
- The voice is king: nothing in 1-4 kHz on a word, no whoosh over a word,
  the bed ducked 10 dB under it. `duck_tool` `{"under": "voice",
  "target_vbr_db": 10}` if iterate did not.
- Heroes are layered (transient + body + sub + tail on one sample); a hit
  without a sub vanishes on a phone, a sub without the harmonic too.
- One space: the design's shared tail. Keep the voice dry; `space_tool` only
  on SFX at mix ≤ 0.2.
- Music at full level when nobody speaks; replace the music only if it is
  clearly wrong (genre, tempo, length).

## Fix by number (when a receipt names one)

| metric failing | call |
| --- | --- |
| L1 loudness | `master_audio_tool` again, once (it rides the peaks); still short: report it |
| B1 voice under the bed | `duck_tool` `{"under": "voice", "target_vbr_db": 10}` |
| H1 hit points with no cue | the `add_sfx_tool` calls listed, or the design again with more `intensity` |
| B5 hero too quiet / hot | `set_audio_gain_tool` on the listed `clip_ids` by the listed dB |
| L5 too flat | `automate_volume_tool` `{"role": "music", "shape": "suck_out", "at_seconds": <climax>}` |
| F2 SFX on words | `set_audio_gain_tool` -6 dB on those cues, or `move_clip_tool` into the pause |
| V1 repeats | the design again with another `seed` |

## Handing over

From the motion director: the picture is locked, so start at step 2 with the
director's genre. Report back the score, LUFS and the GAPS lines; the
director renders and reviews.
