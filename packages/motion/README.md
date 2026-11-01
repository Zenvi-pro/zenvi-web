# @zenvi/motion — Zenvi Motion blocks

Parametric HTML motion graphics ("blocks") an agent fills in with a few
fields, rendered frame-exactly in headless Chrome to ProRes 4444 (with alpha)
or H.264, at any size. The engine's `list_motion_blocks_tool`,
`add_motion_block_tool` and `update_motion_block_tool` place them on the
timeline as linked media (`zenvi_link`, kind `zenvi-motion`).

```
src/runtime/   the page-side animation runtime (no GSAP): timeline, easings, text, effects, morphs, traced outlines, trails
src/blocks/    one folder per block: block.json + block.ts (+ block.css); base.css, ui.ts, art.ts shared
src/params.ts  block.json schema, shared token params, checking/coercion
src/tokens.ts  palettes, font roles, the bundled faces (fonts/, SIL OFL 1.1)
src/scene/     scenes: the contract, the page runtime and its kit, the layout audit; examples/launch.ts
src/node/      the renderer (puppeteer-core + chrome-headless-shell + ffmpeg), the scene lint and sandbox, the CLI's MotionHost
scripts/       render.ts (one block), review.ts (every block: MP4s, contact.png, timings.md), scene.ts (check/render a scene)
```

## Try it

```sh
npm run zenvi -- motion setup                 # once: chrome-headless-shell into Zenvi's cache
npm run zenvi -- motion list
npm run zenvi -- motion render prompt_bar -o /tmp/prompt.mov --size 1080x1920 prompt='Plan a trip to Lisbon'
npx tsx packages/motion/scripts/review.ts --out /tmp/motion-review --blocks prompt_bar
```

## How a frame is made

The page lays out at a design size whose shorter side is 1080 px (TASTE.md's
type scale), so block CSS uses plain px; the capture scales to the requested
size. The renderer calls `window.__zenvi.seek(t)` and screenshots, for every
frame, in a few tabs at once. `seek` is a pure function of `t`: every tween
is recomputed from the tween list, tracks (typing, counters, particles) read
only `t`, randomness is seeded (`random01(seed, …)`), media are pre-extracted
frames. The same page also answers HyperFrames' `window.__hf = { duration, seek }`.

## Adding a block

1. `src/blocks/<id>/block.json`: `id` (= folder), `version`, `title`,
   `description` (what it looks like and when to use it: agents read it),
   `tags`, `duration {default,min,max}`, `aspects`, `alpha` (true = meant to sit
   over video), optional `tokens` defaults, and `params`. Param types: `string`,
   `number`, `integer`, `boolean`, `color`, `enum`, `strings`, `points`, `media`
   (a Project Files id; the renderer serves a photo, or a video as frames).
   Never name a param `path`, `image`, `resource`, `protobuf_data_path` or
   `lut_path` (the desktop rewrites those keys on save). Every block also gets
   `palette`, `accent`, `paper`, `ink`, `display_font`, `radius`, `exit`, `seed`.
2. `src/blocks/<id>/block.ts`: `export function build(ctx: BlockContext)`.
   Build DOM with `ctx.el(...)` inside `ctx.root`, measure layout if you need
   (fonts are loaded), then schedule with `ctx.tl.fromTo/to/set/track`. Use the
   CSS vars (`--ink`, `--paper`, `--accent`, `--font-display`, `--radius`…),
   keep text inside `ctx.safe`, lay out for `ctx.portrait` and landscape. Fit the
   block to `ctx.seconds`; the root fades out over the last 0.4 s unless you set
   `ctx.ownExit`. Easings and timings: docs/TASTE.md (`out` for entrances,
   0.06 s word stagger, back-out ≤ 6 %). Report what the ear should hear with
   `ctx.cue(t, kind, { weight, at })` (a click, a toggle, a typing run, a card
   landing: the engine's `PictureEvent`), timed from the same variables as the
   tweens; the page lists them as `__zenvi.events` and the renderer caches
   them beside the render for the sound design.
3. Optional `block.css` (design px).
4. One import line in `src/catalog.ts`.
5. `npx vitest run --project motion` (blocks.test.ts builds every block in
   jsdom and checks determinism; params.test.ts checks the manifest), then look
   at it: `npx tsx packages/motion/scripts/review.ts --out /tmp/r --blocks <id>`.

Bump `version` when you change a block's look on purpose; any code change
already changes the render fingerprint (the bundle is hashed).

## Pictures without media

Blocks that show pictures (dot_grid_reveal, liquid_glass, masonry_grid,
dock_magnify, card_shuffle) take media params and, without them, draw their
own scenes with `blocks/art.ts` (seeded SVG landscapes, orbs, flowers, a
round character), rasterised once per build with `artImage` so Chrome does
not re-rasterise grain on every frame. Several pictures are numbered media
params (`media_1` … `media_8`); a board repeats the ones it is given.

## Scenes: a film written as code

A scene is a module an agent writes (create_scene_tool, or a file for
`zenvi motion scene`): `fps`, `duration` (frames) and `cues` on one grid,
`params`, `alpha`, and `draw(ctx, t, api)`, a pure function of the frame
drawn with Canvas 2D and the kit (`src/scene/kit.ts`: text with reveals,
app UI, shapes with draw-on, media frames, eases and springs, camera and
parallax layers, hit FX, dithered gradients, grain). The cues that name a
picture event kind are the scene's events, so the sound design hits them.

```sh
npm run zenvi -- motion scene packages/motion/src/scene/examples/launch.ts --sheet /tmp/sheet.jpg -o /tmp/launch.mp4 --motion-blur 4
```

Scene code is untrusted, so it runs only here, in layers:

1. The lint (`node/scene-lint.ts`): TypeScript stripped by esbuild, the
   module walked with real scopes (acorn). A name the scene does not declare
   must be a pure global (Math, Number, JSON, Path2D…); members that lead
   out (`constructor`, `__proto__`, `ownerDocument`, `ctx.canvas`) and
   `Math.random` are refused; no imports, async code, `with`, `import.meta`.
2. The page (`scene/page.ts`): before the scene's script runs, the runtime
   takes away the clock, randomness, timers, network APIs, the Function
   constructors and the canvas's way back to the document; the scene's body
   runs in a strict function whose parameters hide `window`, `document`,
   `globalThis` and friends.
3. The page's Content-Security-Policy: no eval, no connections, no workers,
   no frames, images and fonts only from the job's own server.
4. The browser: Chrome launched for the one job with a 512 MB heap, every
   non-loopback request sent to a proxy that does not exist and WebRTC kept
   off UDP; every request but the job's loopback server (the runtime, the
   scene, the fonts, the media passed in) is refused; every call into the
   page is timed out (2 s a frame) and the browser is killed after.

The check then draws every frame at half size (pixel hash, luma thumbnail,
text boxes, draw time), draws a sample again in another tab in reverse
order (frame t twice must be identical), measures flashes against WCAG
2.3.1 and audits the text (safe zone, overlap, 22/32 px minimum, 8 words to
read at once). Errors refuse the render; warnings come back to the agent
with the contact sheet. Zenvi Cloud runs the same code in its render worker.
