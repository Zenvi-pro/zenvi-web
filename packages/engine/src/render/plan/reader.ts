/**
 * What a clip's reader delivers to the clip pipeline: the kind of source,
 * its display orientation and the size its frames are decoded at.
 *
 * libopenshot sizes every decoded image by a "max box" derived from the
 * preview size, the clip's scale mode and its largest scale keyframe
 * (QtImageReader::calculate_max_size, src/QtImageReader.cpp:198-280;
 * FFmpegReader::ProcessVideoPacket, src/FFmpegReader.cpp:1953-2048). The
 * delivered size matters beyond sharpness: effects that run before the clip
 * transform see it, and SCALE_NONE draws at it (spec §5.2-5.3).
 */

import { getMaxPoint } from "../../keyframe/evaluate.js";
import { roundHalfAway } from "../../model/rounding.js";
import type { Clip, ReaderInfo } from "../../model/types.js";
import { ScaleMode } from "../../model/types.js";

const f32 = Math.fround;

export type SourceKind = "video" | "image" | "svg" | "unsupported";

export interface Size {
  width: number;
  height: number;
}

/** `QSize::scaled(target, mode)` (qsize.cpp): integer math, truncating. */
export function qsizeScaled(w: number, h: number, tw: number, th: number, mode: "ignore" | "keep" | "expand"): Size {
  if (mode === "ignore" || w === 0 || h === 0) return { width: tw, height: th };
  const rw = Math.trunc((th * w) / h);
  const useHeight = mode === "keep" ? rw <= tw : rw >= tw;
  return useHeight ? { width: rw, height: th } : { width: tw, height: Math.trunc((tw * h) / w) };
}

/** `Clip::scale_size` (Clip.cpp:1522-1541): FIT keeps aspect, STRETCH ignores it, CROP expands, NONE unchanged. */
export function scaleSize(w: number, h: number, scale: number, tw: number, th: number): Size {
  switch (scale) {
    case ScaleMode.FIT:
      return qsizeScaled(w, h, tw, th, "keep");
    case ScaleMode.STRETCH:
      return qsizeScaled(w, h, tw, th, "ignore");
    case ScaleMode.CROP:
      return qsizeScaled(w, h, tw, th, "expand");
    default:
      return { width: w, height: h };
  }
}

function lowerExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/**
 * Which decoder a reader JSON asks for (Clip::SetJsonValue, Clip.cpp:1209-1254).
 * ImageReader/TextReader need ImageMagick, which the desktop build lacks, so
 * such clips are inert there too.
 */
export function sourceKind(reader: ReaderInfo | undefined): SourceKind {
  if (!reader || typeof reader.path !== "string") return "unsupported";
  switch (reader.type) {
    case "FFmpegReader":
      return "video";
    case "QtImageReader": {
      const ext = lowerExt(reader.path);
      return ext === "svg" || ext === "svgz" ? "svg" : "image";
    }
    default:
      return "unsupported";
  }
}

/**
 * libopenshot 1.0 applies container rotation in the reader unless the clip
 * predates that (`reader_orientation_mode` missing or "legacy_clip_transform",
 * Clip.cpp:1062-1071).
 */
export function appliesOrientation(clip: Clip): boolean {
  const mode = clip.reader_orientation_mode;
  return mode !== undefined && mode !== null && mode !== "legacy_clip_transform";
}

/** Container rotation in degrees (reader metadata `rotate`), 0 when absent. */
export function metadataRotation(reader: ReaderInfo): number {
  const raw = reader.metadata?.rotate;
  if (raw === undefined) return 0;
  const v = Number.parseFloat(String(raw));
  return Number.isFinite(v) ? v : 0;
}

/** The rotation rounded to a quarter turn, 0..359 (FFmpegReader.cpp:2025). */
export function quarterTurn(rotation: number): number {
  const q = (Math.trunc(roundHalfAway(rotation / 90)) * 90) % 360;
  return (q + 360) % 360;
}

