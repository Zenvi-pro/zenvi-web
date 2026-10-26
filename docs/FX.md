# Zenvi FX

Footage effects libopenshot 1.0 does not have, rendered with ffmpeg and
swapped onto the timeline as linked clips. Status: v1 (13 effects, CLI and
local MCP server).

## Effects

| id | what it does | default amount |
| --- | --- | ---: |
| `radial_blur` | zoom blur out from a centre (16 taps, four halving passes) | 0.5 |
| `directional_blur` | blur along one angle (`dblur`), for whips | 0.5 |
| `echo` | `echo`: the last frames fade over the current one (`tmix`); `trails`: bright parts streak and decay (`lagfun`) | 0.5 |
| `chromatic_aberration` | red scaled out from the lens centre, green half as much: fringes grow toward the edges | 0.5 |
| `bloom` | highlights above a threshold, blurred at two sizes at quarter resolution, screened back | 0.5 |
| `glitch` | seeded bursts: slices and blocks jump sideways (`displace` with a geq-drawn map), RGB splits | 0.5 |
| `pixel_sort` | approximate: bright pixels smeared one way, keyed by luma and striated per line. Not a true per-row sort | 0.5 |
| `halftone` | 45° dots sized by darkness, anti-aliased, ink on paper (geq) | 1 |
| `dither` | per-frame palette (2-32 colours), Bayer or Floyd-Steinberg, chunky pixels | 1 |
| `mirror` | horizontal, vertical, quad, or kaleidoscope wedges (a fixed fold drawn once, `remap`) | 1 |
| `optical_flow_slowmo` | slow down with motion-compensated frames (`minterpolate`) or blended frames (`framerate`); audio time-stretched | 0.33 (= 0.5× speed) |
| `vignette` | smooth radial darkening, softness and depth | 0.5 |
| `light_leak` | procedural light leaks (or a film burn) streaming in from one edge, seeded; no stock assets | 0.6 |

Every effect has `amount` 0-1, its own params (`list_fx_tool` returns them as
JSON Schema) and an optional `start`/`end` window in seconds of the clip.
Effects stack in order (at most 8 per clip). Slow motion always runs last,
over the whole clip, and makes the clip longer on the timeline.

## Tools

`list_fx_tool`, `apply_fx_tool {clip_id, effects}`, `update_fx_tool {clip_id,
index, amount | params | start | end | whole_clip | effects}`,
`remove_fx_tool {clip_id, index?}`. Each call is one undo step; the render
runs before the transaction, so a failed render changes nothing. Removing
every effect needs no render and works on every surface; the others need the
host's `fx` capability (the CLI and `zenvi mcp`; the web editor and Zenvi
Cloud refuse with "not available").

## How a render works

- The engine owns the contract: `src/fx/catalog.ts` (ids, params, parsing),
  `src/fx/graph.ts` (`buildFxGraph`: one deterministic `-filter_complex`,
  planar RGB, alpha kept, windows cut back in with `trim` + `concat`),
  `src/fx/link.ts` (the `zenvi_link` record), `src/ops/fx.ts` (the clip swap).
- `@zenvi/render-node` (`src/fx/render.ts`) probes the source, renders the
  clip's source range with `-ss`/`-t` to ProRes 422 HQ (4444 when the source
  has alpha) with PCM audio, and caches by fingerprint: sha256 of the source
  path, size and mtime, the range, the graph text and `FX_RENDERER_VERSION`.
  Bump that constant when a builder's output changes for the same input.
- Renders of a saved project go to `<project>_assets/links/zenvi-fx/`, an
  unsaved project's to the per-user cache (`~/Library/Caches/zenvi/fx` on
  macOS). Decoding uses VideoToolbox on macOS. `ZENVI_FX=0` turns Zenvi FX
  off, `ZENVI_FX_HWACCEL=0` turns off hardware decoding.
- Pixel sizes are tuned at 1080 lines and scale with the frame's short side.
- Clips with a speed change or time curve are refused: apply FX first, then
  retime the render.

## The link

The render is its own bin file. Its `zenvi_link` has `kind: "zenvi-fx"`,
`source.file_id` (the original file), `source.start` / `source.end` (the
source seconds rendered), `props.effects` (the parsed stack) and the usual
`render` block, so `remove_fx_tool` can restore the clip exactly and the
desktop can re-render once it registers a `zenvi-fx` provider (zenvi-core
`handoff/linked_media.py` refuses unknown kinds in `normalize_link` but
reads them with `read_link`).

## Timings

`npx tsx packages/render-node/scripts/fx-showcase.ts <out> [clip.mp4@start …]`
renders every effect over 2 s of each source and writes before/after strips,
a reel per source and `timings.md` (render seconds per second of 1080p).

## Not yet: timeline motion blur

Motion blur for keyframed moves (a title flying in, a whip done with
location keyframes) cannot be an FX render of a source: the blur depends on
the clip's transform over the frame interval, which only the compositor
knows. The design for a follow-up:

1. The frame planner gains `planFrameSamples(project, frame, n, shutter)`:
   n sub-frame plans at `frame + (k + 0.5) / n × shutter` (shutter 0-1 of a
   frame, default 0.5 = 180°), evaluated with the existing keyframe code.
2. The compositor composites only the layers whose transform changes across
   the interval at each sub-frame and averages them (n = 8 at draft, 16-32 at
   final; static layers are drawn once), in the Node CPU compositor and the
   browser's Canvas2D one.
3. A per-clip `zenvi_motion_blur {samples, shutter}` unknown key (desktop
   keeps it; libopenshot ignores it), set by a tool and by the motion
   presets; export renders honour it, previews use n = 4.

Cost scales with n for moving layers only, so a 0.4 s whip at 16 samples
adds well under a second of render per cut.
