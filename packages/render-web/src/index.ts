// @zenvi/render-web: the browser media runtime. Decode (Mediabunny/WebCodecs),
// preview (Canvas2D + Web Audio) and export a Zenvi project. The engine owns
// the semantics; this package executes its plans. See README.md.

// Media
export {
  MediaRegistry,
  MediaUnavailableError,
  type AudioStreamInfo,
  type MediaLease,
  type MediaRef,
  type MediaRegistryOptions,
  type OpenMedia,
  type VideoStreamInfo,
} from "./media/registry.js";
export { type MediaSourceSpec, sourceName } from "./media/source.js";
export { probeMedia, mediaKind, sourceKind, ProbeError, type MediaKind, type ProbeOptions } from "./media/probe.js";
export { parseSvgSize, type SvgRasterizer, type SvgSize, withGenericFontFallbacks } from "./media/svg.js";
export { createImageElementSvgRasterizer } from "./media/svg-dom.js";
export { StillCache, type StillCacheOptions, type StillRequest } from "./media/stills.js";

// Video decoding
export { FrameProvider, VideoDecodeUnsupportedError, type FrameProviderOptions, type FrameRequest } from "./video/frame-provider.js";
export { FrameCache } from "./video/frame-cache.js";
export type { FrameImage } from "./video/shared-bitmap.js";
export type { DecodeMode } from "./video/decode-cursor.js";
export type { ResizeQuality } from "./video/convert.js";

// Compositing
export {
  Compositor,
  IDENTITY_VIEWPORT,
  type CompositorOptions,
  type DrawContext,
  type LayerError,
  type LayerResources,
  type PreparedFrame,
  type Viewport,
} from "./compositor/compositor.js";
export { mediaResources, type MediaResourcesOptions } from "./compositor/resources.js";
export { CanvasTextRasterizer } from "./compositor/text.js";

// Preview
export { PreviewPlayer, type PlayerErrorEvent, type PlayerState, type PreviewPlayerOptions } from "./player/preview-player.js";
export { fitViewport } from "./player/layout.js";

// Audio
export { AudioRenderer, type PreparedPiece } from "./audio/renderer.js";
export { KernelAudioSource } from "./audio/kernel-audio.js";
export { AudioPlayback, type AudioPlaybackOptions } from "./audio/playback.js";
export { mixRange, mixWindow } from "./audio/mixdown.js";
export { renderMixPcm, DEFAULT_MIX_SECONDS, type MixPcmOptions } from "./audio/mix-pcm.js";

// Export
export {
  canExportWith,
  exportProject,
  exportProjectTo,
  exportFrame,
  type ExportFrameOptions,
  type ExportProgress,
  type ExportRunOptions,
  type StreamedExport,
} from "./export/export-project.js";
export { canEncodeNamed, chooseCodecs, ExportError, type CodecChoice, type EncodeSupport } from "./export/codecs.js";
export { FrameRenderer } from "./export/frame-renderer.js";

// Timeline helpers
export { generateThumbnails, generateWaveform, type ThumbnailOptions, type WaveformOptions } from "./timeline/thumbnails.js";

// Engine bridge and tool hosts
export { defaultEngine, type PlanFrameOptions, type RenderEngine } from "./engine.js";
export { createExportHost, createFrameHost, type WebExportHostOptions, type WebFrameHostOptions } from "./hosts.js";
