---
id: sports-hype-edit
kind: style
summary: "For athlete, action-sport and match hype: withheld music, one drop on the hero action, scale contrast, a held resolve."
categories: [sports-hype-edit]
tools: [gather_stock_footage_tool, add_clip_to_timeline_tool, detect_beats_tool, detect_subject_tool, align_match_cut_tool, apply_motion_transition_tool, set_clip_speed_tool, speed_ramp_tool, unify_grade_tool, add_kinetic_title_tool, add_track_tool, set_track_role_tool, add_sfx_tool, automate_volume_tool, auto_sound_design_tool, master_audio_tool, render_video, review_render_tool]
pace: fast
mood: [triumphant, gritty, cinematic, energetic]
aspect: ["9:16", "16:9"]
pairs_with: [withheld-music-cold-drop, whip-and-match-cut-chain, foreground-occluder-cut-in-footage, commentary-hits-with-dense-designed-cues, tactile-plate-animation, slow-motion-hero-passage, beat-staggered-tile-and-slice-build]
avoid_with: [stacked-word-flipper, prompt-bar-typing-hero, tutorial-packaging-kit, karaoke-word-highlight-captions]
needs: [music-structure-detect, occluder-cut-finder, planar-surface-track-overlay]
---

# Sports / hype edit

## When to use / not
Use: an athlete, a team, an action sport (skate, ride, ski, surf, run), a
match or season trailer, 15-90 s. Two modes, pick one:
- **Cinematic** (most films): music withheld, foley bed, one designed hit on
  the drop, slow-motion hero passage, sparse wide-tracked cards. -14 to -17 LUFS.
- **Broadcast hype** (a BBC-style spot): commentary hits, a cue every ~3.5 s,
  mixed-media graphics, bold lockup. -10 to -13 LUFS.

Not for: a training how-to (`fitness-lifestyle`), a frag/highlight montage of
game footage (`gaming-montage`), a pure 3-6 frame flash edit
(`flash-cut-match-cut-edit`).

## Structure
| Length | Beats |
| --- | --- |
| 15 s | 0-4 cold open (2-3 quiet shots, foley) · 4 drop on the hero action · 4-11 body, 0.8-1.6 s shots · 11-13 slow-mo or wide reset · 13-15 lockup |
| 30 s | 0-6 cold open · 6 drop · 6-20 development (variants of the action) · 20-24 slow-mo hero passage · 24-30 resolve: wide + lockup held 4-5 s |
| 60 s | 0-10 cold open (VO or ambience) · 10 drop · 10-40 development, one static reset wide of 4-6 s · 40-48 climax at 73-85 % · 48-60 resolve and lockup |
| 90 s | as 60 s with a second, smaller lift at ~40 % (vocal entry) and two development blocks |

Median shot 2.7 s in the films (16.8 shots/min); reels run 0.6-1.6 s. The
first visual change by 3 s.

## Shot plan
- Subject plus environment: the athlete small or mid-frame in most shots;
  close inserts (feet, wheels, hands) as punctuation, 1-3 per 30 s.
- Adjacent shots differ by two sizes (human → aerial, wide → macro).
- One static 4-6 s wide after a run of movement (the reset).
- The drop cut lands on the action's peak frame (take-off, first push).
- One linked chain (`whip-and-match-cut-chain`) per 30 s in the broadcast
  mode; plain cuts in the cinematic mode.

## Look & grade
One grade across every location (spread of saturation within ~15 points):
`unify_grade_tool {"look": "teal_cinema", "look_intensity": 0.5}` for cool
shadows / warm highlights; `warm_cinema` for desert/golden; no look and
`strength` 0.7 for naturalistic documentary. Broadcast mode may go saturated
(`boost_color`). Grain only if every shot gets it.

## Type system
Sparse: 0-2 cards per 30 s. Cinematic: wide-tracked light caps 3.5-8 % height,
1-2 s fades (`add_kinetic_title_tool {"style": "documentary", "animation":
"fade", "text_size": 0.05}`), lower centre or lower right. Ending: a bold caps
lockup 6-11 % (`style: "stack"`, `slide_up`) held 3-5 s. No captions.

## Motion & transitions
75 % hard cuts. Cinematic: hard cuts and 1-2 slow dissolves only in calm
openings/endings. Broadcast: whips, shape matches, one zoom-through, one
glitch (about half the joins). Slow motion 25-50 % for 5-8 s once
(`set_clip_speed_tool target_duration_seconds` or `speed_ramp_tool preset
hero`); `apply_fx_tool optical_flow_slowmo` on 24-30 fps sources (CLI).

## Sound & music
- Music enters on a cut, at its own drop (`withheld-music-cold-drop`), on its
  own track (`add_track_tool {"name": "Music"}` before any `add_sfx_tool`).
- Cinematic: 5-6 foley cues/min (cloth, footsteps, wheels, snow), room tone at
  -24 to -26 dB, one boom + sub on the drop, no whoosh on hard cuts; dip the
  bed 6-8 dB under the slow-mo passage.
- Broadcast: `auto_sound_design_tool {"intensity": "hype", "density": "every_cut"}`,
  commentary through `eq_tool preset phone`, stinger on the lockup.
