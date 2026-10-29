---
name: zenvi-motion-director
description: Load this before the first Zenvi tool call whenever you make, cut or recreate a whole video with the Zenvi MCP tools (mcp__zenvi__*) - a reel, short, ad, promo, montage, trailer, explainer, talking head with captions, product or app video, or a reference to match. The director's playbook - a timed plan, the genre recipe with exact tool calls (match-cut montage, flash montage, kinetic captions, SaaS/UI promo, 3D product ad, editorial type, grid montage, documentary, hype reel, tutorial, showreel), motion transitions, motion blocks, 3D, a sound on every cut, and the frame checks that keep an edit from looking like a slideshow.
---

# Zenvi motion director

You are the director. The tools do the craft (one undo step each, with a
receipt); your job is the decisions a senior editor makes before touching the
timeline and the frames you check after. `zenvi-reels` is the one-call reel;
this skill is for edits that must hold up next to a professional one.

## Start here: the genre and its recipe

Pick the genre, then **read its recipe now with the Read tool**:
`<this skill's base directory>/recipes/<file>.md` (the recipes are part of this
skill, not the user's files; an MCP client without the plugin reads the same
recipe as the resource `zenvi://director/<genre>`). The recipe has the structure in seconds, the
shot lengths, the sound plan and the exact tool calls; the rest of this file
is the rules every genre shares. Do not plan before you have read it.

| Ask sounds like | Recipe | Core tools |
| --- | --- | --- |
| shapes or poses that line up across cuts | `recipes/match-cut-montage.md` | match_cut_montage_tool, detect_subject_tool |
| a new image every few frames, "evolution of" | `recipes/flash-montage.md` | gather_stock_footage_tool, match_cut_montage_tool transitions=flash |
| person talking, captions are the show | `recipes/kinetic-captions.md` | generate_tts…, generate_subject_matte_tool, kinetic_captions_tool (cues, text_size, animation), add_kinetic_title_tool |
| app, AI tool, SaaS launch | `recipes/saas-ui-promo.md` | add_motion_block_tool (glass_cards, prompt_bar, kinetic_headline, counter, word_rotator) |
| one product, 3D, "spins in" | `recipes/3d-product-ad.md` | add_3d_scene_tool (device_mockup, glass_hero, title_3d), prompt_bar, particle_burst |
| type is the picture, design study, brand | `recipes/editorial-type.md` | kinetic_headline, text_scramble, hud_callouts, crop_labels, flash_white |
| tiles filling on the beat, split screen | `recipes/grid-montage.md` | add_motion_template_tool template=grid |
| voice-over essay, story, explainer | `recipes/documentary.md` | TTS, kinetic_captions_tool documentary, add_kinetic_title_tool, build_reel_tool cinematic, grid collage |
| sport, cars, launch hype, "fast", "hype", "trailer", "edit to this song" | `recipes/hype-reel.md` | **build_reel_tool hype first** (ramp, glitch drop, whips, flashes, one look built in), auto_sound_design_tool every_cut, review_edit_tool |
| how-to, effect breakdown, tips | `recipes/tutorial.md` | build_reel_tool tutorial, step_card, end_card save |
| intro, showreel, "about me" | `recipes/showreel-intro.md` | title_3d, word_rotator, grid zoom_into, particle_burst |

Mixed asks: take the structure from the genre of the *first five seconds*
and borrow single techniques from the others.

Every recipe ends with **Finish**: sound on every cut, `master_audio_tool`,
`render_video`, `review_render_tool`, `watch_render_tool` once, one fix
pass. A run that stops before it is not done, however good the picture:
unmastered edits arrive 9-17 dB too quiet and nobody has looked at the file.

## The director loop

1. **Brief.** One line each: format (size, fps, seconds), story in shot order,
   pace, look, type, sound, the *one bold moment*, following the recipe. Use
   the brief's own words, colours and names exactly.
2. **Plan with timings.** Write the edit as a table before any tool call:
   `t (s) | shot / element | length (frames) | entrance / transition | sound`.
   Every row has a sound. Times snap to frames; music edits snap to beats.
3. **Project.** `open_project_file`, then `set_project_setting_tool`
   (`width`, `height`, `fps`) before importing anything.
