/**
 * Globals for type-checking the Premiere Pro host scripts
 * (extension/host/ppro/*.jsx, `npm run typecheck:jsx:ppro`) on top of
 * types-for-adobe Premiere/24.0 and its ExtendScript (ES3) lib. Only what
 * those scripts use and the typings lack or get wrong, each with its source.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- ExtendScript runtime values (TASTE, DOM results) are untyped. */

// ---------------------------------------------------------------------------
// The Zenvi Link runtime (extension/host/common/*.jsx).

interface ZenviContext {
  tool: string;
  warnings: string[];
  warn(message: string): void;
  changed(): void;
}

interface ZenviResult {
  zenviResult: true;
  status: string;
  summary: string;
  data: unknown;
  undoSteps?: number | null;
}

interface ZenviLinkRuntime {
  version: string;
  host: string | null;
  TASTE: any;
  CATALOG: any;
  ppro: any;
  adapter: any;
  ERROR_CODES: string[];
  color: { toRgb(value: unknown, key?: string): number[]; toHex(rgb: number[]): string };
  register(name: string, fn: (args: any, ctx: ZenviContext) => ZenviResult, options?: { mutating?: boolean; undoTitle?: string }): void;
  refuse(code: string, message: string): Error;
  fail(code: string, message: string): Error;
  ok(summary: string, data?: unknown): ZenviResult;
  applied(summary: string, data?: unknown, undoSteps?: number | null): ZenviResult;
  unchanged(summary: string, data?: unknown): ZenviResult;
  required(args: any, key: string, type?: string): any;
  optional(args: any, key: string, type: string, fallback: any): any;
  oneOf<T>(key: string, value: T, allowed: readonly unknown[]): T;
  inRange(key: string, value: number, min: number | null, max: number | null): number;
  snapToFrame(seconds: number, fps: number, ctx: ZenviContext | null, label?: string): number;
  has(object: unknown, key: string): boolean;
  /** The DOM object has member `name` (host methods may report typeof "object"; never throws). */
  hasMethod(object: unknown, name: string): boolean;
  /** Index of `value` in an array (===), or -1: there is no Array.prototype.indexOf. */
  indexOf(list: ArrayLike<unknown>, value: unknown): number;
  /** There is no String.prototype.trim. */
  trim(text: unknown): string;
  /** Survives the bundle being evaluated again (CEP does that when the panel opens). */
  state: { loads: number; config: { temp_dir?: string } };
  configure(json: unknown): string;
  /** Zenvi Link's temp folder (fsName), created if missing. */
  tempDir(): string;
  tempFile(prefix?: string, extension?: string): string;
  isArray(value: unknown): boolean;
  isObject(value: unknown): boolean;
  each<T>(list: ArrayLike<T>, fn: (item: T, index: number) => void): void;
  map<T, U>(list: ArrayLike<T>, fn: (item: T, index: number) => U): U[];
  filter<T>(list: ArrayLike<T>, fn: (item: T, index: number) => boolean): T[];
  round(value: number, digits?: number): number;
  plural(count: number, word: string, pluralWord?: string): string;
  stringify(value: unknown): string;
  dispatch(name: string, argsJson: string): string;
}

declare const ZenviLink: ZenviLinkRuntime;

// ---------------------------------------------------------------------------
// ES5 pieces the host scripts get from common/00-json2.jsx and 01-polyfills.jsx.

interface JSONShim {
  parse(text: string): any;
  stringify(value: unknown, replacer?: unknown, space?: string | number): string;
}
declare const JSON: JSONShim;

interface ObjectConstructor {
  keys(object: object): string[];
}

interface ArrayLike<T> {
  readonly length: number;
  readonly [n: number]: T;
}

