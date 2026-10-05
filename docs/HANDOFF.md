# Handoffs: Zenvi, Remotion, HyperFrames, After Effects, Premiere Pro

An edit can leave Zenvi for the tool that suits the next step and come back:
code video with Remotion or HyperFrames, motion design in After Effects,
finishing in Premiere Pro. This page covers every direction, what survives
each one, and **linked clips**, the renders that keep a live link to their
source.

- [How handoffs are built](#how-handoffs-are-built)
- [What you need](#what-you-need)
- [Directions](#directions): [Zenvi → Remotion](#zenvi--remotion) ·
  [Remotion → Zenvi](#remotion--zenvi) · [Zenvi → HyperFrames](#zenvi--hyperframes) ·
  [HyperFrames → Zenvi](#hyperframes--zenvi) · [Zenvi → After Effects](#zenvi--after-effects) ·
  [After Effects → Zenvi](#after-effects--zenvi) · [Zenvi → Premiere Pro](#zenvi--premiere-pro) ·
  [Premiere Pro → Zenvi](#premiere-pro--zenvi)
- [What survives](#what-survives)
- [Linked clips](#linked-clips)
- [From an agent](#from-an-agent)

## How handoffs are built

- **One implementation per conversion, in the Zenvi desktop app**
  (zenvi-core): the After Effects script writer, the Premiere XML writer and
  reader, the Remotion and HyperFrames exporters and importers, and the
  linked-clip machinery. The same code serves the desktop's menus (File >
  Export Project / Import Project / Send To), the Zenvi Assistant and
  `zenvi mcp`.
- **Everything inside After Effects and Premiere Pro is Zenvi Link**
  ([ADOBE.md](ADOBE.md)): running the generated script, importing the XML,
  rendering a comp, exporting a sequence.
- **`zenvi mcp` orchestrates**: it lists the desktop's handoff tools with
  the desktop's own schemas and runs them in the desktop app, opening the
  app on the session's project first when needed, and chains Adobe and
  desktop tools for the way back (`bring_from_after_effects`,
  `bring_from_premiere`).

The tools listed here are the desktop app's own (zenvi-core's handoff
release; `zenvi mcp` lists them with the desktop's schemas). With an older
desktop build, `zenvi mcp` answers "The Zenvi desktop app running here has
no `<tool>` yet: update Zenvi".

## What you need

| Direction | Needs |
| --- | --- |
| any handoff | the Zenvi desktop app, a saved project (`.zvn`) |
| Remotion | Node.js (Zenvi finds it on PATH, Homebrew, nvm, Volta, fnm, or `ZENVI_NODE`) and the project's own dependencies installed (`npm install`) |
| HyperFrames | Node.js 22+ for renders; the HyperFrames CLI the project uses |
| After Effects, Premiere Pro (sending, or bringing back) | the app running with Zenvi Link ([ADOBE.md](ADOBE.md#install)) |
| export to an After Effects script or Premiere XML file | nothing else (the files are opened in the app by hand) |

Zenvi never bundles Remotion (source-available, company licence above three
people) or GSAP: it runs the copies your project installs, and exported
projects depend on them the same way.

**Trust.** Listing a Remotion project's compositions, importing it, and
importing a HyperFrames project that needs renders **run that project's
code** (its own bundler and renderer, in Node.js and headless Chrome).
Use them only on projects the person trusts. Without `node_modules`, the
Remotion listing shows only ids and code locations, and nothing runs.

## Directions

### Zenvi → Remotion

Desktop: File > Export Project > Remotion Project…  ·  Agent:
`export_to_remotion_tool {output_dir, copy_media, install, replace_edits}`

A Remotion project (Remotion 4.0.532 pinned) you can open with
`npx remotion studio`:
`src/Root.tsx` with the composition `ZenviTimeline` (a zod schema, so props
are editable in Studio), `src/zenvi/timeline.json` (the readable timeline:
tracks, clips with media and timing, keyframes as `{frame, value, easing}`
with `linear`, `hold` or `[x1, y1, x2, y2]`, titles, transitions; header
`{"zenvi_timeline": 1, …}`), a generic renderer built from Remotion
primitives (`<Sequence>`, `<OffthreadVideo>`, `<Img>`, `<Audio>`,
`interpolate` + `Easing.bezier`), `public/zenvi-media/` (with
`copy_media`; symlinks otherwise), and a README (studio, render, the way
back, the licence note). Wipes play as fades; simple effects become CSS
filters, the rest are listed in the README. Exporting into an earlier export
updates it in place (keeping `node_modules`), and refuses when that would
discard changes made there, unless `replace_edits` (only when the person
agreed to lose them; otherwise import that folder first or pick another).

### Remotion → Zenvi

Desktop: File > Import Project > Remotion Project…  ·  Agent:
`list_remotion_compositions_tool {project_dir}`, then
`import_remotion_project_tool {project_dir, compositions, props, codec, position, track}`

- Each composition is rendered by the project's own Remotion (bundle +
  render, which runs the project's code) and lands as a **linked clip**:
  change its props, re-render after code edits, open the code at the
  component's line or Remotion Studio.
- The clips land together at `position` (default: the playhead) on free
  tracks above the video, transparent ones on top; `track` applies when
  importing one composition.
- `codec: "auto"` renders one still first: ProRes 4444 when any pixel is
  transparent (titles and overlays keep their alpha), else H.264.
- A project Zenvi generated (it has `src/zenvi/timeline.json`) comes back as
  **native** Zenvi clips (`restore_native`, the default): lossless. Its other
  compositions come back linked.
- All clips of one import are one undo step.

### Zenvi → HyperFrames

Desktop: File > Export Project > HyperFrames Project…  ·  Agent:
`export_to_hyperframes_tool {output_dir, copy_media}`

An `index.html` composition that `npx hyperframes preview|lint|render`
accept: `<video>`, `<img>`, `<audio>` primitives with `data-start`,
`data-duration`, `data-track-index`, `data-media-start` and
`data-zenvi-clip-id`, CSS placement from Zenvi's own geometry, a GSAP
timeline whose eases match Zenvi frame for frame, opacity transitions,
constant speed (`data-playback-rate`), audio levels, titles as `<img>` of
the title SVG, and the Zenvi project embedded
(`<script type="application/json" id="zenvi-timeline">`) so the way back is
lossless. Effects, rounded corners, blend modes, reversed or ramped speed
and wipe transitions do not translate; the receipt and README.md list each
one. When the HyperFrames CLI is available, the result is linted and the
findings come back in the receipt. An earlier Zenvi export in `output_dir`
is updated in place.

### HyperFrames → Zenvi

Desktop: File > Import Project > HyperFrames Project…  ·  Agent:
`import_hyperframes_project_tool {project_dir, mode, position, track}`

Zenvi reads HyperFrames' own resolved timeline (`hyperframes timeline
--json`), then:

- `mode: "native"`: `<video>`, `<img>` and `<audio>` primitives become
  native, editable clips on tracks from `data-track-index` (CSS position
  and size; GSAP opacity, x, y, scale and rotation tweens as keyframes;
  `data-volume` and fades as volume keyframes). Each nested composition
  becomes a linked clip rendered on its own with transparency, and titles
  or other scripted parts of the root become one linked graphics layer.
- `mode: "auto"` (default): `native`, except that the whole project becomes
  one linked clip when the root has no media clips or a clip has animation
  Zenvi cannot rebuild exactly.
- `mode: "flatten"`: the whole project as one linked clip.
- A project Zenvi exported always comes back natively and losslessly (with
  timing edits made in HyperFrames applied), unless `mode` is `flatten`.
- `position` is where the project's 0 lands (default: the playhead);
  `track` is the first track to use (the others go above it).
- One undo step. Renders need Node.js 22+.

### Zenvi → After Effects

Desktop: File > Export Project > After Effects Script (.jsx)… or File > Send
To > After Effects  ·  Agent: `export_to_after_effects_tool {output_dir,
collect_media, open_folder}` or `send_to_after_effects_tool {collect_media}`

Zenvi writes an ExtendScript file (`// Zenvi → After Effects export v1`,
ES3, one undo group) that rebuilds the timeline as one comp, with the
project's size and frame rate, in a folder `Zenvi - <project>`: footage
imported once (a placeholder for a missing file), layers in track order, timing
(in/out, start, stretch for constant speed, time remapping for reverse /
freeze / variable speed), transforms with eased keyframes (Zenvi's bezier
handles become After Effects temporal ease), opacity, audio levels in dB,
titles as editable text layers for simple templates (images otherwise),
mapped effects (blur, brightness/contrast, saturation, hue, invert, mosaic,
sharpen, chroma key, crop, colour grade), fade and wipe transitions, and
markers. The export writes `<project>.jsx`, `README.txt` (with both ways to
run it, and the warnings), `titles/`, `masks/` and, with `collect_media`,
`media/` into `output_dir` (default `<project name>_AfterEffects` next to
the saved project). **Send To** writes the same script into the project's
assets folder and runs it in the connected After Effects through
`ae_run_jsx_file`, which is one undo step there ("Zenvi: Run JSX file"), and
returns the comp's name and id. Anything without an equivalent is listed in
the warnings.

### After Effects → Zenvi

Panel: Zenvi Link > Send to Zenvi (with the Zenvi desktop app open on the
project)  ·  Agent: `bring_from_after_effects {comp, alpha, position, track}`

`ae_render_for_zenvi` renders the comp (default: the active comp) in After
Effects (ProRes 4444 with alpha when `alpha` is true, else H.264), then the
desktop's `import_linked_media_tool` adds it to the Zenvi project as a
linked clip of kind `aftereffects` (the comp, its id and the `.aep` are
remembered). After you change the comp: `rerender_linked_clip_tool`, which
renders it again through Zenvi Link. Save the After Effects project first:
an unsaved one cannot be re-rendered later.

### Zenvi → Premiere Pro

Desktop: File > Export Project > Premiere Pro (.xml)… or File > Send To >
Premiere Pro  ·  Agent: `export_to_premiere_tool {output_path, collect_media,
overwrite}` or `send_to_premiere_tool`

Final Cut Pro 7 XML (xmeml v4) tuned for Premiere's importer: clips keep
their trims, speed and reverse, motion (position, scale, rotation, anchor),
opacity and volume keyframes (eased curves become extra linear keys so they
look the same), crossfades and fades become Cross Dissolves, markers keep
their names and colours, track names and locks carry over, and titles are
rendered to transparent PNG stills in `<xml name>_media/titles/`. The
default output is `<name> (Premiere).xml` next to the project; `overwrite`
allows replacing an existing file. **Send To** writes it into the project's
assets folder and imports it into the connected Premiere's "Zenvi Imports"
bin through `premiere_import_xml`, opening the new sequence.

### Premiere Pro → Zenvi

Panel: Zenvi Link > Send to Zenvi (with the Zenvi desktop app open on the
project)  ·  Agent: `bring_from_premiere {sequence, placement}`

`premiere_export_xml` writes the sequence (default: the active one) as FCP7
XML, then the desktop's `import_timeline_xml_tool` brings it into the
project as native clips, as one undo step: timing, trims, speed and
reverse, motion, opacity and volume keyframes come along; disabled clips
come in hidden or muted; Cross Dissolves become fades and audio cross fades
volume ramps; markers keep names and colours; nested sequences are
flattened onto extra tracks. `placement`: `new_tracks` (default) or
`at_playhead`. Media that cannot be found is skipped and listed
(`missing_media`); generators, titles made in Premiere and effects Zenvi
lacks are listed in the warnings.

## What survives

| | After Effects (script) | Premiere Pro (XML) | Remotion | HyperFrames |
| --- | --- | --- | --- | --- |
| Clips, trims, tracks, order | yes | yes | yes | yes |
| Transforms (position, scale, rotation, anchor) | yes, keyframed | Basic Motion, keyframed | yes (CSS) | yes (CSS + GSAP) |
| Easing | bezier → temporal ease | extra linear keys that follow the curve | `Easing.bezier` | GSAP eases matching frame for frame |
| Opacity, fades | yes | yes | yes | yes |
| Audio levels | dB, keyframed | Audio Levels | `volume` | `data-volume`, fades |
| Transitions | fades and wipes | Cross Dissolve | fades; wipes play as fades | opacity transitions; wipes do not translate |
| Titles | editable text layers (simple templates) or images | PNG stills | SVG as `<Img>` | SVG as `<img>` |
| Effects | the mapped set; others as warnings | warnings | simple CSS filters; others listed | listed |
| Speed | stretch / time remap | constant, reverse | `playbackRate` | constant (`data-playback-rate`); reverse and ramps do not translate |
| Markers | comp markers | sequence markers | in timeline.json | in the embedded JSON |
| Back into Zenvi | the comp as a linked clip | native clips (nested sequences flattened) | native (lossless) | native (lossless) |

Every direction reports what it could not carry over in its `warnings`; read
them to the person.

## Linked clips

A linked clip is an ordinary project file whose `path` is the rendered
movie, with a `zenvi_link` record on the file (every clip of the file shares
it):

```json
"zenvi_link": {
  "version": 1,
  "kind": "remotion",
  "source": {"project_dir": "/abs/my-video", "entry": "src/index.ts", "composition": "Intro",
             "composition_key": null, "file": "src/Intro.tsx", "line": 12, "aep": null},
  "props": {"title": "Hello"},
  "render": {"codec": "prores4444", "width": 1920, "height": 1080, "fps": {"num": 30, "den": 1},
             "duration_frames": 150, "output": "@assets/links/remotion/Intro-3f9a1c2b.mov",
             "rendered_at": "2026-10-04T21:00:00Z", "fingerprint": "sha256:..."},
  "state": "fresh",
  "error": null
}
```

- `kind`: `remotion`, `hyperframes` or `aftereffects`. Unknown keys survive
  saving in the desktop app and in `@zenvi/engine`.
- **States**: `fresh` (rendered from the current source), `stale` (the
  sources, props or render settings changed), `rendering`, `error` (the last
  render failed; nothing changed), `missing_source` (the folder or `.aep`
  is gone). The desktop re-checks when it becomes the active app and every
  30 s, and offers **Re-render** for changed clips.
- **Tools**: `get_linked_clip_tool` (state, props, editable props, clips),
  `update_linked_clip_tool {props}` (merge props and re-render),
  `rerender_linked_clip_tool`, `open_linked_source_tool {target: code |
  studio}` (the file at its line in Cursor / VS Code / the system editor, or
  Remotion Studio / HyperFrames preview / After Effects),
  `unlink_clip_tool` (keep the media, drop the link).
- **Undo**: adding a linked clip, re-rendering (the media swap of every clip
  of the file), changing props and unlinking are one undo step each. A
  failed or cancelled render changes nothing.
- **Renders** live in `<project>_assets/links/<kind>/`; an unsaved
  project's renders move there on its first save.
- **Alpha**: never WebM. Zenvi's decoder drops VP9 alpha, so linked renders
  are ProRes 4444 when anything is transparent, else H.264; a WebM from
  another tool is converted to ProRes 4444 first.

## From an agent

Through `zenvi mcp` (Claude Code, Codex, Cursor):

1. `open_project_file` — handoffs need a saved project; an untitled session
   is refused with that hint.
2. `list_hosts` — is the desktop running, are After Effects / Premiere
   connected?
3. Call the handoff tool. When the desktop app does not have the project
   open, `zenvi mcp` brings it up first (focuses it, loads the project into
   the running app with its `open_project_tool`, or starts it on the
   project), waits for it to show the project (up to 2 minutes), and adds a
   note to the receipt. If the app has unsaved changes in another project
   it refuses to switch; ask the person. Relative paths in `path`,
   `project_dir`, `output_dir` and `output_path` are resolved against the
   server's working folder (`~` is the home folder).
4. Look at the result where it landed: `preview_frame` in Zenvi,
   `ae_capture_frame`, `premiere_capture_frame`.

`bring_from_after_effects` and `bring_from_premiere` return one receipt for
both apps: the desktop's receipt (new clips, undo steps) with the Adobe
receipt under `data.after_effects` / `data.premiere` and both apps'
warnings. A failure in the Adobe step adds nothing to the Zenvi project.

With `ZENVI_MCP_ENGINE=portable` the server never uses the desktop app, so
handoff tools are refused.