4. **Assets.** One `gather_stock_footage_tool` call with a query per story
   beat or shape (`queries: [...]`, `count`, `orientation`, `min_seconds`):
   it searches them all, dedupes and imports the best distinct clips, one
   line each. Use `search_pexels_videos_tool` + `import_stock_media_tool`
   only to pick one specific shot. One music track
   (`search_freesound_music_tool` with `min_seconds` above the length), AI
   stills only for what stock cannot show. Too few assets is the commonest
   cause of a slideshow: get 1.5x the shots the plan needs. Count before
   cutting: the recipe gives a **source count** for its genre (a montage at
   3-4 cuts a second: 12-16 clips; hype: one per ~1 s; otherwise one per
   ~1.5 s), and no clip may come back within 3 s. The montage tools warn
   when one does and say how many more to import; `strict_variety: true`
   makes them refuse instead. Short? Gather again with other words, or
   generate AI shots, before you cut; never loop five clips to fill the length.
5. **Cut.** The genre tool first (`match_cut_montage_tool`, `build_reel_tool`,
   `add_motion_template_tool template=grid`), otherwise
   `add_clip_to_timeline_tool` per row. Get `beats` from the receipt
   (`data.beats`) or `detect_beats_tool` and reuse them everywhere below.
6. **Transitions, on by default** where the genre moves between shots
   (hype, trailer, SaaS, 3D ad, documentary, showreel: the recipe says which).
   The genre tools already put them on their cuts in the same undo step:
   `build_reel_tool` (hype/highlight), `match_cut_montage_tool`
   (`transitions: "punch"` default, `"flash"` for a flash montage, `"whip"`,
   `"none"`), `add_motion_template_tool template=grid` with `steps` (a whip on
   each re-cut). Read the receipt's `data.transitions`; do not stack another
   pass on top. For cuts you made by hand: one call on the final cut,
   `apply_motion_transitions_tool` with no `track` (every scene change, across
   tracks: a scene stacked on several tracks moves as one) or one `track`,
   `style: "hype"` or `"cinematic"`, `direction: "left"` (they are keyframes
   on the clips); `apply_motion_transition_tool` for one cut. Two or three
   presets per piece, repeated; one direction. A cut list of hard cuts plus
   whooshes is the commonest gap against the references. Match cuts and
   editorial type stay hard cuts.
7. **Motion and 3D.** `add_motion_block_tool` (headlines, prompt bars, glass
   cards, counters, rotators, HUD, bursts), `add_3d_scene_tool` (draft first),
   matte composites (`text_behind_subject_tool`, `replace_background_tool`,
   `subject_glow_tool`, `pop_out_tool`), `speed_ramp_tool` on hero shots.
8. **Captions and type: type moves.** `kinetic_captions_tool` for speech
   (word by word, emphasis words big; a TTS voice-over keeps its script's word
   timings, so pass its clip in `timeline_clip_ids`; `cues` when there is no
   voice to time to, or the TTS receipt says it has no word timings (then say
   the captions are hand-timed), `text_size`, `animation`); song lyrics on
   screen: `align_lyrics_tool` (`text`: the lyrics, one line per sung line;
   `timeline_clip_id`: the song) first, then the captions and
   `place_on_word_tool` use the lyrics at their sung times; it places each caption in the shot's
   negative space and, after `generate_subject_matte_tool` on the footage,
   puts emphasis words behind the head. Title cards and word cards:
   `add_kinetic_title_tool` (`animation`: pop, slam, tilt, scramble,
   letters, typewriter, slide_up, rise; never a bare fade).
   `text_behind_subject_tool` for one full-width hero word; `add_title_tool`
   with a bundled family (`font: "Anton"`, `"Instrument Serif"`, `"Space
   Mono"`...) only for static labels and logo bugs.
