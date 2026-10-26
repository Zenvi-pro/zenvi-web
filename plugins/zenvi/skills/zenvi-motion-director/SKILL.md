---
name: zenvi-motion-director
description: Direct a short video with a professional editor's taste using the Zenvi MCP tools - plan the edit with timings, pick the genre's recipe (match-cut montage, flash montage, kinetic-caption talking head, SaaS/UI promo, 3D product ad, editorial/brand type, grid montage, documentary/video essay, hype/sport reel, tutorial/breakdown, showreel/intro), then cut, add motion transitions, motion blocks, 3D, captions, colour and sound design on every cut, and check contact frames before rendering. Use it whenever an edit must not look like a slideshow - a reel, ad, promo, montage, recreation of a reference, or any ask that names a style, a technique (match cut, whip pan, flash cut, speed ramp, text behind subject, glass UI, 3D title) or a reference video.
---

# Zenvi motion director

You are the director. The tools do the craft (one undo step each, with a
receipt); your job is the decisions a senior editor makes before touching the
timeline and the frames you check after. `zenvi-reels` is the one-call reel;
this skill is for edits that must hold up next to a professional one.

## The director loop

1. **Brief.** One line each: format (size, fps, seconds), story in shot order,
   pace, look, type, sound, the *one bold moment*. Pick a genre from the router
   below and read its recipe (`recipes/<genre>.md`, next to this file) before
   planning. Use the brief's own words, colours and names exactly.
2. **Plan with timings.** Write the edit as a table before any tool call:
   `t (s) | shot / element | length (frames) | entrance / transition | sound`.
   Every row has a sound. Times snap to frames; music edits snap to beats.
3. **Project.** `open_project_file`, then `set_project_setting_tool`
   (`width`, `height`, `fps`) before importing anything.
4. **Assets.** Search once per story beat (`search_pexels_videos_tool` with
   `orientation`, `import_stock_media_tool`), one music track
   (`search_freesound_music_tool` with `min_seconds` above the length), AI
   stills only for what stock cannot show. Too few assets is the commonest
   cause of a slideshow: get 1.5x the shots the plan needs.
5. **Cut.** The genre tool first (`match_cut_montage_tool`, `build_reel_tool`,
   `add_motion_template_tool template=grid`), otherwise
   `add_clip_to_timeline_tool` per row. Get `beats` from the receipt
   (`data.beats`) or `detect_beats_tool` and reuse them everywhere below.
6. **Transitions.** On the final cut only (they are keyframes on the clips):
   `apply_motion_transitions_tool` for a track, `apply_motion_transition_tool`
   for one cut. Two or three presets per piece, repeated; one direction.
7. **Motion and 3D.** `add_motion_block_tool` (headlines, prompt bars, glass
   cards, counters, rotators, HUD, bursts), `add_3d_scene_tool` (draft first),
   matte composites (`text_behind_subject_tool`, `replace_background_tool`,
   `subject_glow_tool`, `pop_out_tool`), `speed_ramp_tool` on hero shots.
8. **Captions and type.** `add_captions_tool` (word-by-word: `maxWords: 1`)
   for speech; `add_title_tool` with a bundled family (`font: "Anton"`,
   `"Instrument Serif"`, `"Space Mono"`...) for emphasis words and labels.
9. **Colour.** One look for the whole piece: `apply_look_tool`
   (`look_id`, `all_clips: true`, `lut_intensity` 0.5-0.7; ids from
   `list_looks_tool`), grain only on cinematic pieces.
10. **Sound, last.** When the picture is locked: `auto_sound_design_tool`
    (`intensity`, `beats`, `climax_seconds`), then `add_sfx_tool` for what it
    cannot know (typing, a click, the landing). Music at full level unless
    there is speech (`duck_under_speech_tool`).
11. **Verify** (below), fix, verify again. Then `render_video`.

Order matters: speed ramps change clip lengths (`ripple: true`), transitions
read the cuts, sound design reads cuts, transitions and titles. Anything that
moves a cut after step 6 means removing and re-applying the transitions on
that track (`remove_motion_transition_tool track=...`) and re-running sound.

## Genre router

| Ask sounds like | Recipe | Core tools |
| --- | --- | --- |
| shapes or poses that line up across cuts | `recipes/match-cut-montage.md` | match_cut_montage_tool, detect_subject_tool |
| a new image every few frames, "evolution of" | `recipes/flash-montage.md` | match_cut_montage_tool / add_clip_to_timeline_tool, flash presets |
| person talking, captions are the show | `recipes/kinetic-captions.md` | generate_tts…, add_captions_tool, add_title_tool, text_behind_subject_tool |
| app, AI tool, SaaS launch | `recipes/saas-ui-promo.md` | add_motion_block_tool (glass_cards, prompt_bar, kinetic_headline, counter, word_rotator) |
| one product, 3D, "spins in" | `recipes/3d-product-ad.md` | add_3d_scene_tool (device_mockup, glass_hero, title_3d), prompt_bar, particle_burst |
| type is the picture, design study, brand | `recipes/editorial-type.md` | kinetic_headline, text_scramble, hud_callouts, crop_labels, flash_white |
| tiles filling on the beat, split screen | `recipes/grid-montage.md` | add_motion_template_tool template=grid |
| voice-over essay, story, explainer | `recipes/documentary.md` | TTS, add_captions_tool, build_reel_tool cinematic, grid collage |
| sport, cars, launch hype, "fast" | `recipes/hype-reel.md` | build_reel_tool hype, apply_motion_transitions_tool style=hype, speed_ramp_tool |
| how-to, effect breakdown, tips | `recipes/tutorial.md` | build_reel_tool tutorial, step_card, end_card save |
| intro, showreel, "about me" | `recipes/showreel-intro.md` | title_3d, word_rotator, grid zoom_into, particle_burst |