// ---------------------------------------------------------------------------
// The QE DOM. Adobe does not document it; names come from pymiere's
// reflection of Premiere's qe object (qe.project: getActiveSequence,
// getSequenceAt, numSequences, get{Video,Audio}{Effect,Transition}ByName and
// ...List, newSequence, undoStackIndex), PProPanel (qe.project.newSequence,
// getActiveSequence) and live-tested projects (premiere-pro-mcp,
// Adobe_Premiere_Pro_MCP: guid, track items with gaps, razor(timecode),
// addTransition and setSpeed argument lists, exportFramePNG(timecode, path)).

interface QETime {
  ticks: string;
  secs?: number;
  timecode?: string;
}

interface QETrackItem {
  /** "Clip", or "Empty" for a gap. */
  type: string;
  name: string;
  start: QETime;
  end: QETime;
  addVideoEffect(effect: unknown): unknown;
  addAudioEffect(effect: unknown): unknown;
  addTransition(transition: unknown, atStart?: boolean, duration?: string, offset?: string, alignment?: number, singleSided?: boolean, alignToVideo?: boolean): unknown;
  /** (multiplier, new duration in ticks, reverse, maintain pitch, ripple); not in every build. */
  setSpeed?(speed: number, durationTicks: string, reverse: boolean, maintainPitch: boolean, ripple: boolean): unknown;
}

interface QETrack {
  numItems: number;
  getItemAt(index: number): QETrackItem;
  razor(timecode: string): unknown;
}

interface QESequence {
  /** The DOM Sequence.sequenceID. */
  guid: string;
  name: string;
  getVideoTrackAt(index: number): QETrack;
  getAudioTrackAt(index: number): QETrack;
  /** Appends ".png" to `path` itself. */
  exportFramePNG?(timecode: string, path: string): unknown;
}

interface QEProject {
  numSequences: number;
  getActiveSequence(): QESequence;
  getSequenceAt(index: number): QESequence;
  getVideoEffectByName(name: string): unknown;
  getAudioEffectByName(name: string): unknown;
  getVideoTransitionByName(name: string): unknown;
  getAudioTransitionByName(name: string): unknown;
  getVideoEffectList?(): unknown;
  getAudioEffectList?(): unknown;
  getVideoTransitionList?(): unknown;
  getAudioTransitionList?(): unknown;
  newSequence(name: string, presetPath: string): unknown;
  undoStackIndex?(): number;
}

interface QERoot {
  project: QEProject;
}

declare const qe: QERoot;

// ---------------------------------------------------------------------------
// Premiere DOM members missing from (or narrower in) types-for-adobe
// Premiere/24.0, per the Premiere Pro Scripting Guide
// (ppro-scripting.docsforadobe.dev) and PProPanel.

interface Application {
  /** The app bundle on macOS, the install folder on Windows (guide: app.path). */
  readonly path: string;
}

interface Project {
  /** Guide: Project.newSequence(name, pathToSequencePreset). */
  newSequence?(name: string, presetPath: string): Sequence;
}

interface Sequence {
  /** Guide and PProPanel; types-for-adobe calls it performCutDetectionOnSelection. */
  performSceneEditDetectionOnSelection(action: string, applyCutsToLinkedAudio: boolean, sensitivity: string): boolean;
  /** Guide: the caption format is optional (default subtitle). */
  createCaptionTrack(projectItem: ProjectItem, startAtTime: number): unknown;
}

interface ProjectItem {
  /** Guide: ProjectItem.isOffline(). */
  isOffline(): boolean;
}

interface MarkerCollection {
  /** Guide: createMarker(time) with time in seconds. */
  createMarker(time: number): Marker;
}

interface ComponentParam {
  /** Guide: these take the keyframe Time (types-for-adobe declares them without parameters). */
  addKey(time: Time): unknown;
  removeKey(time: Time): unknown;
  keyExistsAtTime(time: Time): boolean;
  getValueAtTime(time: Time): any;
  setInterpolationTypeAtKey(time: Time, interpolationType: number, updateUI?: boolean | number): unknown;
}
