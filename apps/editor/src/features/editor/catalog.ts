/**
 * Engine catalogs the editor lists and edits with: effects, transitions,
 * title templates, and libopenshot property metadata (names, ranges,
 * choices, keyframable) for clips, transitions and effects.
 *
 * W1 is still exporting these from `@zenvi/engine` (see
 * scratchpad/requests/W6-editor.md). They are read through the namespace so
 * the editor picks each one up the moment it is exported; until then the
 * panels show an honest "not available yet" state. Nothing here invents
 * domain data.
 */
import * as engine from "@zenvi/engine";
import {
  CLIP_PROPERTIES,
  DEFAULT_TRANSITION_LENGTH,
  EFFECTS,
  getEffect,
  TRANSITION_PROPERTIES,
  valueKind as engineValueKind,
  type EffectDefinition,
  type EffectParam,
  type PropertyMeta,
} from "@zenvi/engine";

const ns = engine as unknown as Record<string, unknown>;

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

export interface TransitionEntry {
  /** Catalog id, e.g. "common/fade". */
  id: string;
  name: string;
  category: string;
  /** URL of the mask image (for the thumbnail). */
  url: string | null;
}

export interface TitleTemplate {
  id: string;
  name: string;
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
// Transitions and titles
// ---------------------------------------------------------------------------

const transitionFiles = import.meta.glob("../../../../../packages/engine/assets/transitions/**/*.{svg,png,jpg,jpeg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const titleFiles = import.meta.glob("../../../../../packages/engine/assets/titles/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function assetKey(path: string, root: string): string {
  const i = path.indexOf(root);
  return i >= 0 ? path.slice(i + root.length) : path;
}

/** Desktop display name: basename without extension, underscores to spaces, capitalized. */
export function displayNameFromFile(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

interface RawTransition {
  id?: string;
  name?: string;
  category?: string;
  file?: string;
}

let transitionsCache: TransitionEntry[] | null = null;

export function transitions(): TransitionEntry[] {
  if (transitionsCache) return transitionsCache;
  const urls = new Map(Object.entries(transitionFiles).map(([path, url]) => [assetKey(path, "/transitions/"), url]));
  const raw = (ns.TRANSITIONS ?? ns.TRANSITION_CATALOG) as readonly RawTransition[] | undefined;
  let list: TransitionEntry[];
  if (Array.isArray(raw) && raw.length > 0) {
    list = raw.map((t) => {
      const file = t.file ?? `${t.id ?? ""}`;
      const key = file.includes("/") ? file : `${t.category ?? "common"}/${file}`;
      const url = urls.get(key) ?? [...urls.entries()].find(([k]) => k.startsWith(`${t.id ?? "\u0000"}.`))?.[1] ?? null;
      return { id: t.id ?? key.replace(/\.[^.]+$/, ""), name: t.name ?? displayNameFromFile(key), category: t.category ?? key.split("/")[0] ?? "common", url };
    });
  } else {
    // Assets without a catalog: derive entries from the file layout (desktop list_transitions does the same).
    list = [...urls.entries()].map(([key, url]) => ({
      id: key.replace(/\.[^.]+$/, ""),
      name: displayNameFromFile(key),
      category: key.split("/")[0] ?? "common",
      url,
    }));
  }
  transitionsCache = list.sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category === "common" ? -1 : 1));
  return transitionsCache;
}

/** URL for a transition mask path as the project stores it (`@transitions/common/fade.svg`). */
export function resolveTransitionAsset(path: string): string | null {
  const key = path.replace(/^@transitions\//, "").replace(/^.*\/transitions\//, "");
  for (const [p, url] of Object.entries(transitionFiles)) if (assetKey(p, "/transitions/") === key) return url;
  return null;
}

export function titleTemplates(): TitleTemplate[] {
  return Object.entries(titleFiles)
    .map(([path, url]) => {
      const file = assetKey(path, "/titles/");
      return { id: file.replace(/\.svg$/, ""), name: displayNameFromFile(file), url };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
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