Mixed asks: take the structure from the genre of the *first five seconds*
and borrow single techniques from the others.

## Non-negotiables

- **Sound on every cut.** In the references a cut lands on an audio
  transient 50-100 % of the time and on the beat only 20-40 %: the whoosh or
  hit makes the cut. Risers end on the drop, an impact lands on it.
- **Loud enough.** References sit at about −13…−16 dB RMS. Never turn music
  down without speech over it; never leave a stretch silent unless the
  silence is the moment.
- **Pace by genre, not by default.** Flash montage 3-6 frames, match chain
  3-8, hype 4-8, b-roll 1-1.5 s, motion promo a new state every 1-2.5 s. A
  2 s hold in a fast genre is a slideshow.
- **Something is always moving.** Every hold has a camera drift
  (`apply_clip_preset_tool preset=ken_burns_in scope=track`, or
  `set_keyframes_tool` scale_x and scale_y 1 → 1.05 over the shot, or the
  montage tools' `zoom_drift`), a staged reveal or UI doing something. No idle
  wobble either: motion must say something.
- **One current.** One transition direction per piece (left by default); up,
  zoom-through and pull-back are reserved for meaning (reveal, deeper,
  arrival). Never ping-pong directions.
- **Two or three transition presets, repeated.** Variety reads as accident.
  Hard cuts with a sound are still the default between matching shots.
- **Cut mid-motion.** A whip or zoom lands on the cut on both sides; never
  settle to rest, then transition.
- **Type: two families at most.** One condensed display (Anton, Bebas Neue)
  or serif (Instrument Serif), one neutral sans (Inter). Emphasis words 3-6x
  connector size. Text in title-safe; on 9:16 out of the bottom fifth.
- **One look, one accent colour.** Grade every clip the same way.
- **One bold moment.** Spend boldness once (the 3D landing, the merge, the
  word behind the head); keep the rest disciplined.
- **No AI tells:** no generic "Welcome to…" hooks, no stock tagline copy, no
  cream-plus-terracotta palette unless asked, no tracked-out ALL-CAPS eyebrow
  over every heading, no numbered 01/02/03 unless it is a sequence, no
  identical fade-up on every element.
- **Stillness before the climax:** 0.3-0.75 s of hold before the big hit.

## Verification protocol

You cannot watch the video; you can look at frames. Start with the contact
sheet, `inspect_timeline_tool overview: true` (the whole piece in one image),
and `inspect_timeline_tool start, end, maxFrames: 8` across a transition. Then
`preview_frame` (`width: 480` to save tokens; `grid: true` when placing) at:

1. 0.3 s (the hook reads, the first frame is not black or a fade),
2. each kind of cut once: 1 frame before, on, 2 frames after,
3. every entrance end (title, block, 3D landing) and one mid-hold,
4. the climax and the last frame.

For flash and match-cut montages also check 4-6 consecutive cuts in a row:
the subject must sit in the same place and size.

Checklist per frame: no black or letterbox edges · subject at the planned
place · text inside title-safe, readable at phone size, not over the face ·
one focal point · grade consistent with the previous shot. Then the timeline:
`get_timeline_state_tool` — no gaps, shot lengths as planned, an SFX clip at
every cut, music covers the whole piece and fades out.

Fix what fails with the tool that made it (or `undo_tool` and redo with other
arguments), then look at that frame again. Report what you checked.

## When a tool is missing

| Capability | Works on | Without it |
| --- | --- | --- |
| motion blocks (`add_motion_block_tool`) | CLI and `zenvi mcp` with headless Chrome (`zenvi motion setup`) | `add_motion_template_tool` (ui_cards, type_search, kinetic_type, word_scroll, callout, end_card) or `build_reel_tool` motion styles |
| 3D scenes (`add_3d_scene_tool`) | CLI with Blender 4.2+ | AI product still + `set_keyframes_tool` scale/rotation pop + soft `impact_thud`; `add_animated_title_tool` on desktop |
| subject mattes (`generate_subject_matte_tool` and composites) | CLI with onnxruntime-node; editor/cloud only with a matte already in the bin | big type beside the subject in its negative space |
| frame checks (`preview_frame`) | `zenvi mcp`; the editor has its own viewer | `inspect_timeline_tool` frames, or ask the person to look |
| desktop app | engine tools reach it through the bridge; direct tools (sfx, transitions, blocks, 3D, mattes, ramps) are web/CLI only | build in `zenvi mcp`, then `launch_editor` |

A refusal starting with `Error:` names what is missing; switch to the
fallback, do not retry the same call, and list it under the report's gaps.

## Credits

The seam rules (one current, reserved vectors, cut mid-motion, stillness
before climax, no idle wobble) are adapted from HeyGen HyperFrames'
`motion-doctrine` and `cut-the-curve` skills (Apache-2.0, see `NOTICE`); the
AI-tells list follows Anthropic's `frontend-design` skill. The numbers come
from 38 reference reels studied for Zenvi Motion and `docs/TASTE.md`.