9. **Colour: match first, then the look.** `unify_grade_tool` (no
   arguments: every footage clip toward the cut's median look; or
   `reference_clip_id` = the hero shot) so daylight and night shots stop
   jumping on the cut. Then one look for the whole piece: pass a LUT as
   `look` with `look_intensity` 0.5-0.7 in the same call, or `apply_look_tool`
   with a LUT id (ids from `list_looks_tool`). Flash montages, trailers and
   anything cut from many sources always go through this pass
   (`build_reel_tool`'s hype and highlight styles do it in their own step).
   Soft presets (`sunny`,
   `warm_up`...) replace the corrective grade: not after unifying. Grain
   only on cinematic pieces. Stylised looks go through `apply_look_tool`
   too: `solarize` (a flash frame or one hype shot), `chrome` (silver
   metal), `bleach_bypass`, `duotone` / `"duotone #rrggbb #rrggbb"` (promo
   landscapes), `accent_red` / `"accent #rrggbb"` (one colour kept; a
   different accent per shot for a sequence). Frame them with
   `add_vignette_tool` (cinematic: amount 0.3-0.5) and
   `add_shape_mask_tool` (feathered box or ellipse windows, iris and box
   reveals with `keyframes` on `grow`).
10. **Sound, last: hand it to the sound designer.** When the picture is
    locked, load the `zenvi-sound-designer` skill and run its loop with this
    recipe's genre: `spot_sound_tool` (the cue sheet: every cut, move, block
    click, card land, emphasis word, 3D landing and the climax),
    `auto_sound_design_tool` with the genre's palette (`beats`,
    `climax_seconds` when you have them), at most 5 `add_sfx_tool` for
    in-shot actions the sheet cannot see, then `master_audio_tool`
    `{"preset": "social", "genre": ..., "iterate": true}`: the Sound Score's
    fixes (voice 10 dB over the bed, levels, timing) and the master to -14
    LUFS / -1 dBTP in one undo step. Read its score: 85+ with no gate is
    done; otherwise the receipt's top fixes, then master again (at most
    twice). Music at full level unless there is speech; music from
    `search_freesound_music_tool` is commercial-use by default.
11. **Master always last.** Any later audio edit means mastering again. An
    unmastered edit arrives 2-5 LU quiet and clips on the platforms.
12. **Verify** (below), fix, verify again. Then `render_video` and
    **review the file**: `review_render_tool` with the path it wrote, then
    **watch it**: `watch_render_tool` once, with the brief. One fix pass:
    every `PROBLEM` line and every `HIGH` watch issue (each names its shots
    and tools), render again, review again, watch again at most once, report
    both watch scores.

Order matters: speed ramps change clip lengths (`ripple: true`), transitions
read the cuts, sound design reads cuts, transitions and titles. Anything that
moves a cut after step 6 means removing and re-applying the transitions on
that track (`remove_motion_transition_tool track=...`) and re-running sound.

## Best of three (when the brief allows)

One run of the same brief swings 12-16 bench points; making three cuts that
differ on purpose and keeping the best is the cheapest gain. Do it when the
piece is 60 s or shorter, watching works (`watch_render_tool` was not
refused), and the person did not ask for one quick version. Skip it for the
one-call `zenvi-reels` and say so under gaps when you skip.

1. **Base.** Run the loop to a finished edit (sound designed, mastered) and
   save it. This is variant 1.
2. **Two deliberate variants, one axis each**, taken from the brief, never
   random: **pacing** (shots 30 % shorter or longer, a speed ramp into the
   drop), **type system** (the other family or animation from the style),
   **grade** (the other look the style allows), or **music** (the second
   track from the search). Pick the two axes the brief is least sure about.
   For each: `fork_project_tool {"name": "fast-cuts"}`, `open_project_tool`
   the path it returns, make the change (a moved cut means re-running
   transitions and sound), `master_audio_tool` again, and render a proxy:
   `render_video {"output": "renders/fast-cuts.mp4", "width": 540, "quality": "low"}`.
   Render the base's proxy the same way.
3. **Tournament.** `open_project_tool` the base again, then
   `pick_best_variant_tool` with all three (base first) and the brief: each
   match is watched side by side in both orders, and the winner becomes the
   open project in one undo step.
4. **Refine the winner** with the 3 fixes the receipt lists (each names its
   tools), render the full-size file, `review_render_tool`, and
   `watch_render_tool` once. Report the ranking, the winner and both scores.

```json
fork_project_tool {"name": "warm-grade"}
pick_best_variant_tool {"brief": "15 s hype reel for a sneaker drop", "variants": [
  {"name": "base", "project": "reel.zvn", "render": "renders/base.mp4"},
  {"name": "fast-cuts", "project": "reel-fast-cuts.zvn", "render": "renders/fast-cuts.mp4"},
  {"name": "warm-grade", "project": "reel-warm-grade.zvn", "render": "renders/warm-grade.mp4"}]}
```

