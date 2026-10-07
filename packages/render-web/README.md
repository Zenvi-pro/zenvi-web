# @zenvi/render-web

The browser media runtime for Zenvi: decode (Mediabunny over WebCodecs),
preview (Canvas2D + Web Audio) and export a Zenvi project, in the browser.

`@zenvi/engine` owns the semantics — which clips are visible, transforms,
keyframes, effect math, preview sizing — and hands out `FramePlan`s,
`AudioPlan`s and kernels. This package executes them: it never decides what a
frame should look like, only how to get the pixels and samples there fast.

## Quick start

```ts
import { MediaRegistry, PreviewPlayer, probeMedia, exportProject, generateThumbnails, generateWaveform } from "@zenvi/render-web";

// 1. Tell the registry where each project file's bytes are.
const media = new MediaRegistry({
  resolvePath: (path) => (path.startsWith("@transitions/") ? { kind: "url", url: assetUrl(path) } : undefined),
});
media.register(file.id, { kind: "opfs", handle });                       // or { kind: "blob", blob }
media.register(cloudFile.id, { kind: "url", url: signedUrl, refresh: () => api.mediaUrl(cloudFile.id) });

// 2. Probe a new import: the same ReaderInfo the desktop writes for a file.
const info = await probeMedia({ kind: "blob", blob: picked }, { path: picked.name });

// 3. Preview on a canvas (CSS-sized; the player renders at device pixels).
const player = new PreviewPlayer(canvas, { media });
player.setProject(doc.project);                 // after every edit
player.onTime((t) => setPlayhead(t));
await player.seek(12.5);                        // renders that frame; rapid seeks coalesce
player.play();                                  // call from a click: it starts the AudioContext

// 4. Export (H.264/AAC MP4 when the browser can encode it, else VP9/Opus WebM).
const controller = new AbortController();
const blob = await exportProject(doc.project, media, { format: "mp4", width: 1920, height: 1080, fps: { num: 30, den: 1 }, quality: "high" },
  { signal: controller.signal, onProgress: (p) => setProgress(p.fraction) });

// 5. Timeline helpers.
const filmstrip = await generateThumbnails(media, file.id, { count: 12, height: 48 });   // ImageBitmap[] (close them)
const peaks = await generateWaveform(media, file.id, { buckets: 800 });                  // Float32Array, 0..1
```

## Media

### `MediaRegistry`

| Method | |
| --- | --- |
| `new MediaRegistry({ resolvePath?, idleMs? })` | `resolvePath(path)` maps media referenced by path only (transition masks `@transitions/…`, generated titles) to a source. Inputs unused for `idleMs` (30 s) are closed. |
| `register(fileId, spec)` | Where `project.files[fileId]`'s bytes are. Re-registering different bytes invalidates every cache of that file. |
| `unregister(fileId)`, `invalidate({ fileId })` | Forget a file, or say its bytes changed in place (an edited title SVG). |
| `probe(ref, options?)` | `probeMedia` for registered media, cached per file version. |
| `acquire(ref) → { media, release }` | The shared Mediabunny `Input` plus stream facts (codec, sizes, rotation, frame duration, `timeOffset`). Lower-level; the player and export use it. |
| `blob(ref)`, `text(ref)`, `keyOf(ref)`, `kindOf(ref)`, `onInvalidate(fn)`, `dispose()` | |

A `MediaRef` is `{ fileId?, path? }`; a file id wins over a path.

`MediaSourceSpec`:

- `{ kind: "blob", blob, name? }` — a `File`/`Blob` in memory.
- `{ kind: "opfs", handle, name? }` — an origin private file system `FileSystemFileHandle`, read
  lazily. Pass the original file `name` when the entry is stored under an id: images, SVGs and
  audio files are classified by the project path's extension, or by this name when the path has none.
- `{ kind: "url", url, refresh?, requestInit?, name? }` — HTTP(S), read with range requests. When the
  server answers 401/403 (an expired signature) `refresh()` is called once for a new URL and the
  request retried; every later reader of that media uses the renewed URL.

### `probeMedia(spec, { path?, audioOnlySize? }) → ReaderInfo`

