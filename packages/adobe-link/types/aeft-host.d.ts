/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments arrive as untyped JSON, and ExtendScript values are dynamic */

/**
 * Types for `npm run typecheck:jsx` (tsconfig.jsx-aeft.json): the After
 * Effects host scripts are checked (checkJs) against types-for-adobe's After
 * Effects 26.0 DOM. This
 * file adds only what those typings cannot know: the ES5 members the host
 * scripts get from common/01-polyfills.jsx and common/00-json2.jsx, and our
 * own runtime (ZenviLink, common/10-zenvi.jsx) with the ZenviLink.ae helpers
 * the aeft/*.jsx files define. Every helper is listed by name, so a typo in a
 * helper name is an error too.
 */

// ---------------------------------------------------------------------------
// ES5 members the host scripts polyfill (ExtendScript is ECMAScript 3).

interface Array<T> {
  indexOf(searchElement: T, fromIndex?: number): number;
}

interface ArrayConstructor {
  isArray(value: unknown): boolean;
}

interface String {
  trim(): string;
}

interface ObjectConstructor {
  keys(object: object): string[];
}

/** json2.js (common/00-json2.jsx). */
interface JSON {
  parse(text: string): any;
  stringify(value: unknown): string;
}
declare const JSON: JSON;

// ---------------------------------------------------------------------------
// The ZenviLink runtime.

interface ZenviContext {
  tool: string;
  warnings: string[];
  didChange: boolean;
  warn(message: string): void;
  changed(): void;
}

interface ZenviResult {
  zenviResult: true;
  status: "ok" | "applied" | "unchanged";
  summary: string;
  data: object;
  undoSteps: number | null | undefined;
}

type ZenviTool = (args: any, ctx: ZenviContext) => ZenviResult;

interface ZenviAdapter {
  undoStepsWhenApplied: number | null;
  runMutating(title: string, fn: () => ZenviResult): ZenviResult;
  partialChangeWarning(title: string): string;
  info(): object;
}

/** A property found by path: the property and its display / match name paths. */
interface ZenviPropertyTarget {
  property: Property;
  path: string;
  match_path: string;
}

interface ZenviCurve {
  name: string;
  type: "bezier" | "linear" | "hold";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface ZenviKey {
  time: number;
  value: any;
  curve: ZenviCurve;
}

interface ZenviRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ZenviSafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
  vertical: boolean;
}

interface ZenviPlannedImport {
  path: string;
  file: File;
  key: string;
  options: ImportOptions;
}

/** ZenviLink.ae: helpers from aeft/00-aeft-core.jsx and the other aeft/*.jsx files. */
interface ZenviAe {
  ABSOLUTE_PATH: RegExp;
  BLEND_MODES: string[];
  MOTION_PRESETS: string[];
  TEXT_STYLES: string[];

  // 00-aeft-core.jsx
  projectPath(): string | null;
  requireProject(): Project;
  activeComp(): CompItem | null;
  requireActiveComp(): CompItem;
  findItem(id: number): _ItemClasses;
  findComp(ref: any): CompItem;
  layerId(layer: Layer): number | null;
  findLayer(comp: CompItem | null, ref: any): Layer;
  itemType(item: any): string;
  layerType(layer: Layer): string;
  layerRef(layer: Layer): { layer_id: number | null; comp_id: number | null; layer_index: number; name: string; type: string; [key: string]: any };
  compSummary(comp: CompItem): { [key: string]: any };
  snapTime(comp: CompItem, seconds: number, ctx: ZenviContext | null, label?: string): number;
  color(value: any, key?: string): [number, number, number];
  renderStatusName(status: RQItemStatus): string;
  renderOutputPath(item: RenderQueueItem): string | null;