function int(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** `scale_x/y.GetMaxPoint().co.Y` as a float (-1 when the keyframe is empty). */
function maxScale(kf: unknown): number {
  const p = getMaxPoint(kf as never);
  return p ? f32(p.y) : -1;
}

/** The first Crop effect with `resize` on (CropHelpers.cpp:25-40). */
function resizingCrop(clip: Clip): Record<string, unknown> | undefined {
  for (const effect of clip.effects ?? []) {
    if (effect.type === "Crop" && (effect.resize === true || effect.resize === 1)) return effect;
  }
  return undefined;
}

/** `ApplyCropResizeScale` (CropHelpers.cpp:42-62): request more pixels behind a resizing crop. */
function applyCropResizeScale(clip: Clip, sourceW: number, sourceH: number, box: Size): Size {
  const crop = resizingCrop(clip);
  if (!crop) return box;
  const maxLeft = maxScale(crop.left);
  const maxRight = maxScale(crop.right);
  const maxTop = maxScale(crop.top);
  const maxBottom = maxScale(crop.bottom);
  const visibleW = Math.max(f32(0.01), f32(f32(1 - maxLeft) - maxRight));
  const visibleH = Math.max(f32(0.01), f32(f32(1 - maxTop) - maxBottom));
  return {
    width: Math.trunc(Math.min(sourceW, Math.ceil(box.width / visibleW))),
    height: Math.trunc(Math.min(sourceH, Math.ceil(box.height / visibleH))),
  };
}

export interface DecodeContext {
  /** Timeline preview (canvas) size (`preview_width/height`). */
  previewWidth: number;
  previewHeight: number;
  /** Timeline info width (`t->info.width`, for SCALE_NONE's preview ratio). */
  timelineWidth: number;
}

/**
 * The max box (calculate_max_size) for a timeline clip's reader, in
 * display-oriented pixels. `infoW/H` are the reader's info size (oriented for
 * FFmpeg readers that apply rotation). A clip on a timeline always starts
 * from the preview size (the info-size and 1920×1080 fallbacks only apply to
 * readers without a timeline).
 */
export function maxBox(clip: Clip, infoW: number, infoH: number, ctx: DecodeContext): Size {
  let maxW = ctx.previewWidth;
  let maxH = ctx.previewHeight;
  const sx = maxScale(clip.scale_x);
  const sy = maxScale(clip.scale_y);
  const scale = clip.scale ?? ScaleMode.FIT;
  if (scale === ScaleMode.FIT || scale === ScaleMode.STRETCH) {
    maxW = Math.trunc(Math.max(maxW, f32(maxW * sx)));
    maxH = Math.trunc(Math.max(maxH, f32(maxH * sy)));
  } else if (scale === ScaleMode.CROP) {
    const ratioWH = f32(f32(infoW) / f32(infoH));
    const ratioHW = f32(f32(infoH) / f32(infoW));
    const widthSize = { width: Math.trunc(f32(maxW * sx)), height: Math.trunc(roundHalfAway(f32(maxW / ratioWH))) };
    const heightSize = { width: Math.trunc(roundHalfAway(f32(maxH / ratioHW))), height: Math.trunc(f32(maxH * sy)) };
    if (widthSize.width >= maxW && widthSize.height >= maxH) {
      maxW = Math.max(maxW, widthSize.width);
      maxH = Math.max(maxH, widthSize.height);
    } else {
      maxW = Math.max(maxW, heightSize.width);
      maxH = Math.max(maxH, heightSize.height);
    }
  } else {
    const previewRatio = f32(ctx.previewWidth / f32(ctx.timelineWidth));
    maxW = Math.trunc(f32(f32(infoW * sx) * previewRatio));
    maxH = Math.trunc(f32(f32(infoH * sy) * previewRatio));
  }
  return applyCropResizeScale(clip, infoW, infoH, { width: maxW, height: maxH });
}

export interface DeliveredSource {
  kind: SourceKind;
  /** Natural display-oriented size (reader info). */
  naturalWidth: number;
  naturalHeight: number;
  /** Size of each delivered frame image (libopenshot decode size, oriented). */
  width: number;
  height: number;
  /** Rotation the reader applies to decoded frames (degrees), 0 when none. */
  rotation: number;
  applyRotation: boolean;
}

/**
 * The image size a clip's reader delivers for this timeline, exactly like
 * libopenshot (still images scale up or down to the box; video only scales
 * down, and only when smaller than the stream on both axes).
 */
export function deliveredSource(clip: Clip, ctx: DecodeContext): DeliveredSource {
  const reader = clip.reader;
  const kind = sourceKind(reader);
  const infoW = int(reader?.width);
  const infoH = int(reader?.height);
  if (kind === "image" || kind === "svg") {
    const box = maxBox(clip, infoW, infoH, ctx);
    const size = infoW > 0 && infoH > 0 ? qsizeScaled(infoW, infoH, box.width, box.height, "keep") : box;
    return {
      kind,
      naturalWidth: infoW,
      naturalHeight: infoH,
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      rotation: 0,
      applyRotation: false,
    };
  }
  if (kind === "video") {
    const orient = appliesOrientation(clip);
    const rotation = orient ? metadataRotation(reader!) : 0;
    const quarter = quarterTurn(rotation);
    const swapped = orient && (quarter === 90 || quarter === 270);
    // Stored info of 1.0 readers is display-oriented; the stream is the unrotated size.
    const streamW = swapped ? infoH : infoW;
    const streamH = swapped ? infoW : infoH;
    let box = maxBox(clip, infoW, infoH, ctx);
    if (swapped) box = { width: box.height, height: box.width };
    let w = streamW;
    let h = streamH;
    if (box.width !== 0 && box.height !== 0 && box.width < w && box.height < h) {
      const ratio = f32(f32(w) / f32(h));
      const possibleW = Math.trunc(roundHalfAway(f32(box.height * ratio)));
      const possibleH = Math.trunc(roundHalfAway(f32(box.width / ratio)));
      if (possibleW <= box.width) {
        w = possibleW;
        h = box.height;
      } else {
        w = box.width;
        h = possibleH;
      }
    }
    const outW = swapped ? h : w;
    const outH = swapped ? w : h;
    return {
      kind,
      naturalWidth: infoW,
      naturalHeight: infoH,
      width: Math.max(1, outW),
      height: Math.max(1, outH),
      rotation: orient ? rotation : 0,
      applyRotation: orient,
    };
  }
  return { kind, naturalWidth: infoW, naturalHeight: infoH, width: Math.max(1, infoW), height: Math.max(1, infoH), rotation: 0, applyRotation: false };
}
