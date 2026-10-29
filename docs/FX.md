# Zenvi FX

Footage effects libopenshot 1.0 does not have, rendered with ffmpeg and
swapped onto the timeline as linked clips. Status: v1 (16 effects, CLI and
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
| `crt` | old TV in one pass: scanlines, RGB phosphor stripes, barrel distortion, red/cyan split, glow, flicker, a rolling hum bar, optional rounded or 4:3 `tv` bezel | 0.6 |
| `print_ink` | screenprint / risograph: flat tone plates on paper, Sobel ink lines that bleed, a second line plate printed off register, paper grain and ink dropouts (seeded) | 0.85 |
| `datamosh_carry` | at a cut, the clip's first frames are pushed along the previous clip's motion (blocky tearing and smear, its last frame lingering), then land clean. Needs the clip before it: `datamosh_cut_tool` | 0.6 |

`amount` is how much of the effect there is: below 1 it mixes the effect over the
untouched picture (`mixed` in graph.ts; effects whose amount scales their own
strength, like bloom or glitch, use it inside the builder).

Every effect has `amount` 0-1, its own params (`list_fx_tool` returns them as
JSON Schema) and an optional `start`/`end` window in seconds of the clip.
Effects stack in order (at most 8 per clip). `datamosh_carry` works on the
first `length` seconds of the clip (the cut), so it takes no start/end window. Slow motion always runs last,
over the whole clip, and makes the clip longer on the timeline.

## Tools

`list_fx_tool`, `apply_fx_tool {clip_id, effects}`, `update_fx_tool {clip_id,
index, amount | params | start | end | whole_clip | effects}`,
`remove_fx_tool {clip_id, index?}`, `datamosh_cut_tool {clip_id, previous_clip_id?,
length?, amount?, ghost?, block?}`. Each call is one undo step; the render
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

## Datamosh carry

A real datamosh drops the I-frame at a cut so the next clip's motion vectors
push the last picture around. Zenvi gets the look without a bitstream:

1. `datamosh_cut_tool` finds the clip before the cut (the clip on the same
   track that ends where this one starts, or `previous_clip_id`) and stores the
   footage it carries in the effect: `params.carry {file_id, at}`, `at` being the
   source second the previous clip ends on. The effect is last in the stack; a
   second run replaces the first. Retrim or move the previous clip and run it
   again: the render does not follow it by itself.
2. The host (`render-node/src/fx/datamosh.ts`) decodes the last frames of that
   footage at 320 px wide and the engine (`fx/datamosh.ts`) measures their motion
   by block matching (`estimateFlow`: 8 px blocks, ±10 px search, sub-pixel
   refined, later frame pairs weigh more, flat blocks stay put, 3×3 median).
3. `moshMaps` turns that flow into one pair of ffmpeg `displace` maps per moshed
   frame, one pixel per macroblock: each frame's map is the last frame's pushed
   along the flow again (so blocks that disagree drag and smear), eased to
   nothing by the last frame so the clip lands clean. The maps and the previous
   clip's last frame go into the render as extra ffmpeg inputs; the graph pushes
   the clip's head with them, mixes in the pushed last frame (`ghost`, fading
   out squared) and concatenates the untouched rest.

The strongest results come from a previous clip that is moving fast (a whip, a
pan, a push-in); a still clip gives only the fading ghost. The fingerprint
includes the footage before the cut (path, size, mtime) and `at`.

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