The fields the desktop writes for a `project.files[]` entry: `type: "FFmpegReader"` for audio/video
and `"QtImageReader"` for stills and SVG, `fps` as a fraction (`30000/1001`), `video_length` in
frames (`llround(duration·fps)`), `duration` as libopenshot's float, `width/height` after rotation,
`display_ratio`, `pixel_ratio`, timebases, `vcodec`/`acodec` as FFmpeg decoder names (`h264`,
`mp3float`), `channels`, `channel_layout`, `sample_rate`, bitrates, `metadata` (incl. `rotate`),
`media_type`. Checked field by field against `openshot.FFmpegReader(path).Json()` on generated
media (`src/media/probe.parity.node.test.ts`). Known differences: MP3 duration includes encoder
padding (FFmpeg reads the LAME gapless header: one frame shorter), Ogg/Opus bitrate (FFmpeg's
format duration counts pre-skip), fewer metadata tags, GIF is read as a still (first frame).
SVG sizes follow QtSvg (90 DPI, `pt`/`pc` unconverted, viewBox fallback).

Nothing is decoded to probe; Mediabunny demuxes in Node too.

## Preview: `PreviewPlayer`

```ts
new PreviewPlayer(canvas: HTMLCanvasElement | OffscreenCanvas, {
  media, engine?, audioContext?, resolution? /* 0.1..1 of device pixels */, letterbox? /* CSS color | "transparent" */,
  frameCacheBytes?, stills?,
})
```

| | |
| --- | --- |
| `setProject(project)` | Show this project (call after every edit; keeps the playhead, restarts sound if playing). |
| `seek(seconds, { scrub? }) → Promise` | Render that frame. Resolves when it, or a later request, is on screen. Requests made while a frame decodes replace each other: only the latest renders. Pass `scrub: true` while the playhead is dragged: when the exact picture would take a GOP to decode, the keyframe before it shows at once and the exact frame replaces it unless the playhead moved on. |
| `play()`, `pause()`, `toggle()`, `stepFrames(n)` | Pause rests on the start of the frame on screen, so an edit at the playhead cuts exactly there. |
| `rate`, `loop`, `volume`, `muted` | Negative rates play backwards, silently. |
| `time`, `frame`, `duration`, `isPlaying`, `state`, `droppedFrames` | `duration` is where the last clip ends (playback stops or loops there). |
| `onTime(fn)`, `onState(fn)`, `onError(fn)` | Each returns an unsubscribe function. Errors (undecodable codec, effect failure, audio that cannot start) are reported once each; the frame still renders without the failed part. |
| `dispose()` | |

- **Clock.** With audio, the AudioContext is the master clock (`getOutputTimestamp`, so output
  latency is accounted for); video shows the frame for what is being heard and drops frames rather
  than drifting. Without audio, `performance.now()`. If the output device never starts (no user
  gesture, a dead device) playback continues silently after 2 s and `onError` says so.
- **Size.** The canvas is sized to its CSS box in device pixels (ResizeObserver). Frames are planned
  with `planFrame(project, frame, box, { preview: true })`: the engine fits the project into the box
  like `Timeline::SetMaxSize` (never larger than the project); the player centers and letterboxes it.