  // 01-aeft-util.jsx
  blendModeValue(name: string): BlendingMode;
  blendModeName(value: BlendingMode): string | null;
  trackMatteValue(name: string): TrackMatteType;
  trackMatteName(value: TrackMatteType): string | null;
  qualityValue(name: string): LayerQuality;
  qualityName(value: LayerQuality): string | null;
  maskModeValue(name: string): MaskMode;
  maskModeName(value: MaskMode): string | null;
  lightTypeValue(name: string): LightType;
  justificationValue(name: string): ParagraphJustification;
  justificationName(value: ParagraphJustification): string;
  interpolationName(value: KeyframeInterpolationType): string | null;
  ranged(spec: { default: number; range: number[] }, intensity?: number | null): number;
  typeScale(comp: CompItem): number;
  isVertical(comp: CompItem): boolean;
  safeArea(comp: CompItem): ZenviSafeArea;
  findRootFolder(name: string): FolderItem | null;
  findOrCreateFolder(name: string): FolderItem;
  uniqueCompName(name: string, ctx: ZenviContext | null): string;
  requireUnlocked(layer: Layer): void;
  compTime(comp: CompItem, seconds: number, ctx: ZenviContext | null, label: string): number;
  requireAbsolutePath(path: any, key: string): string;
  pathKey(path: string): string;
  tempFolder(name: string): Folder;
  safeFileName(name: string): string;
  isoTime(date: Date): string;
  fileStamp(date: Date): string;
  fpsRational(fps: number): { num: number; den: number };
  clip(text: any, max: number): string;

  // 02-aeft-props.jsx
  isLeaf(property: any): boolean;
  childNames(group: PropertyGroup | Layer): string;
  resolveProperty(layer: Layer, path: any): { property: any; path: string; match_path: string };
  resolveLeaf(layer: Layer, path: any): ZenviPropertyTarget;
  pathOf(property: PropertyBase): string;
  valueDimensions(property: Property): number;
  colorValue(raw: any, key: string): [number, number, number, number];
  textValue(text: any): string;
  shapeValue(raw: any, key: string): Shape;
  toValue(property: Property, raw: any, key: string, current?: any): any;
  textDocumentJson(doc: TextDocument): { [key: string]: any };
  exportValue(value: any): any;
  removeAllKeys(property: Property): number;
  removeKeysBetween(property: Property, start: number, end: number): number;
  curve(easing: any, key: string): ZenviCurve;
  easeDimensions(property: Property): number;
  segmentEase(curve: ZenviCurve, deltas: number[], dt: number, spatial: boolean): { outSpeed: number[]; outInfluence: number; inSpeed: number[]; inInfluence: number };
  writeKeyframes(property: Property, keys: ZenviKey[], options: { replace?: boolean; spatial?: string }, ctx: ZenviContext): { index: number; time: number; value: unknown; easing: string | null }[];
  keyframesJson(property: Property, max: number): object[];

  // 03-aeft-text.jsx
  textStyle(style: string): { size: number; bold: boolean; leading: number; tracking: number };
  defaultTextStyle(placement: string): string;
  isAllCaps(text: string): boolean;
  styleTracking(style: string, text: string): number;
  fontAvailable(postscriptName: string): boolean | null;
  fontCandidates(requested: string | null, bold: boolean): string[];
  setTextDocument(property: { value: TextDocument; setValue(value: TextDocument): void }, spec: { [key: string]: any }, ctx: ZenviContext): { font: string; size: number };
  breakLines(text: string, maxChars: number): { text: string; lines: number; broke: boolean };
  setPoint(property: Property, x: number, y: number): void;
  fitTextWidth(layer: Layer, property: Property, maxWidth: number, time: number, ctx: ZenviContext): number;
  placeTextBlock(comp: CompItem, layers: Layer[], placement: string, align: string, firstSize: number, time: number, ctx: ZenviContext): { [key: string]: unknown; inside_title_safe: boolean };
  hasFootageBelow(comp: CompItem, layer: Layer): boolean;
  addTextShadow(comp: CompItem, layer: Layer, ctx: ZenviContext): PropertyGroup | null;

