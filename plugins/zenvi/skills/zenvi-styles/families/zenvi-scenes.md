# zenvi-scenes: a film directed as one scene (the cinetic method in scene code)

The `cinetic-*` styles (launch film, teaser, feature loop, logo sting, UI walkthrough) and any motion-design
film with no footage are ONE scene (`create_scene_tool`): its frame grid drives picture, cues and sound.
No titles, blocks or 3D on top. Method after cinetic (MIT, (c) 2026 Leonxlnx; NOTICE). Worked examples
with their whole code: `scenes-launch-teaser`, `scenes-feature-loop`, `scenes-logo-sting` (get_technique_tool).

## The draft produce_video_tool made

With a cinetic style it renders a draft scene from the nearest example (teaser/launch: launch-teaser at
the asked length; loop/walkthrough: feature-loop; sting: logo-sting) with the request's name, and sounds
it. The draft's objects (an inbox, a calendar, a monogram) are another product's. Rewrite it:
`update_scene_tool {"scene_id": "<data.scene.scene_id>", "code": "<whole module>"}`, keeping the
example's grid, act structure and finish.

## Steps

1. Concept: write 3 one-line concepts, each with a story device, an object THIS product owns that
   travels through every act and becomes the mark (a build target, a bill's line item, a day of a
   streak). Pick the one that shows what it does that a simpler product would not and reads muted.
2. Brand from 3 words -> params: `paper`, `ink` (tinted), ONE `accent` with one meaning, font role
   (`sans` Inter, `mono`, `serif`, `display`), radius. The person's hex and face win (a face not bundled:
   nearest role, say so). No brand: no orange, purple, glow, glass, serif, particles.
3. ONE cue grid: `fps = 60`, `BEAT = 30` (120 BPM) or `36` (100 BPM); acts and cues on whole beats or
   16ths. Picture reads `api.cue/prog/since`, never its own numbers; each cue `kind` is a sound.
4. Acts: one branch per act (`if (t < api.cue("turn")) { ...; return; }`), a hard cut = cue with
   `cut: true`. The device is ONE helper every act calls. Per act: the device, at most one fragment
   (1-4 words, `reveal: {at, per: "word", stagger: 6, dur: 22, out}`, the next starts after it has left),
   one motion peak a bar, a slow `api.camera` + `api.layer(depth)` so nothing holds still over 1.2 s.
   Statements 80-112 px; product UI `api.ui.*` 26-34 px `ui: true`, its numbers true to the story.
   Eases: `out` arrive, `in-out` camera, `in` exit; one `api.spring` per landing, two a film.
   Lay out from `api.W/H/safe/portrait`. Sandbox: no Math.random (`api.rng`), Date, timers, imports, DOM,
   `toLocaleString`.
5. Sound: `render_scene_tool` makes cues picture events; `auto_sound_design_tool {"genre": "saas_ui",
   "intensity": "subtle"}` sounds each (a rerun replaces); one hit on the lockup, nothing on top; a muted
   loop gets none. `master_audio_tool {"preset": "social", "iterate": true}`.
6. Finish: `api.grain(0.03-0.06)`, `api.gradient` (dithered), no bloom; `motion_blur` 4 (8 fast teasers).
7. Review: fix every error of the check and each warning that is not a choice (its contact sheet shows
   the cue frames); export, `review_render_tool`, `watch_render_tool`, one fix pass with `edits`. Ship:
   every dimension 3+/5, sound and finish 5, mean 4.2+.
8. Deliver the asked file; a transparent sting: params `{"background": false}`, `placement: "over_video"`.

## Tool sequence

```json
produce_video_tool {"request": "<the brief, verbatim>", "style": "cinetic-teaser", "output": "film.mp4"}
get_technique_tool {"technique": "scenes-launch-teaser"}
update_scene_tool {"scene_id": "<id>", "code": "<the module rewritten for this product>"}
render_scene_tool {"scene_id": "<id>", "motion_blur": 4}
auto_sound_design_tool {"genre": "saas_ui", "intensity": "subtle"}
master_audio_tool {"preset": "social", "iterate": true}
export_video_tool {"output_path": "film.mp4"}
review_render_tool {"path": "film.mp4"}
watch_render_tool {"path": "film.mp4"}
```
