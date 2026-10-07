/**
 * Engine catalogs the editor lists and edits with: effects, transitions,
 * title templates, and libopenshot property metadata (names, ranges,
 * choices, keyframable) for clips, transitions and effects. Everything comes
 * from `@zenvi/engine`; this module only adds the URLs of the bundled assets
 * (`@zenvi/engine/assets/…`) for thumbnails and rendering.
 */
import {
  CLIP_PROPERTIES,
  DEFAULT_TRANSITION_LENGTH,
  EFFECTS,
  getEffect,
  resolveTransitionAsset as engineTransitionAsset,
  TITLE_TEMPLATES,
  TRANSITION_PROPERTIES,
  TRANSITIONS,
  valueKind as engineValueKind,
  type EffectDefinition,
  type EffectParam,
  type PropertyMeta,
  type TitleTemplate as EngineTitleTemplate,
  type TransitionEntry as EngineTransition,
} from "@zenvi/engine";

export type { PropertyMeta };
export type PropertyTable = Readonly<Record<string, PropertyMeta>>;

export interface EffectEntry {
  className: string;
  name: string;
  description: string;
  category: "video" | "audio";
  /** False for OpenCV-only effects the browser cannot run. */
  supported: boolean;
  /** Needs the desktop's preparation dialog (tracker, stabilizer…). */
  needsDialog: boolean;
  icon: string;
  /** Parameter metadata keyed by JSON key, in the registry's order. */
  properties: PropertyTable;
  params: readonly EffectParam[];
}

/** A built-in transition mask (engine catalog) with its thumbnail URL. */
export interface TransitionEntry extends EngineTransition {
  url: string | null;
}

/** A built-in title template (engine catalog) with the SVG's URL. */
export interface TitleTemplate extends EngineTitleTemplate {
  url: string | null;
}

export function clipProperties(): PropertyTable {
  return CLIP_PROPERTIES;
}

export function transitionProperties(): PropertyTable {
  return TRANSITION_PROPERTIES;
}

// ---------------------------------------------------------------------------
// Effects (engine registry)
// ---------------------------------------------------------------------------

/** Registry params as the Properties panel's PropertyMeta. */
function paramMeta(param: EffectParam): PropertyMeta {
  return {
    name: param.name,
    type: param.type === "color" ? "color" : param.type === "reader" ? "reader" : param.libopenshotType,
    min: param.min ?? null,
    max: param.max ?? null,
    keyframe: param.keyframable,
    readonly: param.readonly,
    ...(param.choices ? { choices: param.choices } : {}),
  };
}

function toEntry(def: EffectDefinition): EffectEntry {
  return {
    className: def.className,
    name: def.name,
    description: def.description,
    category: def.category,
    supported: def.supported.web && !def.needsDialog,
    needsDialog: def.needsDialog,
    icon: def.icon,
    properties: Object.fromEntries(def.params.map((p) => [p.key, paramMeta(p)])),
    params: def.params,
  };
}

let effectsCache: EffectEntry[] | null = null;

export function effects(): EffectEntry[] {
  if (!effectsCache) effectsCache = EFFECTS.filter((e) => e.className !== "Mask").map(toEntry).sort((a, b) => a.name.localeCompare(b.name));
  return effectsCache;
}

export function effectEntry(className: string): EffectEntry | undefined {
  const def = getEffect(className);
  return def ? toEntry(def) : undefined;
}

// Effect icons copied from zenvi-core (`@zenvi/engine/assets/effects/<classname>.png`).
const effectIcons = import.meta.glob("../../../../../packages/engine/assets/effects/*.{png,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const iconByFile = new Map(Object.entries(effectIcons).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1).toLowerCase(), url]));

export function effectIconUrl(className: string): string | null {
  const def = getEffect(className);
  const file = (def?.icon ?? `${className}.png`).toLowerCase();
  return iconByFile.get(file) ?? iconByFile.get(`${className.toLowerCase()}.png`) ?? null;
}

// ---------------------------------------------------------------------------
// Transitions and titles (engine catalogs + bundled asset URLs)
// ---------------------------------------------------------------------------

const assetFiles = import.meta.glob(["../../../../../packages/engine/assets/transitions/**/*", "../../../../../packages/engine/assets/titles/*.svg"], {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Bundled asset URL by its path under `@zenvi/engine/assets/` (`"transitions/common/fade.svg"`). */
const assetUrls = new Map(Object.entries(assetFiles).map(([path, url]) => [path.slice(path.indexOf("/assets/") + "/assets/".length), url]));

export function assetUrl(assetPath: string): string | null {
  return assetUrls.get(assetPath) ?? null;
}

/** Every built-in transition, in the desktop dock's order (common, then extra, by file name). */
const transitionList: readonly TransitionEntry[] = TRANSITIONS.map((t) => ({ ...t, url: assetUrl(t.assetPath) }));

export function transitions(): readonly TransitionEntry[] {
  return transitionList;
}

/** URL of the mask a project's transition reader points at (`@transitions/common/fade.svg` or a desktop install path). */
export function resolveTransitionAsset(path: string): string | null {
  const entry = engineTransitionAsset(path);
  return entry ? assetUrl(entry.assetPath) : null;
}

const titleList: readonly TitleTemplate[] = TITLE_TEMPLATES.map((t) => ({ ...t, url: assetUrl(t.assetPath) }));

/** The 50 desktop title templates, sorted by file name like the desktop list. */
export function titleTemplates(): readonly TitleTemplate[] {
  return titleList;
}

/** Desktop default length of a transition dropped from the library, seconds. */
export function defaultTransitionSeconds(): number {
  return DEFAULT_TRANSITION_LENGTH;
}

export type ValueKind = ReturnType<typeof engineValueKind>;

/** How a property's value is stored, which decides the editor control. */
export function valueKind(meta: PropertyMeta | undefined, current: unknown): ValueKind {
  return engineValueKind(meta, current);
}
