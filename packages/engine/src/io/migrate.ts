/**
 * Load-time upgrades the desktop applies to every project it opens, ported
 * from zenvi-core src/classes/project_data.py `upgrade_project_data_structures`
 * (L801-973) and its helpers (L976-1166), plus
 * src/classes/clip_placement.py `repair_audio_only_project_data`.
 *
 * Every function mutates the project data it is given (the caller passes a
 * private copy), exactly like the desktop mutates `self._data`.
 *
 * One deliberate difference: the desktop compares `openshot-qt` versions as
 * strings, so Zenvi's own stamps ("1.0.188") fall into the OpenShot
 * `<= "2.1.0-dev"` branch and every bezier handle is reset to the default
 * ease on each load. That branch exists for OpenShot 2.0/2.1 projects, which
 * predate percent-based handles; here it applies only to OpenShot stamps
 * (`isZenviVersion`), so handle edits survive a reload.
 */

import type { Keyframe } from "../model/types.js";
import { Gravity, Interpolation, ScaleMode } from "../model/types.js";
import { applyAudioOnlyOverrides } from "../model/defaults.js";
import { defaultEffectJson } from "../effects/registry.js";
import { isAudioOnlyMedia } from "../model/media.js";
import { libopenshotKeyframe } from "../model/compact.js";
import { evaluate } from "../keyframe/evaluate.js";
import { pyRound } from "../model/rounding.js";
import { BETA_VERSION, compareVersions, isZenviVersion, numericVersion } from "./versions.js";

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Data[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function pointsOf(keyframe: unknown): Data[] {
  return isRecord(keyframe) ? records(keyframe.Points) : [];
}

/** Python truthiness of a JSON value. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface UpgradeOptions {
  /** Id for objects the upgrade creates (2.5.x Crop effects) and for a "T0" project. */
  newId: () => string;
}

/**
 * Run every desktop load upgrade on `data` (L801-973). `data.version` must
 * already hold the file's stamps (missing ones filled with "0.0.0").
 */
export function upgradeProjectData(data: Data, options: UpgradeOptions): void {
  const version = isRecord(data.version) ? data.version : {};
  const openshotVersion = String(version["openshot-qt"] ?? BETA_VERSION);
  const libopenshotVersion = String(version.libopenshot ?? BETA_VERSION);

  if (openshotVersion === BETA_VERSION) {
    flipBetaAlpha(data);
  } else if (!isZenviVersion(openshotVersion)) {
    // Python compares these version strings lexicographically (L818, L866).
    if (openshotVersion <= "2.1.0-dev") resetLegacyHandles(data);
    else if (openshotVersion.startsWith("2.5.")) migrateLegacyCrop(data, options.newId);
    else if (openshotVersion <= "3.1.1") migrateTrackedObjectAlpha(data);
  }

  repairAudioOnlyProjectData(data);

  if (compareVersions(numericVersion(libopenshotVersion), [1, 0, 0]) < 0) {
    migrateLegacyCropLocations(data);
  }
  if (compareVersions(numericVersion(openshotVersion), [4, 0, 0]) === 0 && !openshotVersion.includes("-")) {
    migrate400NonCropLocations(data);
  }

  if (data.id === "T0") data.id = options.newId();
}

/** OpenShot beta (0.0.0) stored alpha inverted (L810-821). */
function flipBetaAlpha(data: Data): void {
  for (const clip of records(data.clips)) {
    for (const point of pointsOf(clip.alpha)) {
      for (const key of ["co", "handle_left", "handle_right"]) {
        const coord = point[key];
        if (isRecord(coord) && typeof coord.Y === "number") coord.Y = 1.0 - coord.Y;
      }
    }
  }
}

function resetHandles(points: Data[]): void {
  for (const point of points) {
    if (isRecord(point.handle_left)) {
      point.handle_left.X = 0.5;
      point.handle_left.Y = 1.0;
    }
    if (isRecord(point.handle_right)) {
      point.handle_right.X = 0.5;
      point.handle_right.Y = 0.0;
    }
  }
}

