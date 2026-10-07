/**
 * How the Properties panel groups libopenshot properties. Names, ranges and
 * choices come from the engine's PropertiesJSON tables; this is only layout.
 */

export interface PropertyGroup {
  title: string;
  keys: readonly string[];
  /** Collapsed by default. */
  collapsed?: boolean;
}

export const CLIP_GROUPS: readonly PropertyGroup[] = [
  { title: "Transform", keys: ["location_x", "location_y", "scale_x", "scale_y", "rotation", "shear_x", "shear_y", "origin_x", "origin_y"] },
  { title: "Layout", keys: ["gravity", "scale", "anchor", "corner_radius", "margin"] },
  { title: "Opacity", keys: ["alpha", "composite"] },
  { title: "Time", keys: ["position", "start", "end", "duration", "time"] },
  { title: "Audio", keys: ["volume", "mixing", "has_audio", "channel_filter", "channel_mapping"] },
  { title: "Video", keys: ["has_video", "display", "waveform", "wave_color", "waveform_mode"], collapsed: true },
];

export const TRANSITION_GROUPS: readonly PropertyGroup[] = [
  { title: "Transition", keys: ["brightness", "contrast", "replace_image"] },
  { title: "Time", keys: ["position", "start", "end", "duration", "layer"] },
];

/** Keys shown in the effect header or handled elsewhere, never as rows. */
export const HIDDEN_EFFECT_KEYS = new Set([
  "id",
  "type",
  "class_name",
  "name",
  "description",
  "has_audio",
  "has_video",
  "has_tracked_object",
  "order",
  "parent_effect_id",
  "layer",
  "position",
  "start",
  "end",
  "duration",
  "mask_reader",
  "mask_source_id",
]);

/** Display precision and step for a property, from its range. */
export function numberFormat(min: number | null, max: number | null, key: string): { step: number; precision: number; scale: number; unit?: string } {
  if (key === "alpha" || key === "volume") return { step: 1, precision: 0, scale: 100, unit: "%" };
  if (key === "rotation" || key.endsWith("angle")) return { step: 1, precision: 1, scale: 1, unit: "°" };
  if (key === "position" || key === "start" || key === "end" || key === "duration") return { step: 0.04, precision: 2, scale: 1, unit: "s" };
  const span = min !== null && max !== null && Number.isFinite(max - min) ? max - min : 100;
  if (span <= 4) return { step: 0.01, precision: 3, scale: 1 };
  if (span <= 40) return { step: 0.05, precision: 2, scale: 1 };
  return { step: 1, precision: 1, scale: 1 };
}

export function humanize(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
