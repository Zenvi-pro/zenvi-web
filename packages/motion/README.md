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
src/node/      the renderer (puppeteer-core + chrome-headless-shell + ffmpeg) and the CLI's MotionHost
scripts/       render.ts (one block), review.ts (every block: MP4s, contact.png, timings.md)
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
