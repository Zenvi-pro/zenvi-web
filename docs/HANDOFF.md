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

Status (October 2026): the linked-clip tools (`import_linked_media_tool`,
`get_linked_clip_tool`, `update_linked_clip_tool`,
`rerender_linked_clip_tool`, `open_linked_source_tool`, `unlink_clip_tool`)
are in the desktop's handoff core; the per-app export and import tools are
landing next. Until a desktop build has a tool, `zenvi mcp` answers
"The Zenvi desktop app running here has no `<tool>` yet: update Zenvi".

## What you need

| Direction | Needs |
| --- | --- |
| any handoff | the Zenvi desktop app, a saved project (`.zvn`) |
| Remotion, HyperFrames | Node.js 18+ (Zenvi finds it on PATH, Homebrew, nvm, Volta, fnm, or `ZENVI_NODE`); the project's own dependencies installed (`npm install`) |
| After Effects, Premiere Pro (sending, or bringing back) | the app running with Zenvi Link ([ADOBE.md](ADOBE.md#install)) |
| export to an After Effects script or Premiere XML file | nothing else (the files are opened in the app by hand) |

Zenvi never bundles Remotion (source-available, company licence above three
people) or GSAP: it runs the copies your project installs, and exported
projects depend on them the same way.

## Directions

### Zenvi → Remotion

Desktop: File > Export Project > Remotion Project…  ·  Agent:
`export_to_remotion_tool {output_dir, copy_media, install}`

A Remotion project you can open with `npx remotion studio`:
`src/Root.tsx` with the composition `ZenviTimeline` (a zod schema, so props
are editable in Studio), `src/zenvi/timeline.json` (the readable timeline:
tracks, clips with media and timing, keyframes as `{frame, value, easing}`
with `linear`, `hold` or `[x1, y1, x2, y2]`, titles, transitions; header
`{"zenvi_timeline": 1, …}`), a generic renderer built from Remotion
primitives (`<Sequence>`, `<OffthreadVideo>`, `<Img>`, `<Audio>`,
`interpolate` + `Easing.bezier`), `public/zenvi-media/` (with
`copy_media`), and a README (studio, render, the way back, the licence
note). Effects without a CSS equivalent are listed in the README.

### Remotion → Zenvi

Desktop: File > Import Project > Remotion Project…  ·  Agent:
`list_remotion_compositions_tool {project_dir}`, then
`import_remotion_project_tool {project_dir, compositions, props, codec, position, track}`

- Each composition is rendered by the project's own Remotion (bundle +
  render) and lands as a **linked clip**: change its props, re-render after
  code edits, open the code at the component's line.
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
`data-zenvi-clip-id`, CSS for the layout, a GSAP timeline for keyframes and
transitions, titles as `<img>` of the title SVG, and an embedded
`<script type="application/json" id="zenvi-timeline">` so the way back is
lossless.

### HyperFrames → Zenvi

Desktop: File > Import Project > HyperFrames Project…  ·  Agent:
`import_hyperframes_project_tool {project_dir, mode, position, track}`

- `mode: "auto"` (default): primitives become native, fully editable clips
  on tracks from `data-track-index` (simple GSAP tweens become keyframes);
  compositions driven by scripts become linked clips rendered by the
  project's HyperFrames CLI (ProRes 4444).
- `native` imports the primitives only; `flatten` renders the whole
  project as one linked clip.
- A project Zenvi exported restores from its embedded timeline JSON.
- One undo step.

### Zenvi → After Effects

Desktop: File > Export Project > After Effects Script (.jsx)… or File > Send
To > After Effects  ·  Agent: `export_to_after_effects_tool {output_dir,
collect_media, open_folder}` or `send_to_after_effects_tool {collect_media}`

Zenvi writes an ExtendScript file (`// Zenvi → After Effects export v1`,
ES3, one undo group) that rebuilds the timeline as one comp in a folder
`Zenvi — <project>`: footage imported once, layers in track order, timing
(in/out, start, stretch for constant speed, time remapping for reverse /
freeze / variable speed), transforms with eased keyframes (Zenvi's bezier
handles become After Effects temporal ease), opacity, audio levels in dB,
titles as editable text layers where the template allows (otherwise a
transparent still), mapped effects (Gaussian Blur, Brightness & Contrast,
Hue/Saturation, Invert, Mosaic, Sharpen, Keylight / Color Key, crop masks,
Lumetri), transitions (fades as opacity, wipes as Gradient Wipe with the
mask), and markers. **Send To** runs it in the connected After Effects
through `ae_run_jsx_file`; the export alone writes `<name>.jsx`, `media/`
and a README with both ways to run it (File > Scripts > Run Script File).
Anything without an equivalent is listed in the warnings and in a layer
comment.

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
Premiere Pro  ·  Agent: `export_to_premiere_tool {output_path, collect_media}`
or `send_to_premiere_tool`

Final Cut Pro 7 XML (xmeml v4) tuned for Premiere's importer: `file://`
paths, correct timebase / NTSC flags, clips with trims, tracks (names,
enabled, locked), Basic Motion (center and scale in Premiere's units) and
Opacity keyframes, audio levels, Cross Dissolves, constant speed and
reverse, markers; titles as PNG stills next to the XML. **Send To** imports
it into the connected Premiere through `premiere_import_xml` and opens the
new sequence.

### Premiere Pro → Zenvi

Panel: Zenvi Link > Send to Zenvi (with the Zenvi desktop app open on the
project)  ·  Agent: `bring_from_premiere {sequence, placement}`

`premiere_export_xml` writes the sequence (default: the active one) as FCP7
XML, then the desktop's `import_timeline_xml_tool` brings it into the
project as native clips, as one undo step: Cross Dissolves become Zenvi
fades, constant speed becomes a time curve, opacity and motion keyframes,
markers and disabled clips come along. `placement`: `new_tracks` (default)
or `at_playhead`. Media missing on this machine is listed.

## What survives

| | After Effects (script) | Premiere Pro (XML) | Remotion | HyperFrames |
| --- | --- | --- | --- | --- |
| Clips, trims, tracks, order | yes | yes | yes | yes |
| Transforms (position, scale, rotation, anchor) | yes, keyframed | Basic Motion, keyframed | yes (CSS) | yes (CSS + GSAP) |
| Easing | bezier → temporal ease | bezier where Premiere allows | `Easing.bezier` | GSAP eases |
| Opacity, fades | yes | yes | yes | yes |
| Audio levels | dB, keyframed | Audio Levels | `volume` | `data-volume`, fades |
| Transitions | fade; wipes as Gradient Wipe | Cross Dissolve (other wipes → dissolve + warning) | fades; wipes approximated | fades |
| Titles | text layers or stills | PNG stills | SVG as `<Img>` | SVG as `<img>` |
| Effects | the mapped set; others as warnings | warnings | simple CSS filters; others listed | listed |
| Speed | stretch / time remap | constant, reverse | `playbackRate` | where supported |
| Markers | comp markers | sequence markers | in timeline.json | in the embedded JSON |
| Back into Zenvi | the comp as a linked clip | native clips | native (lossless) | native (lossless) |

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