`compare_renders_tool {"a": ..., "b": ...}` is the same judgment for any two
renders (before/after a fix pass, two music beds) without changing anything.

## Non-negotiables

- **Sound on every cut.** In the references a cut lands on an audio
  transient 50-100 % of the time and on the beat only 20-40 %: the whoosh or
  hit makes the cut. Risers end on the drop, an impact lands on it.
- **Loud enough, not louder.** Music-led references sit at about −13…−16 dB
  RMS, calm studio pieces lower. Never bury music under nothing; never leave
  a stretch silent unless the silence is the moment.
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
- **One look, one accent colour, on matched plates.** `unify_grade_tool`
  before the look; a bright shot next to a near-black one reads as two
  videos, whatever LUT is on top.
- **Variety.** No source clip within 3 s of itself; at least one distinct
  clip per ~1.5 s for hype and montage. Each strong shot at most twice;
  vary the order of a match-cut chain instead of looping it. The same five
  shots every second is the slideshow tell viewers notice first. A review
  that finds a repeat lists the `swap_shot_tool` call that fixes it (an
  unused clip, or a part of the clip not shown yet): make those calls.
- **A clean end.** End on a hold, an end card or a settled final shot of 1 s
  or more, never on black and never cut off mid-motion. Sound effects and
  music end with the picture (trim what runs past the last frame), or the
  render pads it with black.
- **Never clip.** Master last; the delivered file's true peak stays at or
  under -1 dBTP.
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
place · every letter inside the frame and inside title-safe, readable at
phone size, not over the face · type on a calm area (a field, glass, a
scrim), never straight on a busy photo ·
one focal point · grade consistent with the previous shot. Then the timeline:
`get_timeline_state_tool` — no gaps, shot lengths as planned, an SFX clip at
every cut, music covers the whole piece and fades out. Audio:
`analyze_timeline_audio_tool` for each clip's level; music-led edits sit
near −13…−16 dB RMS, calm product and studio pieces at −20…−24 (the recipe
says which): lower a hot mastered track (`set_clip_volume_tool`
`level_db: -4` or more) rather than burying the effects; raise nothing
above 0 dB.

Fix what fails with the tool that made it (or `undo_tool` and redo with other
arguments), then look at that frame again.

**Review the render, not just the timeline.** After `render_video`, call
`review_render_tool` on the file. It reads the MP4 and reports black and
frozen frames, the end (hold or black), true peak and loudness, and shots
repeated too soon, with a contact sheet of every shot and the last frame
(problems framed red). Fix every `PROBLEM`: ends on black → trim what runs
past the last picture and render again; true peak → `master_audio_tool`;
repeated shot → the `swap_shot_tool` calls it lists (one per repeat; none
listed means import more footage). Report the final review's numbers.

**Then watch it, once.** Frames and meters cannot hear a silent whip or feel
a sagging middle. `watch_render_tool` with the path and the brief has an
editor watch the file with its sound: a 1-10 score per dimension and 3-6
timestamped issues, each with the shots it falls on and the tools that fix
it. Fix the `HIGH` ones (and any `MEDIUM` that is one call), render, and
watch again at most once; report the score before and after. It costs a few
credits and needs a Zenvi sign-in: refused (signed out, no credits) means
skip it and say so under gaps, never retry.

The finishing calls, in order (after the picture and the sound are locked):

```json
unify_grade_tool {"look": "teal_punch", "look_intensity": 0.6}
master_audio_tool {"preset": "social", "genre": "hype", "iterate": true}
review_render_tool {"path": "reel.mp4"}
watch_render_tool {"path": "reel.mp4", "brief": "15 s hype reel for a sneaker drop"}
```

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
When the backend fails (TTS, AI images, stock search answer `Error: Zenvi
backend ...`), try once more with other words, then work without it: write
caption cues from the script at about 2.5 words per second and let the music
be the clock; use stock instead of AI stills.

## Credits

The seam rules (one current, reserved vectors, cut mid-motion, stillness
before climax, no idle wobble) are adapted from HeyGen HyperFrames'
`motion-doctrine` and `cut-the-curve` skills (Apache-2.0, see `NOTICE`); the
AI-tells list follows Anthropic's `frontend-design` skill. The numbers come
from 38 reference reels studied for Zenvi Motion and `docs/TASTE.md`.