/** OpenShot <= 2.1.0-dev handles were absolute; reset to the default ease (L823-851). */
function resetLegacyHandles(data: Data): void {
  for (const collection of ["clips", "effects"]) {
    for (const item of records(data[collection])) {
      for (const object of [item, ...records(item.effects)]) {
        for (const value of Object.values(object)) {
          if (!isRecord(value)) continue;
          if ("Points" in value) {
            resetHandles(pointsOf(value));
          } else if ("red" in value) {
            for (const channel of ["red", "blue", "green", "alpha"]) resetHandles(pointsOf(value[channel]));
          }
        }
      }
    }
  }
}

/** project_data.py `is_keyframe_valid` (L1158): more than one point, or a non-default value. */
function isKeyframeChanged(keyframe: unknown, defaultValue: number): boolean {
  const points = isRecord(keyframe) ? keyframe.Points : undefined;
  if (!Array.isArray(points) || points.length === 0) return false;
  if (points.length > 1) return true;
  const first = points[0];
  const co = isRecord(first) && isRecord(first.co) ? first.co : {};
  return (co.Y ?? defaultValue) !== defaultValue;
}

/** OpenShot 2.5.x clip crop_* keyframes become a Crop effect (L853-890). */
function migrateLegacyCrop(data: Data, newId: () => string): void {
  for (const clip of records(data.clips)) {
    const pop = (key: string): unknown => {
      const value = clip[key];
      delete clip[key];
      return value ?? {};
    };
    const cropX = pop("crop_x");
    const cropY = pop("crop_y");
    const cropWidth = pop("crop_width");
    const cropHeight = pop("crop_height");
    if (
      !isKeyframeChanged(cropX, 0.0) &&
      !isKeyframeChanged(cropY, 0.0) &&
      !isKeyframeChanged(cropWidth, 1.0) &&
      !isKeyframeChanged(cropHeight, 1.0)
    ) {
      continue;
    }
    const effect = defaultEffectJson("Crop", newId()) as Data;
    effect.x = truthy(cropX) ? cropX : libopenshotKeyframe(0.0);
    effect.y = truthy(cropY) ? cropY : libopenshotKeyframe(0.0);
    effect.right = truthy(cropWidth) ? cropWidth : libopenshotKeyframe(1.0);
    effect.bottom = truthy(cropHeight) ? cropHeight : libopenshotKeyframe(1.0);
    // Crop margins count from the far edge; 2.5.x stored width/height.
    for (const prop of ["right", "bottom"]) {
      for (const point of pointsOf(effect[prop])) {
        const co = isRecord(point.co) ? point.co : null;
        if (co) co.Y = 1.0 - num(co.Y, 0.0);
      }
    }
    if (!Array.isArray(clip.effects)) clip.effects = [];
    (clip.effects as unknown[]).push(effect);
  }
}

function flipPoints(points: Data[]): void {
  for (const point of points) {
    const co = point.co;
    if (isRecord(co)) co.Y = 1.0 - num(co.Y, 1.0);
  }
}

/** OpenShot <= 3.1.1 tracked-box alpha was inverted; child clips gain parentObjectId (L893-944). */
function migrateTrackedObjectAlpha(data: Data): void {
  const clips = records(data.clips);
  for (const clip of clips) {
    for (const effect of records(clip.effects)) {
      if (effect.name !== "Tracker" && effect.name !== "Object Detector") continue;

      if ("display_box_text" in effect) {
        const keyframe = effect.display_box_text;
        const points = isRecord(keyframe) && Array.isArray(keyframe.Points) ? (keyframe.Points as unknown[]) : null;
        if (points) {
          flipPoints(points.filter(isRecord));
          // `Point(1.0).Json()`: text visible.
          if (points.length === 0) points.push({ co: { X: 1.0, Y: 1.0 }, interpolation: Interpolation.CONSTANT });
        }
      }

      const objects = isRecord(effect.objects) ? effect.objects : {};
      for (const [trackedKey, tracked] of Object.entries(objects)) {
        if (!isRecord(tracked)) continue;
        const childClipId = tracked.child_clip_id;
        if (truthy(childClipId)) {
          for (const child of clips) {
            if (child.id === childClipId) child.parentObjectId = trackedKey;
          }
        }
        flipPoints(pointsOf(tracked.background_alpha));
        flipPoints(pointsOf(tracked.stroke_alpha));
      }
    }
  }
}

