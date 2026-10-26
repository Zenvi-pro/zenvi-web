---
name: zenvi-reels
description: Make a finished short-form video (Instagram Reel, TikTok, YouTube Short, ad, teaser, montage, highlight reel, app promo, product reveal, how-to) from one short ask with the Zenvi MCP tools - write a brief, gather the footage and the music, then cut it on the beat in a style with build_reel_tool (footage-led or motion-designed), check the frames and render. Use it whenever the user wants a reel, short, edit "on the beat", hype video, montage, highlight reel, social ad, motion-graphics promo or tutorial, even from a one-line prompt.
---

# One-shot reels with Zenvi

A reel is cut to music. Zenvi's `build_reel_tool` does the whole cut in one
step (and one undo step): shots on the music's beats, the style's camera
moves and look, flashes on downbeats, an opening hook title, shot labels,
an end card, and the music bed faded out. Your job is the part a director
does: the brief, the footage, the music, the words, and the final check.

When the ask names a genre or technique `build_reel_tool` does not cover
(match cuts aligned on a subject, flash montages, kinetic captions, glass UI
promos, 3D product shots, grid montages, video essays), points at a reference
video, or has to hold up next to a professional edit, use the
`zenvi-motion-director` skill: it plans the edit with timings and adds
motion transitions, motion blocks, 3D scenes, matte composites and sound
design on every cut. This skill stays the quick path; its steps 4b and 4c
below are the director's minimum.

## 1. Write the brief first (show it to the person)

```
Format  15 seconds, vertical 9:16
Story   pour, steam, first sip, morning light (in shot order)
Pace    fast cuts on the beat, faster in the last third
Look    punchy colour, fine grain, slow push-ins
```

Pick from the ask; ask nothing unless the footage or the destination is
unknowable. Defaults: vertical 9:16 for Reels, TikTok and Shorts; 16:9 for
YouTube and web; 12-20 seconds.

## 2. Project and frame

`open_project_file` with a new `.zvn` path, then set the frame before
importing (`set_project_setting_tool`: 1080×1920 for 9:16, 1080×1080 for
1:1, 1920×1080 for 16:9; 30 fps unless the footage is 24/25/60).

## 3. Footage and music, in story order

- The person's files: `import_files_tool` (paths, folders, globs). Keep
  their order; the last file closes the reel, so put the payoff (the goal,
  the reveal, the product) last.
- Stock: the cloud connector's `create_reel` searches stock for you.
  Otherwise `search_pexels_videos_tool` (one search per beat of the story,
  e.g. "barista pouring espresso close up") gives video ids and MP4 links
  sized for the frame; add each with `import_stock_media_tool`
  (`source: "pexels"`, `video_id`, `link`). Pexels footage is free to use;
  say where it came from.
- One music track: an audio file in the bin (`search_freesound_music_tool`
  with `min_seconds` a little over the reel's length, then
  `import_stock_media_tool` with `source: "freesound"`, `sound_id`,
  `preview_url`). `build_reel_tool` finds its tempo and starts it on a
  downbeat of its loudest stretch. Prefer music with a clear beat and an
  open licence (CC0, then CC BY); credit CC BY artists, and avoid
  non-commercial tracks for anything that earns money.
- Motion graphics: the motion-led styles below (and `add_motion_template_tool`)
  draw UI cards, typing search bars, kinetic type, product callouts and step
  cards on the beat inside Zenvi. For anything else (charts, 3D, bespoke
  animation) use HyperFrames or Remotion (the `code-video-handoff` skill):
  render it and import it like footage, or place it on a top track after the cut.

## 4. Cut it

```json
build_reel_tool {
  "style": "hype",
  "file_ids": ["<in story order>"],
  "music_file_id": "<the song>",
  "duration_seconds": 15,
  "hook": "Morning ritual",
  "end_card": "Brew better",
  "end_card_subtitle": "Open daily from 7am"
}
```

| style | suits | pace |
| --- | --- | --- |
| `hype` | launches, sport, travel, events | cuts on every beat, 1/2-beat bursts in the last third, a flash every few seconds |
| `cinematic` | stories, brands, places | 2-beat holds tightening to 1, push-ins, grain, fades in and out |
| `highlight` | the person's own clips of a game, trip or event | builds into the payoff (the last file), a little real sound under the music |
| `match_cut` | footage that shares a shape or pose (circles, hands, horizons) | one hard cut per beat, no camera moves so the shapes line up |
| `minimal` | wellness, food, interiors, products | 4-beat holds, gentle moves, soft fades, light type |
| `editorial` | fashion, design, tech | crisp cuts on 1/2 beats, a label on each shot (`labels`) |
| `retro` | vlogs, throwbacks, music | tape and super 8 texture, warm colour |