- Levels (CRAFT): hero hit momentary -9 to -11 LUFS, whoosh 3-6 dB under it,
  master -14 LUFS (cinematic) or -11 (broadcast), true peak ≤ -1 dBTP.

## Captions/VO
VO optional (3 of 4 films): calm, sparse, 50-105 wpm, stops dead on the drop.
Cut on VO pauses. No captions. A synthetic voice costs more than it gives: an
ambience-only cold open is better than a flat TTS line.

## Tool sequence
1. `gather_stock_footage_tool {"queries": ["<sport> wide", "<sport> close-up
   feet or hands", "<sport> aerial", "<sport> hero action", "stadium night"],
   "orientation": "portrait", "count": 14}` (or the user's clips; one shoot
   per sport beats a mix).
2. `detect_beats_tool` on the track; find its drop (loudness jump) and note
   the source second.
3. Cold open: 3-4 `add_clip_to_timeline_tool` calls, wide / insert / wide /
   close, 1.2-2 s each.
4. Drop: the hero shot at `drop` on track 1; `add_track_tool {"name":
   "Music"}`; music `add_clip_to_timeline_tool {"position_seconds": <drop>,
   "start_seconds": <track drop>, "track": "Music"}`; `set_track_role_tool`.
5. Body: shots of 2-4 beats; one `align_match_cut_tool` ball/shape match with
   `detect_subject_tool` boxes; one `apply_motion_transition_tool zoom_through`.
6. Slow-mo hero: `set_clip_speed_tool {"target_duration_seconds": <2x>}`;
   `automate_volume_tool dip -7` on the music over it.
7. Resolve: a wide (stadium, landscape) 3-4 s + the lockup title.
8. `unify_grade_tool` with the look.
9. Sound: room tone + 3-4 foley cues in the cold open, `reverse_swell` into
   `impact_boom` + `sub_drop` on the drop, a hit on the match, punch on the
   zoom-through, `tail_bloom` after the lockup boom.
10. `master_audio_tool {"preset": "social", "genre": "hype"}`; render;
    `review_render_tool`; fix pass.

## Finish checklist
- [ ] Music is placed: it starts on a cut at 17-40 % (or a vocal entry), never from frame 0.
- [ ] About half the cuts sit on VO pauses, phrase entries or beats.
- [ ] Neighbouring shots differ by two sizes; one static reset wide exists.
- [ ] Sound fits the mode (cinematic: no whoosh on hard cuts; broadcast: ~17 cues/min).
- [ ] One grade across locations.
- [ ] The ending resolves: a lockup or wide held 4-5 s, never a black hold.
- [ ] First picture interest within 3 s (no long sponsor cards).
- [ ] Loudness fits the mode; true peak ≤ -1 dBTP.

## Mix-and-match
Borrow: `withheld-music-cold-drop`, `slow-motion-hero-passage`,
`foreground-occluder-cut-in-footage` (street/trail films),
`whip-and-match-cut-chain` + `commentary-hits-with-dense-designed-cues` +
`tactile-plate-animation` (broadcast mode), `beat-staggered-tile-and-slice-build`
(9:16 moto/skate reels, once at the drop). Never: the broadcast palette inside
a cinematic film; captions; UI blocks.

## Reference moments
Local only, `~/zenvi-motion/refs2/sports-hype-edit/`: `96992249@0-10.1` VO over
silence, `96992249@10.1` the drop on the first skater; `96992249@24.8` occluder
cut; `157239808@4.3` helmet close-up to top-down aerial; `157239808@46.9` 5 s
static monumental wide; `111085476@35.3` slow-motion hero passage;
`111085476@10.3` wide-tracked fade cards; `1193944745@13.9` whip/match chain;
`1193944745@16.2` commentary peak; `1193944745@41.5` mural lockup.

## Example (verified)
2026-10-29, 19.8 s, 720x1280, CLI only, no VO (`~/zenvi-motion/fleet/artifacts/sk5-edit-driven/styles/sports-hype-edit/`):
a 3.2 s cold open on action (sprinter in the blocks, feet, track) with room
tone and cloth/strike foley and a small "the last run" card; the trap track's
own drop (source 12.42 s) on the cut to a snowboard jump with a swell, boom
and sub; 8 body shots of 2-4 beats; a football-to-basketball shape match
(`detect_subject_tool` + `align_match_cut_tool`); a zoom-through into a boxer
with punch foley; a 0.5x surf passage with the bed dipped 7 dB; "EVERY RUN
COUNTS" over a night stadium; `teal_cinema` at 0.5; mastered.
Pairwise judge vs `96992249@0-25` (KEEP ON PUSHIN'): v1 3.64 vs 7.5 (a 6.8 s
silent cold open on a stumble read as a dead hook; no foley on the action;
small left-aligned end title), v2 5.82 vs 5.55, tie (cold open cut to 3.2 s
and opened on action, foley on punches/kicks/dunk, centred creator lockup).
Absolute 4.18: grades of six stock shoots still clash; the reference's score
moved 2 points between runs, so read single pairwise numbers loosely.
Lesson in the skill: on a vertical short, withhold only 2-4 s and open on
motion.