- **Decoding.** Each clip has its own decode cursor: playback walks one Mediabunny `samples()`
  iterator forward without re-seeking; scrubbing reuses the cursor before the next keyframe and
  re-seeks otherwise. Decoded pictures are converted to bitmaps at their draw size right away (the
  decoder's frame pool is never starved) and shared through a byte-budgeted LRU, so revisiting a
  frame or re-rendering after a property edit is instant. Every `VideoFrame` is closed exactly once.
- **Frame accuracy.** A plan asks for source frame k as `(k−1)/fps`; the picture shown is the one
  libopenshot numbers k (`round((pts − first_pts)·fps) + 1`), via a half-frame tolerance that absorbs
  timestamp jitter (millisecond WebM timebases, 1/90000 MPEG timestamps). Past the end the last
  picture freezes, like FrameMapper.

## Export

```ts
exportProject(project, media, options: ExportOptions, { onProgress?, signal?, engine?, onNotes?, onLayerError? }) → Promise<Blob>
exportProjectTo(writable, project, media, options, run?) → Promise<{ mimeType, bytes, notes }>   // streams to disk
exportFrame(project, media, seconds, { width, height }, "image/png" | "image/jpeg" | "image/webp", { quality? }) → Promise<Blob>
```

`exportProject` assembles the file in memory. For long exports use `exportProjectTo` with an OPFS
writable (`await fileHandle.createWritable()`): positioned chunks are written as they are muxed,
the stream is closed when the file is complete, and aborted on failure or cancel (OPFS then
discards the partial file).

- Every frame of the range (`options.range`, default the whole timeline) is planned at the output
  size, drawn by the same compositor as the preview into an `OffscreenCanvas` and encoded through a
  Mediabunny `CanvasSource`; audio is mixed in 10 s windows by an `OfflineAudioContext` with the
  preview's voices and added through an `AudioBufferSource`, interleaved with the video.
- Formats: `mp4` (H.264 + AAC, else Opus), `webm` (VP9/VP8/AV1 + Opus), `mov`, `mkv`, `wav`. When MP4
  cannot get H.264 — or no MP4 audio codec can be encoded — the export becomes WebM. Sound is never
  dropped silently: when no audio codec at all can be encoded the export fails with `ExportError`
  code `no-audio-encoder`, unless `allowVideoOnly: true` (ask the person first, or offer a cloud
  render). A project with `channels: 0`, or a range where nothing is audible, has no sound to keep:
  it exports without an audio track and needs no audio encoder. `onNotes` reports container/codec/size changes; H.264 sizes are rounded to even.
  `videoCodec`/`audioCodec` accept the desktop presets' FFmpeg names (`libx264`, `libopus`, …).
- `quality` maps to Mediabunny qualities; `videoBitrate`/`audioBitrate` override it.
- Cancel with the signal: the promise rejects with the signal's reason, encoders are released.

## Timeline helpers

- `generateThumbnails(media, fileId, { count | times, height, exact?, signal? }) → ImageBitmap[]` —
  one bitmap per time (close them). Default: the keyframe at or before each time, decoded alone
  (fast); `exact: true` decodes the exact frames. Stills repeat; audio-only files give `[]`.
- `generateWaveform(media, fileId, { buckets, start?, end?, signal? }) → Float32Array` — peak
  absolute amplitude per bucket over all channels, 0..1.

## Tool hosts

`createFrameHost(media)` and `createExportHost(media, { deliver?, stream? })` implement the
engine's `FrameHost` / `ExportHost` (`@zenvi/engine/tools`), so the tool catalog can render frames
(`preview_frame`, base64 PNG/JPEG) and export (`render_video`) in the editor. With `stream` the
export host writes to the writable it returns instead of memory.

## Building blocks

For custom pipelines (a Worker compositor, a cloud preview): `FrameProvider` (frame-accurate
pictures per clip lane), `FrameCache`, `StillCache`, `Compositor` + `mediaResources` (executes a
`FramePlan`: per layer, source-stage effects via `applyVideoEffect`, source-stage masks, the draw
with transform/opacity/blend mode/corner radius, then canvas-stage effects and masks — the order the
engine requires), `CanvasTextRasterizer` (Caption/Timer glyphs), `AudioRenderer` + `mixWindow` +
`AudioPlayback` (continuous per-clip decode, gain envelopes as AudioParam automation, speed and
reverse, audio kernels with state across windows), `KernelAudioSource`, `chooseCodecs`.

**Workers.** Only the SVG rasterizer (an `<img>`), the canvas binding (ResizeObserver) and the
player's AudioContext touch the DOM. The compositor, decoding and stills run in a Worker with
`OffscreenCanvas`; pass an `svgRasterizer` there (e.g. resvg-wasm).

## Engine bridge

`src/engine.ts` is the only place that calls `@zenvi/engine` for semantics (`RenderEngine`:
`planFrame`, `planAudio`, `applyVideoEffect`, `applyMask`, `getAudioKernel`, frame↔time).
Everything takes an optional `engine` for tests. render-web executes the plans as given: gain
envelopes (steps included) as AudioParam automation, rate as speed/reverse, `channelFilter` /
`channelMapping` routing, and audio effects at the timeline's sample rate and layout, one
libopenshot frame per block, with each effect's state carried across a clip's windows. Audio
windows (1 s in preview, 10 s in export) end on timeline audio frame boundaries, so effects whose
random draws follow the blocks (Noise, Whisperization) sound the same whatever the window size.

## Tests

```bash
npx vitest run --project render-web                     # unit + Node media tests (ffmpeg; libopenshot parity when its bindings are installed)
npx tsc -p packages/render-web/tsconfig.json            # also tsconfig.node-tests.json and e2e/tsconfig.json
npx playwright test -c packages/render-web/e2e/playwright.config.ts   # real Chromium: WebCodecs, Canvas2D, Web Audio
```

The browser suite generates its media with ffmpeg (frames carry their index as black/white
blocks, so any decoded picture says which frame it is) and checks: frame accuracy (VP9 at 30 and
25 fps, H.264), signed-URL refresh with range requests, compositing pixels (opacity, blend modes,
kernels, masks, corner radius, stills, SVG, video masks, kernel audio, text), MP4 and WebM export
round trips whose decoded frames match the timeline, exports that keep each clip's sound,
streaming export into OPFS, cancel, seam-free audio mixing, the engine's audio effects (Delay and
Noise, identical in one window or many), the player (seek, coalescing, scrub previews, audio clock, pause, loop,
end), thumbnails, waveforms, a project built with the engine's ops rendered by the real planner,
and decode cost.