/**
 * clip_placement.py `repair_audio_only_project_data`: audio-only files and
 * every clip reading them stop compositing a (cover-art) frame. Returns the
 * number of clips repaired.
 */
export function repairAudioOnlyProjectData(data: Data): number {
  // Python `str(x or "")` keys.
  const key = (...candidates: unknown[]): string => String(candidates.find(truthy) ?? "");
  const audioFiles = new Map<string, Data>();
  for (const file of records(data.files)) {
    if (!isAudioOnlyMedia(file)) continue;
    file.has_video = false;
    audioFiles.set(key(file.id), file);
  }
  if (audioFiles.size === 0) return 0;
  let repaired = 0;
  for (const clip of records(data.clips)) {
    const reader = isRecord(clip.reader) ? clip.reader : {};
    const file = audioFiles.get(key(clip.file_id, reader.id));
    if (file && applyAudioOnlyOverrides(clip, file)) repaired += 1;
  }
  return repaired;
}

/** project_data.py `_keyframe_value`: a keyframe's value at a frame, or `fallback` for non-keyframes. */
function keyframeValue(keyframe: unknown, frame: unknown, fallback: number): number {
  if (!isRecord(keyframe)) return fallback;
  if (typeof frame !== "number" || !Number.isFinite(frame)) return fallback;
  return evaluate(keyframe as Keyframe, pyRound(frame));
}

type Alignment = "start" | "end" | "center";

/** project_data.py `_legacy_location_factor` (L999): old/new location-unit ratio on one axis. */
export function legacyLocationFactor(value: number, canvasSize: number, clipSize: number, alignment: Alignment): number {
  if (!value || canvasSize <= 0 || clipSize <= 0) return 1.0;
  let denominator: number;
  if (alignment === "start") denominator = value < 0 ? clipSize : canvasSize;
  else if (alignment === "end") denominator = value < 0 ? canvasSize : clipSize;
  else denominator = (canvasSize + clipSize) / 2.0;
  return denominator ? canvasSize / denominator : 1.0;
}

const HORIZONTAL_ALIGNMENT: Partial<Record<number, Alignment>> = {
  [Gravity.TOP_LEFT]: "start",
  [Gravity.LEFT]: "start",
  [Gravity.BOTTOM_LEFT]: "start",
  [Gravity.TOP_RIGHT]: "end",
  [Gravity.RIGHT]: "end",
  [Gravity.BOTTOM_RIGHT]: "end",
};

const VERTICAL_ALIGNMENT: Partial<Record<number, Alignment>> = {
  [Gravity.TOP_LEFT]: "start",
  [Gravity.TOP]: "start",
  [Gravity.TOP_RIGHT]: "start",
  [Gravity.BOTTOM_LEFT]: "end",
  [Gravity.BOTTOM]: "end",
  [Gravity.BOTTOM_RIGHT]: "end",
};

function alignmentFor(table: Partial<Record<number, Alignment>>, gravity: unknown): Alignment {
  return typeof gravity === "number" ? (table[gravity] ?? "center") : "center";
}