  // 04-aeft-fx.jsx
  installedEffects(): { displayName: string; matchName: string; version: string; category: string }[];
  findEffectDef(name: string): { displayName: string; matchName: string; version: string; category: string };
  findEffectParam(effect: PropertyGroup, key: string): Property | null;
  effectParamNames(effect: PropertyGroup): string;
  effectParam(effect: PropertyGroup, matchName: string, displayName: string): Property;
  effectStack(layer: Layer): PropertyGroup;
  addEffect(layer: Layer, matchName: string, name?: string | null): PropertyGroup;
  removeEffectsNamed(layer: Layer, name: string): number;
  findLayerEffect(layer: Layer, ref: any): PropertyGroup;
  effectsJson(layer: Layer): { index: number; name: string; match_name: string; enabled: boolean }[];

  // 10-aeft-inspect.jsx
  itemSummary(item: _ItemClasses): { [key: string]: any };
  walkProperties(group: PropertyGroup | Layer, fn: (property: Property, path: string) => void): void;
  animatedPaths(layer: Layer): { keyed: string[]; expressions: string[] };
  layerSummary(layer: Layer): { [key: string]: any };
  compSettings(comp: CompItem): { [key: string]: any };
  markersJson(property: Property): object[];

  // 15-aeft-capture.jsx
  readPngInfo(file: File): { valid: boolean; width?: number; height?: number; complete: boolean; size: number } | null;
  waitForPng(file: File, timeoutMs: number): { valid: boolean; width?: number; height?: number; complete: boolean; size: number };

  // 25-aeft-import.jsx
  footageByPath(): { [key: string]: FootageItem };
  planImports(paths: string[], sequence: boolean): ZenviPlannedImport[];
  importPlanned(planned: ZenviPlannedImport[], folderName: string, dedupe: boolean): { path: string; item: FootageItem; reused: boolean }[];

  // 45-aeft-motion.jsx
  applyMotionPreset(comp: CompItem, layer: Layer, name: string, options: { [key: string]: any }, ctx: ZenviContext): { [key: string]: any };

  // 60-aeft-render.jsx
  pickTemplate(templates: string[], preset: string, ctx: ZenviContext): { template: string; codec: string; ext: string | null; preset: string | null };

  // 70-aeft-project.jsx
  outsideUndoGroup<T>(title: string, fn: () => T): T;
}

interface ZenviLinkApi {
  version: string;
  TASTE: any;
  CATALOG: { [tool: string]: { title: string; mutating: boolean } };
  protocol: number;
  contract: number;
  host: string | null;
  adapter: ZenviAdapter;
  ERROR_CODES: string[];
  ae: ZenviAe;

  has(object: unknown, key: string): boolean;
  isArray(value: unknown): boolean;
  isObject(value: unknown): boolean;
  each<T>(list: ArrayLike<T>, fn: (item: T, index: number) => void): void;
  map<T, U>(list: ArrayLike<T>, fn: (item: T, index: number) => U): U[];
  filter<T>(list: ArrayLike<T>, fn: (item: T, index: number) => boolean): T[];
  round(value: number, digits?: number): number;
  plural(count: number, word: string, pluralWord?: string): string;

  refuse(code: string, message: string): Error;
  fail(code: string, message: string): Error;
  ok(summary: string, data?: object): ZenviResult;
  applied(summary: string, data?: object, undoSteps?: number): ZenviResult;
  unchanged(summary: string, data?: object): ZenviResult;

  required(args: unknown, key: string, type: string): any;
  optional(args: unknown, key: string, type: string, fallback: any): any;
  oneOf<T>(key: string, value: T, allowed: T[]): T;
  inRange(key: string, value: number, min: number | null, max: number | null): number;

  snapToFrame(seconds: number, fps: number, ctx: ZenviContext | null, label?: string): number;
  color: { toRgb(value: unknown, key?: string): [number, number, number]; toHex(rgb: ArrayLike<number>): string };

  register(name: string, fn: ZenviTool, options?: { mutating?: boolean; undoTitle?: string }): void;
  stringify(value: unknown): string;
  dispatch(name: string, argsJson: string): string;
  listTools(): string;
  hostInfo(): string;
}

/** ArrayLike for ES3 typings that do not have it. */
interface ArrayLike<T> {
  readonly length: number;
  readonly [n: number]: T;
}

declare const ZenviLink: ZenviLinkApi;
