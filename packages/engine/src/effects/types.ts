/**
 * Effect registry types.
 */

import type { PropertyChoice, PropertyMeta } from "../model/properties.js";

/** One generated entry (scripts/gen-libopenshot-tables.py). */
export interface LibopenshotEffectEntry {
  /** `EffectInfo::Json()` entry. */
  info: { class_name: string; name: string; description: string; has_video: boolean; has_audio: boolean };
  /** `CreateEffect(name).Json()` without `id`, compact-encoded (see model/compact.ts). */
  defaults: Record<string, unknown>;
  /** `PropertiesJSON(1)` metadata per key. */
  properties: Record<string, PropertyMeta>;
}

export type EffectCategory = "video" | "audio";

export type EffectParamType =
  /** Keyframed number (animatable). */
  | "keyframe"
  /** Color keyframe (per channel). */
  | "color"
  | "int"
  | "float"
  | "bool"
  | "string"
  /** One of `choices` (a number; keyframed when `keyframable`). */
  | "choice"
  /** A reader object (mask image, displacement map). */
  | "reader"
  /** Nested data edited by a dedicated UI (color-grade curves/wheels, tracked objects). */
  | "object";

export interface EffectParam {
  /** JSON key on the effect object. */
  key: string;
  /** Display name (libopenshot PropertiesJSON `name`). */
  name: string;
  type: EffectParamType;
  /** Stored as a keyframe, so it can animate. */
  keyframable: boolean;
  /**
   * Default value: the constant value of a keyframe, `[r, g, b, a]` for a
   * color, the raw JSON value otherwise.
   */
  default: unknown;
  min?: number;
  max?: number;
  choices?: PropertyChoice[];
  readonly: boolean;
  /** EffectBase parameter every effect has (position, masks, apply_before_clip, …). */
  common: boolean;
  /** libopenshot's own property type ("float", "int", "font", "caption", "colorgrade_curve", …). */
  libopenshotType: string | null;
}

export interface EffectDefinition {
  /** libopenshot class name, e.g. "Blur". */
  className: string;
  /** Display name, e.g. "Chroma Key (Greenscreen)". */
  name: string;
  description: string;
  category: EffectCategory;
  hasVideo: boolean;
  hasAudio: boolean;
  /**
   * Where the engine can render it. OpenCV effects need libopenshot's OpenCV
   * build and pre-computed data; they are kept in projects but not rendered
   * by the web/Node renderers.
   */
  supported: { web: boolean; node: boolean };
  /** Needs the desktop ProcessEffect dialog (zenvi-core classes/effect_init.py) before it can run. */
  needsDialog: boolean;
  /** Depends on OpenCV in libopenshot. */
  requiresOpenCV: boolean;
  /** Icon file under `@zenvi/engine/assets/effects/` (zenvi-core src/effects/icons). */
  icon: string;
  /** Editable parameters, effect-specific first, then the common EffectBase ones. */
  params: EffectParam[];
  /** Raw libopenshot property metadata by key. */
  properties: Readonly<Record<string, PropertyMeta>>;
}
