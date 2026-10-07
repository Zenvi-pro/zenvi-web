# Render parity with the desktop

`@zenvi/engine/render` reproduces what the Zenvi desktop app renders through
libopenshot 1.0. The reference is the desktop's own build: libopenshot
`v1.0.0` (`732f182`) against Qt 5.15.19 on macOS arm64, built with clang
(FMA contraction on), without ImageMagick, resvg or babl. "Exact" below means
byte-identical RGBA (or bit-identical float samples) to that build.

Policy: desktop quirks that shape how existing projects look are reproduced.
Bugs that corrupt pixels or audio (undefined behaviour, byte-order
mix-ups, unstable filters) are not: the engine implements the intended math
and each case is listed under [Divergences](#divergences) with the
libopenshot source line.

## Harnesses

| Harness | What it compares | Command |
|---|---|---|
| Qt raster oracle | `drawImage` with every transform class, opacity, and libopenshot's antialiased rounded-corner clip; smooth scaling; the 24 composition modes (51 cases, all exact) | `npx vitest run packages/engine/src/render/qt` (goldens from `scripts/qt-oracle`, C++ against Homebrew Qt 5.15) |
| Kernel goldens | each video kernel against `EffectBase::ProcessFrame` in libopenshot's Python bindings | `npx vitest run packages/engine/src/render/kernels` |
| Audio goldens | each audio effect against libopenshot on deterministic PCM frames | `npx vitest run packages/engine/src/render/audio` |
| Frame parity | whole timeline frames: `planFrame` + `compositeFrame` against `Timeline::GetFrame` | `npx vitest run packages/engine/src/render/parity` |

The kernel and audio goldens are committed JSON, regenerated with
`scripts/parity/*_goldens*.py` (deterministic). Frame parity renders its
references at test time with `scripts/parity/render_references.py`: it needs
`ffmpeg` and libopenshot's Python bindings (defaults
`~/Projects/zenvi/.venv/bin/python` with `PYTHONPATH=~/zenvi-deps-1.0/python`;
override with `ZENVI_PARITY_PYTHON` / `ZENVI_PARITY_PYTHONPATH`) and skips
without them. Media are generated into a temp dir (≤ 320×180, ≤ 3 s).

### Frame parity (PSNR over RGB; pass ≥ 35 dB)