Words: the hook is 2-6 concrete words that make someone stay ("Morning
ritual", not "Welcome to our video"); the end card is a call to action, a
name or a date. Labels (editorial) are one or two words per shot.

### Motion-led styles: when the graphics carry the video

Pick one of these when the ask is an app or product promo, a design-y
brand piece, a product reveal or a how-to, i.e. when the picture should be
mostly graphics laid out and animated on the beat with the footage inside
them, rather than a montage of shots. The same `build_reel_tool` call, the
same music handling; scenes change on the bar and every entrance lands on a
beat.

| style | suits | what it builds | give it |
| --- | --- | --- | --- |
| `ui_promo` | apps, tools, SaaS, launches | a search bar types the hook and its suggestions drop open, the footage rises in rounded UI cards and a pointer clicks one, a word list scrolls in a selection box, a logo end card | `hook` (the search phrase), `labels` (card captions, also the suggestions), `words` (3-6 words for the list), `end_card` (the brand) |
| `editorial_motion` | fashion, design, food, objects | the hook as big grotesk type on a gridded sheet with a letter swapped for an image tile, labelled crop boxes over the first shot that lift into a row (a column of big tiles on 9:16), kinetic words, a closing card | `hook`, `words` (a short phrase), `labels` (crop names), `end_card` |
| `product_callout` | one or two products | each product shot on a dark field with a glow, an ANATOMY: NAME heading, leader lines drawing out to its features, labelled details | `hook` (the product name), `words` as features `"Name: value"` (2-4 per product) |
| `tutorial` | how-tos, tips, before/after (9:16) | the hook on grid paper, one step per clip (the footage in a bordered card, a numbered caption, a label box with an arrow), ending on "Save this" | `hook`, `labels` (one caption per step), `words` (one label per step), `end_card_subtitle` |

On 9:16 every motion style is composed for the vertical frame (groups
centred above the caption band, product and step footage in tall frames,
captions on the lower third) and keeps every word at a size that reads on
a phone, clear of the apps' top bar, caption band and side buttons; 16:9
keeps the wide layouts.

The footage still matters: three clear clips for `ui_promo`, one striking
close shot first for `editorial_motion` (its crops are cut from it), clean
product shots on plain backgrounds for `product_callout`, one clip per step
for `tutorial`. Use original or invented names in the copy, never a real
brand you were not asked to use.

To add a single piece of motion design to an existing edit (a search that
types, cards, a callout, kinetic type, a step card, an end card, a grid
background), use `add_motion_template_tool`: it places one template on the
lowest free tracks above the video, in one undo step, timed to the music on
the timeline (or `beats` / `bpm`).

The receipt has `data.brief`, `data.beats` (the timeline's beat grid: put
anything else that should land on the beat there) and `data.shots`.

For a match-cut reel prefer `match_cut_montage_tool` over the `match_cut`
style: it cuts 3-8 frame shots on the music's hits and aligns the shared
subject (`subjects` boxes, or circles found by `detect_subject_tool`) so it
sits at the same place and size on every cut.

### 4b. Move the cuts (optional, after the cut is final)

`apply_motion_transitions_tool` `track: "1"`, `style: "hype"` (whips and a
crash zoom) or `"cinematic"` (slides, blur dissolves, a zoom-through at the
end) puts velocity on the cuts; one direction per reel. Re-cutting later
means `remove_motion_transition_tool` on the track first.

### 4c. Sound design (last, when the picture is locked)

`auto_sound_design_tool` with the receipt's `beats` (`intensity`: `subtle`
for minimal and cinematic, `normal`, `hype` for hype and match-cut reels)
puts whooshes on cuts and transitions, hits on downbeats and flashes, clicks
on title entrances and a riser into the climax. In professional reels a cut
lands on a sound far more often than on the beat: this step is most of the
"snap". Add single effects with `add_sfx_tool` (`list_sfx_tool` lists them).

## 5. Look before you call it done

`preview_frame` at: 0.5 s (the hook reads, nothing is cut off), a cut in the
middle and one in the climax (no black frame, no letterbox bars), the
payoff, and the last frame (end card centred, music fading). Text stays in
the centre 80 % of the width; on 9:16 keep it out of the bottom fifth,
where the apps put their buttons. Fix with the edit tools (or `undo_tool`
and build again with other arguments), then look again.

## 6. Render and hand off

Before rendering: `unify_grade_tool` if the shots come from different
sources (it matches exposure and white balance across the cut; pass a LUT
as `look` to keep one look on top), then `master_audio_tool` (`preset:
"social"`) as the last audio step. `render_video` (mp4, the project's size),
then `review_render_tool` on the file: fix every `PROBLEM` line (an end on
black, clipping, a shot repeated within 3 s) and render again. Then offer
`launch_editor` (the
desktop app) or `push_to_cloud` (a zenvi.pro link) so the person can tweak
it, and list the music and footage credits.