/** Python `float(x or 0.0)`; values Python could not convert count as 0 (the desktop would raise). */
function toFloat(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function sourceSize(clip: Data, files: Map<unknown, Data>): { width: number; height: number } {
  const reader = isRecord(clip.reader) && truthy(clip.reader) ? clip.reader : (files.get(clip.file_id) ?? {});
  return { width: toFloat(reader.width), height: toFloat(reader.height) };
}

function filesById(data: Data): Map<unknown, Data> {
  return new Map(records(data.files).map((file) => [file.id, file]));
}

/** libopenshot < 1.0 placed SCALE_CROP clips in canvas units; keep their visual position (L1011-1085). */
function migrateLegacyCropLocations(data: Data): void {
  const canvasWidth = toFloat(data.width);
  const canvasHeight = toFloat(data.height);
  if (canvasWidth <= 0 || canvasHeight <= 0) return;
  const files = filesById(data);

  for (const clip of records(data.clips)) {
    if (clip.scale !== ScaleMode.CROP) continue;
    const source = sourceSize(clip, files);
    if (source.width <= 0 || source.height <= 0) continue;
    const cropScale = Math.max(canvasWidth / source.width, canvasHeight / source.height);
    const baseWidth = source.width * cropScale;
    const baseHeight = source.height * cropScale;
    const gravity = clip.gravity ?? Gravity.CENTER;
    const axes = [
      { prop: "location_x", canvas: canvasWidth, base: baseWidth, align: alignmentFor(HORIZONTAL_ALIGNMENT, gravity), scale: "scale_x" },
      { prop: "location_y", canvas: canvasHeight, base: baseHeight, align: alignmentFor(VERTICAL_ALIGNMENT, gravity), scale: "scale_y" },
    ];
    for (const axis of axes) {
      for (const point of pointsOf(clip[axis.prop])) {
        const co = point.co;
        if (!isRecord(co) || !("Y" in co) || typeof co.Y !== "number") continue;
        const frame = co.X ?? 1.0;
        const value = co.Y;
        const scaleValue = keyframeValue(clip[axis.scale], frame, 1.0);
        const factor = legacyLocationFactor(value, axis.canvas, axis.base * scaleValue, axis.align);
        if (factor !== 1.0) co.Y = value * factor;
      }
    }
  }
}

/** OpenShot 4.0.0 saved non-Crop locations in geometry units; convert back to canvas units (L1087-1156). */
function migrate400NonCropLocations(data: Data): void {
  const canvasWidth = toFloat(data.width);
  const canvasHeight = toFloat(data.height);
  if (canvasWidth <= 0 || canvasHeight <= 0) return;
  const files = filesById(data);

  for (const clip of records(data.clips)) {
    const scaleMode = clip.scale ?? ScaleMode.FIT;
    if (scaleMode === ScaleMode.CROP) continue;
    const source = sourceSize(clip, files);
    if (source.width <= 0 || source.height <= 0) continue;
    const gravity = clip.gravity ?? Gravity.CENTER;
    const axes = [
      { prop: "location_x", canvas: canvasWidth, source: source.width, align: alignmentFor(HORIZONTAL_ALIGNMENT, gravity), scale: "scale_x" },
      { prop: "location_y", canvas: canvasHeight, source: source.height, align: alignmentFor(VERTICAL_ALIGNMENT, gravity), scale: "scale_y" },
    ];
    for (const axis of axes) {
      for (const point of pointsOf(clip[axis.prop])) {
        const co = point.co;
        if (!isRecord(co) || !("Y" in co) || typeof co.Y !== "number") continue;
        const frame = co.X ?? 1.0;
        const value = co.Y;
        const margin = keyframeValue(clip.margin, frame, 0.0);
        const marginPixels = Math.max(0.0, Math.min(0.5, margin)) * Math.min(canvasWidth, canvasHeight);
        const layoutSize = Math.max(1.0, axis.canvas - 2.0 * marginPixels);

        let baseSize: number;
        if (scaleMode === ScaleMode.STRETCH) baseSize = layoutSize;
        else if (scaleMode === ScaleMode.NONE) baseSize = axis.source;
        else {
          const fitScale = Math.min(
            (canvasWidth - 2.0 * marginPixels) / source.width,
            (canvasHeight - 2.0 * marginPixels) / source.height,
          );
          baseSize = axis.source * fitScale;
        }

        const clipSize = baseSize * keyframeValue(clip[axis.scale], frame, 1.0);
        const factor = legacyLocationFactor(value, layoutSize, clipSize, axis.align);
        // Undo the old->new conversion, then rescale to the full canvas.
        if (factor) co.Y = (value * layoutSize) / (factor * axis.canvas);
      }
    }
  }
}