| Case | Covers | Frames | Result |
|---|---|---|---|
| identity-video | 1:1 video, identity transform (fast blit) | 1, 15, 45 | exact |
| fit-still | QtImageReader still, FIT | 1 | exact |
| stretch-24fps-video | STRETCH, 24 fps source on a 30 fps timeline (FrameMapper) | 1, 10, 31 | exact |
| crop-mode-location | CROP scale with location offsets | 1 | exact |
| none-scale-double | NONE scale, half-size keyframes | 1 | exact |
| gravity-grid | all nine gravities | 1 | exact |
| keyframes-bezier | Bézier scale/location/rotation | 1, 10, 20, 30 | exact |
| keyframes-linear-constant | linear rotation and shear, constant location, origin | 1, 12, 25 | exact |
| alpha-fade | alpha keyframe over a still | 1, 8, 15, 29 | exact |
| two-layer-composite | layered SourceOver | 1, 30 | exact |
| mask-transition | Mask transition (brightness ramp, contrast 3) | 31, 38, 46, 55, 60 | exact |
| effects-brightness-saturation | chained clip effects | 1, 30 | exact |
| effects-blur-pixelate | Blur, Pixelate on a scaled layer | 1, 20 | exact |
| effects-crop | Crop, including `resize` | 1 | exact |
| chroma-key | ChromaKey over video | 1 | exact |
| blend-modes | four composite modes | 1 | exact |
| corner-radius | antialiased rounded-rect clip | 1 | exact |
| time-remap-reverse | decreasing `time` curve | 1, 20, 45 | exact |
| parent-clip | `parentObjectId` transform inheritance | 1 | exact |
| preview-160x90 | `SetMaxSize` preview (swscale fast bilinear decode) | 1, 20 | exact |
| export-192x108 | export size, `HIGH_QUALITY_SCALING` (bicubic decode) | 1, 20 | exact |
| shadow-after-transform | Shadow (applied after the transform) on a rotated, scaled still | 1 | exact |
| glow | Glow over video | 1 | exact |
| shadow-blend-mode | after-transform effect with a blend mode (layer canvas path) | 1 | exact |
| ntsc-timeline | 30 fps source on a 30000/1001 timeline | 1, 17, 40 | exact |
| time-remap-slow | half-speed `time` curve | 1, 9, 40 | exact |
| effect-mask-reader | generic effect mask (`mask_reader`) on scaled video | 1 | exact |
| effect-mask-reader-still | effect mask on a FIT still (mask reader decodes to the clip's box) | 1 | exact |
| displace-map | Displace with a still map | 1 | exact |
| corner-rotate-alpha | corner radius with rotation and opacity | 1 | exact |
| crop-resize-rotate | Crop `resize` with rotation | 1 | exact |
| waveform-clip | `waveform` clip over video (AudioVisualization shortcut fed with the clip's PCM) | 1, 20 | exact |
| audio-visualization | AudioVisualization effect on a clip with audio | 1, 30 | exact |

### Kernels

| Family | Goldens | Result |
|---|---|---|
| Brightness, Saturation, Hue, Negate, Blur, Pixelate, Crop, Shift, ColorShift, Wave, Deinterlace, Bars, ChromaKey, Sharpen, Mask, generic effect mask (`mask_reader`, both `mask_mode`s) | 43 cases | exact |
| ColorMap, ColorGrade, FilmGrain, DenoiseImage | 50 cases (74 frames, incl. multi-frame Denoise/FilmGrain) | exact |
| Shadow, Glow, LensFlare, Displace, SphericalProjection | 39 cases | exact |
| AnalogTape | 25 cases | exact |
| AudioVisualization (all nine modes, styles, palettes, layouts, backgrounds), BeatSync | 34 cases, 6 stateful sequences | exact |
| Caption, Timer | 38 background renders, 19 timer strings, 144 text-box edges | backgrounds and strings exact; 95/144 edges exact, the rest ±1 px (host fonts) |
| Compressor, Expander, Delay, Echo, Distortion, ParametricEQ, Noise | 33 cases | exact |
| Robotization, Whisperization | 2 cases | ≤ 9e-8 absolute (FFT, see below) |

Not supported (frames pass through, `supported: false`): Outline, Stabilizer,
Tracker, ObjectDetection, ObjectMask — they need OpenCV models or protobuf
tracking data.

## What exactness depends on

- **Qt raster semantics.** Smooth scaling (`qSmoothScaleImage`), the 16.16
  bilinear fetch with 8-bit weights, span coverage and clip quantization, the
  arm64 NEON SourceOver rounding (`qpaintengine_raster.cpp`, `qdrawhelper*.cpp`)
  and Qt's fuzzy transform classification (`qtransform.cpp`) are ported
  literally (`render/qt`). So are the path machinery behind antialiased
  clips and edges (`QPainterPath::addRoundedRect`, `QOutlineMapper`'s curve
  flattening, the gray raster `qgrayraster.c`) and the way spans reach the
  blend: 256-span batches, `qt_span_fill_clipped`, and `handleSpans`
  merging only within one call. The batching matters because every new run
  recomputes the bilinear sampling position instead of accumulating it.
- **Fused multiply-adds.** clang contracts `a*b + c` on arm64. QTransform,
  `Clip::get_transform` and many kernels are evaluated with a correctly
  rounded fma emulation at exactly the expressions clang fuses
  (`render/qt/fma.ts`). An x86-64 desktop build without FMA differs from the
  arm64 build by an ulp in the same places; the engine follows arm64.
- **macOS libm.** `expf`, `exp10f`, `powf` and `exp2f` are not correctly
  rounded on macOS; the audio effects and ColorGrade use bit-exact ports of
  Apple's implementations.
- **Decoding.** FFmpegReader scales video in the decoder with swscale:
  `SWS_FAST_BILINEAR` in preview, `SWS_BICUBIC` when exporting
  (`HIGH_QUALITY_SCALING`), to the plan's `drawWidth × drawHeight`. Renderers
  that decode with the same filter get exact frames; stills are passed at
  natural size and scaled by the compositor exactly like QtImageReader.

## Divergences

### Not reproduced: bugs that corrupt output

| Where | libopenshot | Engine |
|---|---|---|
| Sharpen | Converts the frame to straight ARGB32 in place and never converts back, so later effects read the wrong byte order (`effects/Sharpen.cpp:235-236`) | Same math (including Qt's arm64 un-premultiply), returns premultiplied RGBA |
| SphericalProjection | Leaves the frame straight ARGB32 (`effects/SphericalProjection.cpp:66-67, 370`) | Returns premultiplied RGBA (what compositing the ARGB32 frame produces) |
| Shadow, Glow | Blur on images smaller than `2r+1` reads out of bounds (`effects/Shadow.cpp:33-102`, `effects/Glow.cpp:33-102`) | Window indices clamped to the edge; identical whenever the image is large enough |
| Shadow, Glow | Tint channels outside 0..255 wrap (`Shadow.cpp:201-203`, `Glow.cpp:232-234, 251-253`) | Clamped |
| LensFlare | Out-of-range tint becomes a float16 or invalid (black) QColor (`effects/LensFlare.cpp:244-249`) | Clamped |
| ParametricEQ | Passes samples-per-frame as the sample rate (`audio_effects/ParametricEQ.cpp:64`): the default 500 Hz low-pass acts near 15 kHz at 1600 samples per frame and goes unstable at small blocks | Real sample rate |
| Noise | Reseeds `rand()` with `time(NULL)` every frame (`audio_effects/Noise.cpp:49`): not reproducible | libc-identical generator per effect, seeded from the effect id |
| Whisperization | Global `rand()` (`audio_effects/Whisperization.cpp:77`) | Same per-instance generator |
| Delay, Echo | Delays over 5 s overrun the buffer (`audio_effects/Delay.cpp:79`, `Echo.cpp:83`) | Wrap around the buffer |
| Delay, ParametricEQ, STFT effects | Channels beyond the first frame's count index unallocated state (`Delay.cpp:51`, `ParametricEQ.cpp:55`, `STFT.cpp:71`) | Fresh state per new channel |
| Distortion | Unknown type leaves the output uninitialised (`audio_effects/Distortion.cpp:62`) | Passes the sample through |
| Robotization, Whisperization | FFT/hop exponents unbounded (`Robotization.cpp:57-58`) | Clamped to 2^15 |
| Timeline audio | With a non-default `channel_mapping`, the gain ramp is applied to the mapped channel once per source channel, compounding (`Timeline.cpp:713-724`) | Gain applied once; mapped channels summed |

### Approximations

| Where | Difference | Size |
|---|---|---|
| Rotation | `QTransform::rotate` uses Apple's `sin`/`cos`; V8's `Math.sin`/`Math.cos` differ by 1 ulp for ~5% of angles (neither is correctly rounded) | occasionally ±1 on a few edge or sample pixels |
| Caption, Timer glyphs | Qt path fill of the font's outlines (`effects/Caption.cpp:266, 350-374`, `effects/Timer.cpp:363-389`); the engine draws glyphs with the host's `TextRasterizer` | text pixels; layout uses host metrics (Timer's `tightBoundingRect` is the host's ink bounds, `Timer.cpp:280-285, 368`) |
| Timer | Per-character runs: Qt strokes overlapping glyphs once; the host draws all fills then all strokes (`Timer.cpp:389`) | only at `font_alpha` < 1 |
| Caption | Wrap width approximates the last glyph's overhang as `max(advance, ink right)`; Qt line breaks at U+2028 inside a line are not reproduced (`Caption.cpp:253`) | rare wrap differences |
| Caption | Negative padding: Qt fills a malformed shape; the engine draws nothing (`Caption.cpp:304-332`) | – |
| Robotization, Whisperization | vDSP FFT (`juce_FFT.cpp:434-536`); the engine uses a double-precision real FFT and mirrors `|X[k]|` itself (`Robotization.cpp:76-78`). `ScopedNoDenormals` is not emulated | ≤ 9e-8 |
| AudioVisualization, BeatSync, SphericalProjection, LensFlare | `sin`/`cos`/`atan2`/`pow`/`exp` come from V8, which can differ from Apple's libm by 1 ulp; fused multiply-adds inside Qt's stroker are not emulated | none observed in any golden or a fuzz run against Qt |
| SphericalProjection | UV map in V8 `Math.*` without fused ops; the C++ also clears its UV cache on every property edit (`SphericalProjection.cpp:486-491`) | ~4e-9 of map values could round differently; none observed |
| Audio resampling | FrameMapper resamples with libswresample and `apply_timemapping` with JUCE's `ResamplingAudioSource`; renderers use their own resampler | sample values, not timing |
| Time-remapped audio | `Clip::apply_timemapping` (`Clip.cpp:585-720`) is replayed from the clip's first frame, as an export plays it; the desktop preview resets its read position on seeks and jumps | positions after seeks in the desktop preview |
| Muted frames and effects | Frames with `has_audio` 0 still run through the clip's audio effects on the desktop (silence in, `Clip.cpp:788`) and are dropped at mix time; the engine has no segment for them, so stateful effects (Delay, Echo) do not see that silence | tails after a mute toggle |

### Decisions

- **Background.** The canvas is always opaque black: `Timeline::SetJsonValue`
  ignores a project-level `color` (`Timeline.cpp:1293-1392`; only
  `ApplyJsonDiff` sets it, `:1706`), and the desktop never sends that diff.
- **Audio-only readers.** A clip whose reader has no video and no `has_video`
  override would paint the reader's lazily created opaque black frame
  (`Clip.cpp:1338`); the desktop always sets `has_video` off for audio-only
  media (`classes/clip_placement.py:68-86`), and the engine draws nothing.
  Caption and Timer on audio-only clips draw on a transparent canvas-sized
  frame, like the FFmpegReader's preview-size frames (`FFmpegReader.cpp:999-1019`).
- **Readers.** FFmpegReader and QtImageReader (stills, SVG) are rendered.
  Other reader types (ChunkReader, DummyReader, TextReader, …) are skipped.
  Tracked-object parents (`parentObjectId` naming a Tracker box) need OpenCV
  data and are ignored; clip parents work.

### Reproduced on purpose

These are how existing projects look on the desktop, so the engine keeps them:

- The desktop's default transitions (`fade.svg`, brightness 1 → −1 on an
  ease-in-out Bézier, contrast 3; `timeline.py` and the agent's
  `add_transition_between_clips`) dissolve over only about a third of their
  length: for a 1 s fade the blend runs 2 % → 94 % over frames 6–15 of 30,
  with pure A before and pure B after. The engine renders it identically.
- The `waveform` clip colour narrows each channel with
  `static_cast<unsigned char>` (`Clip.cpp:1502-1506`), so out-of-range
  values wrap.

- ChromaKey: every method except BASIC runs the BASIC_SOFT code, because the
  desktop build has no babl (`effects/ChromaKey.cpp`, the `#if USE_BABL` block).
- ColorMap (LUT values above 1) and DenoiseImage (overshoot on semi-transparent
  pixels) can write colour bytes above alpha.
- `.cube` files with only CR line endings fail to load (Qt drops every `\r`);
  `LUT_3D_INPUT_RANGE` lines are read as data.
- LensFlare's alpha rebuild multiplies every byte, so brightness 0 still
  squares the alpha of semi-transparent frames.
- Displace: a present `map_reader`, even `{}`, wins over the legacy `reader`
  key (`effects/Displace.cpp:282-289`).
- AVERAGE mixing divides by a volume sum that includes stills and silent
  video: every clip reader is wrapped in a FrameMapper, which always reports
  audio (`FrameMapper.cpp:47`, `Timeline.cpp:1093-1100`).
- Clip frames past the reader's length freeze the last picture and mute the
  audio (`FrameMapper.cpp:370-373`, `Clip.cpp:788`).
- DenoiseImage's response curve keeps its own defaults when the JSON has an
  empty `nodes` array (`AnimatedCurve.cpp:169-178`, `effects/DenoiseImage.cpp:310-313`).
