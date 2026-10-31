# The cinetic method: directing a motion-design film in Zenvi

Adapted from cinetic (https://github.com/Leonxlnx/cinetic, MIT, (c) 2026 Leonxlnx; see `NOTICE`), which
directs short films from code. Zenvi uses neither of its engines: every step below is a Zenvi tool call, and
the five `cinetic-*` styles (launch film, teaser, feature loop, logo sting, UI walkthrough) each add their
format's acts to it. Read this once, then only your style's file.

You are directing a short film, not animating a page. Picture, copy and sound are one system on one beat
grid, and nothing is finished until it has been rendered, measured and critiqued.

## The bar and the five laws

1. **One idea, specific to this product.** You can say the film in one sentence, and the proof shows what
   this product does that the obvious or simpler version would not.
2. **One story device.** An object, shape or colour this product owns travels through every shot, never
   blinks out at a cut, and resolves into the mark at the end (in a loop: into the product's finished
   state). A bare dot, line or block is the lazy default.
3. **One accent with one meaning** ("now", "new", "yours"): about 8 % of the pixels or less, flooding the
   frame at most once.
4. **One house motion system.** Three easing characters for the whole film, each for a stated reason:
   `ease_out_expo` for arrivals, `ease_in_out_sine` for camera and drifts, `ease_in_cubic` for exits into a
   cut. `ease_out_back` only for a true landing, at most twice a film, never on copy.
5. **Verify by measurement.** Done means the rendered file passed `review_render_tool`, one
   `watch_render_tool` and your own look at its contact sheet.

Visual, not narrated: the idea reads with the sound off. Weight and stillness: motion arrives on the beat,
then rests. Every sound has something visible that causes it. When in doubt, remove.

## The house taste (a profile, not a law)

When Zenvi invents the look, a cinetic film never shows: serif or italic type (or a skew faking one),
condensed display faces; orange, amber, beige, cream, tan or sand; purple, violet, indigo or any
multi-hue gradient; neon, glow, bloom, halos, lens flares, light leaks; glassmorphism; particles,
sparkles, confetti, starfields, code rain; emoji and stock icons; eyebrow or kicker labels, stacked
taglines, "Introducing..."; full sentences at once; bouncy overshoot on anything that is not landing;
glitch, flash-through-white and spin transitions; crossfades as the default.

What remains is plenty: ink and paper (light or dark, neutral or cool), one accent from red, green, teal,
blue or yellow with a meaning, one clean sans, and motion that is eased, weighted and smooth.

These bans are this house style only. **The person's brand always wins**: their serif wordmark, their
orange, their glass UI. Save it in the brief (`save_brief_tool` `brand`, in their words) and the bans are
off; `review_edit_tool` and `review_render_tool` lint them (codes `house-ban-*`) only for a cinetic style
with no brand. Other Zenvi styles use serif-italic accents and glass cards on purpose.

## Step 0. Intake -> the brief

- If the request states the product, the message and the length, infer the rest and write the
  assumptions into the brief. Otherwise ask at most three questions: the product in one line, the format
  and length, where it will be shown.
- Pick the style (`cinetic-launch-film`, `cinetic-teaser`, `cinetic-feature-loop`, `cinetic-logo-sting`,
  `cinetic-ui-walkthrough`) and the pace: **calm** (the default, 100 BPM) unless the brief asks for energy;
  **crisp** (120 BPM) is an opt-in ("punchy", "hype", "energetic", a teaser).
- `produce_video_tool {"request": "<their words>", "style": "cinetic-launch-film"}` or `save_brief_tool`
  saves the brief, and with a cinetic style Zenvi **draws the techniques** into it (`draw`, next step).
  Gate: the brief's spec line reads like `1920x1080@60, 30 s, 100 BPM, calm, effects only`.

## Step 1. Concept -> treatment (in the brief)

- Start from specifics: what the name means or evokes (it often hands you the mark and the device), the
  feature's non-obvious behaviour ("unlike the obvious version, it..."), the product's own objects (its
  rows, cards, readings, states).
- Write three concepts through different lenses: (a) the product's own verb made literal, (b) the viewer's
  pain made visible, (c) a formal device (a relay object, a bookend, one unbroken camera move, a container
  that becomes the product). Throw out any whose props could appear in another product's film.
- **Draw the techniques; do not choose them.** The brief's `draw` holds about one technique per 3.5 s
  (calm) or 2.5 s (crisp), in the order the format needs them, weighted toward proven moves and the film's
  energy, and never the ones the last films on this machine drew (`get_brief_tool` shows it). Read each
  pick with `get_technique_tool {"technique": "<technique>"}` and build the ones the concept can carry, retold in its
  objects and device. Reroll a pick that fights the concept at most twice (save the brief again without
  `draw` after you change the style or length), or drop it with a written reason; never add one the draw
  did not give. A pick marked `ban_safe_variant` is built as its file's ban-safe variant.
- The treatment lives in the brief: `goal` = the logline (15 words or fewer); `beats` = the arc (hook
  inside the problem, felt by 1 s -> turn -> proof of one or two capabilities -> promise -> lockup);
  `storyboard` rows with the device in every row; `motifs` and `through_line` = the device; `critique` =
  the deletion test (remove the demo beats and the value still reads), the specificity test (would it be
  just as true of a simpler product?) and the feature-word test (muted, would a stranger use the brief's
  word for the feature?).
- Gate: 15-25 words of copy in a 30 s film (30 at most); every fragment 1-4 words; no beat shows more than
  8 words (5 in replace mode); copy on at most 65 % of the runtime, with 1.5 s or more of picture without
  text in every 10 s; every drawn technique placed in a beat or dropped with a reason.

## Step 2. Brand from three words

- With the person's brand: use it, record it in `brand`, done.
- Without: write three personality adjectives and derive everything from them: the sans (a humanist sans
  at a light weight for calm, a tight grotesk for fast, a rounded sans for friendly; motion blocks
  `display_font: "sans"`, titles `add_kinetic_title_tool` style `documentary`), weight and case, the stage
  (light or dark, neutral or cool: tint the neutrals toward the name's world, pine-black or ink-navy rather
  than #000), and one accent from an allowed family with its meaning.
- A palette with character, from the world of the name (a hillside: pine, moss, slate; a foundry:
  charcoal, soot, a glowing red). Framework blues (#3B82F6, #2563EB) and flat greys read as default. Heat
  or fire names go red-hot or white-hot, never orange.
- The mark: sketch 6-10 directions from different sources (the name's meaning, a letterform, the product's
  object, the metaphor, a pure construction), reject the "geometric block + accent dot" family and anything
  that reads first as a common symbol at 64 px. Build it from 2-4 primitives: `logo_build` (`mark`,
  `colors`) or the person's logo file through `logo_reveal_end`.
- Gate: `save_frame_image_tool` stills of the mark small and full size, one statement frame, one product
  frame; you looked at them.

## Step 3. The grid

- 60 fps when UI, text or the camera moves: `set_project_setting_tool {"fps": 60}` (a GIF loop exports 25).
- 100 BPM: beat 0.6 s (36 f), bar 2.4 s. 120 BPM: beat 0.5 s (30 f), bar 2.0 s. Every cut and cue sits on
  the 16th grid (0.15 s at 100 BPM, 0.125 s at 120) or has a written reason; section changes on downbeats,
  cuts inside a section on 8ths; a batch of landings snaps to 16ths with a 0-3 f spread.
- With music: `detect_beats_tool` on it and take the times from its receipt. Effects only: the grid is
  the style's tempo, written as the beats' times in the brief.
- Each bar has one motion peak; text and the hero action take turns on the grid; nothing stays still more
  than 72 f (1.2 s; crisp 48 f) except a reading hold (it drifts) or one designed near-still hold of
  60-96 f on the key claim, under a music dropout, followed by a big move.

## Step 4. Build, act by act

- Words reach the screen one fragment per call: `add_kinetic_title_tool {"text": "<1-4 words>", "style":
  "documentary", "animation": "rise", ...}` or a `kinetic_headline` block (`style: "rise"`, `emphasis:
  "accent"`, `display_font: "sans"`). A thought of more than 4 words is a chain of 2-4 fragments with 0.5-1.5
  s (30-90 f) of picture between them; a fragment holds max(1.0 s, 0.7 s + 0.13 s per word) once it
  resolves, drifting 1-3 % (`set_keyframes_tool` scale 1.0 -> 1.02 linear) so it is alive.
- Emphasis by colour, never bounce: the accent on the keyword, or the newest fragment arrives in the accent
  and relaxes to ink over 10-30 f. Only the one hero word may move letter by letter.
- Type sizes at 1080p: statements 88-128 px, a build line reaching 6-8 words 48-72 px, a standalone hero
  word 14-48 % of the frame height, UI text 22 px or more after camera scale. Tabular figures for numbers.
- Product UI: the person's real screens (recordings, screenshots) on the timeline, framed at 70-92 % of
  the frame width, pushed in 2-5x (`set_keyframes_tool` scale with `ease_in_out_sine`) on every
  interaction that carries the story; a wide shot of readable UI holds 1.7 s at most. Or the UI blocks
  (`prompt_bar`, `toggle_panel`, `notification_stack`, `chat_thread`, `data_table`, `cursor_path`,
  `code_card`, `counter`, `chart_build`). Data agrees with itself and with the story on every frame.
- Motion: duration grows with distance (calm 0.5 s + 1.6 ms per px; camera 0.9-3.0 s); a secondary move
  starts at 55-75 % of the leading one; entrances decay, exits accelerate, only the camera eases both ways;
  scale in log space (two keys with `ease_in_out_sine` read right up to 2x; split larger zooms).
- Speed: ordinary moves 25 px/f or less (1080p, 60 fps); over 12 px/f gets motion blur; nothing over
  60-80 px/f except frame-filling edges (wipes, irises, zoom-throughs); readable text 20 px/f or less, and
  3 px/f or less while it is being read. `review_edit_tool` measures this from your keyframes.
- Transitions: 6-8 types a film, each at most twice, plus one signature move from the mark used three
  times (open, middle, close). Hard cuts on the grid, match cuts, mask wipes (`add_shape_mask_tool`
  keyframed), relays and morphs; `apply_motion_transition_tool` `whip`/`slide`/`zoom_through`/
  `blur_dissolve` sparingly. Never a crossfade by default, never through black. Both sides of a cut at
  rest, or the incoming shot starts at the outgoing velocity.
- Layout: no "text left, UI card right", no small centred card on an empty field; the hero covers 40-70 %
  of the frame; margins 96 px at the sides and 64 px top and bottom (5 % / 6 %); in 9:16 the caption and
  button zones get background, not an empty band. Text never lands on text.
- After each act: `review_edit_tool {"start": <a>, "end": <b>}` and look at its sheet.

- Zenvi facts that rendering 30 of the techniques taught (2026-10-31):
  - `set_keyframes_tool` `seconds` count from the clip's start; on a clip that starts later use
    `timeline_seconds`, or the move lands that much late.
  - Titles and kinetic titles are one clip per word with absolute `location_x`/`location_y`: read the
    word's own value first and animate from it; scale words about a shared pivot (`loc = C + f * (loc - C)`).
  - `origin_x`, `origin_y` and `corner_radius` cannot be keyframed; `apply_fx_tool` refuses titles and
    stills (use `add_effect_tool` Blur with keyframes there).
  - The UI blocks (`prompt_bar`, `chart_build`, `data_table`, `cursor_path`) keep their own internal
    timing: measure where their beat lands in a draft and put the cut and the sound there.
  - `add_shape_mask_tool` ellipses default to 0.6 of the frame: an iris that must cover the frame needs
    width and height above 1.42.
  - Use `duration_seconds` on `add_clip_to_timeline_tool` when the clip does not start at 0.

## Step 5. Sound

- Effects come from visible events: `spot_sound_tool` lists the events still without a cue;
  `add_sfx_tool` places one sound per role (`ui_tap`/`mouse_click` for a press, `hit_transient` for a landing,
  `whoosh_short` with its apex on the visual peak for the two or so camera-scale moves, `riser_tonal` into a
  reveal, one soft cue per text fragment on the frame it resolves, never one per word). Cuts, scrolls,
  streams and rolling counters get nothing (a counter's final lock gets one tick). Once a class of action
  is sounded, every instance is, at one level.
- `auto_sound_design_tool` is the quick pass; then remove what has no cause.
  `review_edit_tool` reports every sound effect more than a frame from anything that changes on screen.
- Music only when the film wants a groove (a calm, text-led film is effects only, mastered at -18 LUFS).
  With music: the drop on the hero reveal 30-60 % in is the loudest moment; the lockup is the most
  resolved, not the loudest: the music stops on a bar line, then ONE clean hit on the frame the wordmark
  becomes readable and a 0.5-2.5 s tail; nothing in the 0.2-0.7 s before it.
- `master_audio_tool {"target_lufs": -14}` with music, -18 effects only, -16 for a sting; true peak -1 dBTP.

## Step 6. Render and finish

- `export_video_tool` writes H.264 tagged BT.709; for a cinetic style it also runs the dithered deband
  pass, so gradients do not band (`zenvi render --deband` on the CLI for any project).
- Moves over 12 px/f: bake motion blur on those clips (`apply_fx_tool` `directional_blur` on the move's
  window, or `radial_blur` on a zoom).
- Loops: the last frame flows into frame 0 (see `cinetic-feature-loop`).

## Step 7. Review loop and ship gate

1. `review_render_tool {"path": "<render>"}`: black, frozen and repeated shots, loudness, true peak,
   flashing, banding, sound effects without a visible cause in the render, and for a cinetic style the
   copy pacing and the house bans. Fix every PROBLEM line.
2. Look at the contact sheet before anything else: the weakest 3 s; anything cheap, templated or dead; does
   each act land in under 1 s; does the story read muted; the 2 s hook; one fragment at a time; the end.
3. `watch_render_tool` once (an editor watching with sound). Do not add text to fix a beat: split a
   sentence into a chain, or let the picture carry it.
4. Score the rubric 1-5: idea and device, hook (0-2 s), copy and type, colour and brand, composition,
   motion, transitions, pacing, product truth, sound and sync, finish. **Ship gate:** every dimension 3 or
   more, finish and sound/sync 5, mean 4.2 or more, no open P0 (P0: visible on a key beat, breaks the story
   or a fact, or a house ban the brief does not list as the brand's). Launch films and walkthroughs get two
   rounds at least; stings and loops one. Stop after five rounds and say plainly what you would still change.

## Step 8. Deliver

The master; for a launch film the 9:16 and 1:1 re-layouts (re-laid from the same beats, never a crop of the
master); a poster (`save_frame_image_tool` on the final frame, which must carry the mark and the name or
URL); for a loop the seamless file; for a sting the alpha version (`export_video_tool` ProRes 4444).

## The scaled-down path (stings, loops, short feature clips)

The laws, the grid, the review and one round still apply; the rest shrinks: a one-page treatment in the
brief (logline, device, the draw, 2-8 beat rows, the copy), the mark small and one hero still for style
frames, one or two acts, sound optional for a loop (a sting needs one hit tuned to the key and a tail to
digital silence), one review round.
