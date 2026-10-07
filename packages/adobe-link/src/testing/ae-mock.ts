/**
 * A minimal After Effects DOM for running the host scripts under Node
 * (`loadHostScript("aeft", mock.globals)`). It follows the After Effects
 * Scripting Guide's names and its 1-based collections, enforces the rules
 * that trip scripts up in the real app (setValue on a keyframed property,
 * ease arrays sized per dimension, influence 0.1–100, undo group pairing),
 * and records what scripts do so tests can assert it.
 *
 * Grow it with the tools: add the members a new tool touches, with the real
 * names and behaviour. Enum values are distinct numbers like the real ones;
 * scripts must compare against the enums, never literals.
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { parse as parseJs } from "acorn";
import { BIND_REALM, type HostGlobals, type Realm } from "./realm.js";
import { createExtendScriptMock, type ExtendScriptMock, type ExtendScriptMockOptions, type FileMock } from "./extendscript-mock.js";

// ---------------------------------------------------------------------------
// Enums

export const KeyframeInterpolationType = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 } as const;

export const PropertyValueType = {
  NO_VALUE: 6412,
  ThreeD_SPATIAL: 6413,
  ThreeD: 6414,
  TwoD_SPATIAL: 6415,
  TwoD: 6416,
  OneD: 6417,
  COLOR: 6418,
  CUSTOM_VALUE: 6419,
  MARKER: 6420,
  LAYER_INDEX: 6421,
  MASK_INDEX: 6422,
  SHAPE: 6423,
  TEXT_DOCUMENT: 6424,
} as const;

export const PropertyType = { PROPERTY: 6212, NAMED_GROUP: 6213, INDEXED_GROUP: 6214 } as const;

/** Values as in types-for-adobe AfterEffects/26.0 (SILHOUETE_ALPHA is After Effects' own spelling). */
export const BlendingMode = {
  NORMAL: 5212,
  DISSOLVE: 5213,
  DANCING_DISSOLVE: 5214,
  DARKEN: 5215,
  MULTIPLY: 5216,
  LINEAR_BURN: 5217,
  COLOR_BURN: 5218,
  CLASSIC_COLOR_BURN: 5219,
  ADD: 5220,
  LIGHTEN: 5221,
  SCREEN: 5222,
  LINEAR_DODGE: 5223,
  COLOR_DODGE: 5224,
  CLASSIC_COLOR_DODGE: 5225,
  OVERLAY: 5226,
  SOFT_LIGHT: 5227,
  HARD_LIGHT: 5228,
  LINEAR_LIGHT: 5229,
  VIVID_LIGHT: 5230,
  PIN_LIGHT: 5231,
  HARD_MIX: 5232,
  DIFFERENCE: 5233,
  CLASSIC_DIFFERENCE: 5234,
  EXCLUSION: 5235,
  HUE: 5236,
  SATURATION: 5237,
  COLOR: 5238,
  LUMINOSITY: 5239,
  STENCIL_ALPHA: 5240,
  STENCIL_LUMA: 5241,
  SILHOUETE_ALPHA: 5242,
  SILHOUETTE_LUMA: 5243,
  ALPHA_ADD: 5244,
  LUMINESCENT_PREMUL: 5245,
  LIGHTER_COLOR: 5246,
  DARKER_COLOR: 5247,
  SUBTRACT: 5248,
  DIVIDE: 5249,
} as const;

export const TrackMatteType = { NO_TRACK_MATTE: 5012, ALPHA: 5013, ALPHA_INVERTED: 5014, LUMA: 5015, LUMA_INVERTED: 5016 } as const;

export const LayerQuality = { WIREFRAME: 4612, DRAFT: 4613, BEST: 4614 } as const;

export const ImportAsType = { COMP_CROPPED_LAYERS: 3812, FOOTAGE: 3813, COMP: 3814, PROJECT: 3815 } as const;

export const RQItemStatus = {
  WILL_CONTINUE: 3012,
  NEEDS_OUTPUT: 3013,
  UNQUEUED: 3014,
  QUEUED: 3015,
  RENDERING: 3016,
  USER_STOPPED: 3017,
  ERR_STOPPED: 3018,
  DONE: 3019,
} as const;

export const ParagraphJustification = {
  LEFT_JUSTIFY: 7413,
  RIGHT_JUSTIFY: 7414,
  CENTER_JUSTIFY: 7415,
  FULL_JUSTIFY_LASTLINE_LEFT: 7416,
  FULL_JUSTIFY_LASTLINE_RIGHT: 7417,
  FULL_JUSTIFY_LASTLINE_CENTER: 7418,
  FULL_JUSTIFY_LASTLINE_FULL: 7419,
} as const;

export const MaskMode = { NONE: 6812, ADD: 6813, SUBTRACT: 6814, INTERSECT: 6815, LIGHTEN: 6816, DARKEN: 6817, DIFFERENCE: 6818 } as const;

export const LightType = { PARALLEL: 4412, SPOT: 4413, POINT: 4414, AMBIENT: 4415 } as const;

export const CloseOptions = { DO_NOT_SAVE_CHANGES: 1212, PROMPT_TO_SAVE_CHANGES: 1213, SAVE_CHANGES: 1214 } as const;

// ---------------------------------------------------------------------------
// Value classes scripts construct themselves

export class KeyframeEase {
  constructor(
    public speed: number,
    public influence: number,
  ) {
    if (!(influence >= 0.1 && influence <= 100)) {
      throw new Error(`After Effects error: KeyframeEase influence ${influence} is out of range [0.1, 100]`);
    }
  }
}

export class MarkerValue {
  duration = 0;
  chapter = "";
  url = "";
  frameTarget = "";
  cuePointName = "";
  eventCuePoint = false;
  label = 0;
  protectedRegion = false;
  private params: Record<string, string> = {};

  constructor(
    public comment = "",
    chapter?: string,
    url?: string,
    frameTarget?: string,
    cuePointName?: string,
  ) {
    if (chapter !== undefined) this.chapter = chapter;
    if (url !== undefined) this.url = url;
    if (frameTarget !== undefined) this.frameTarget = frameTarget;
    if (cuePointName !== undefined) this.cuePointName = cuePointName;
  }

  getParameters(): Record<string, string> {
    return { ...this.params };
  }

  setParameters(params: Record<string, string>): void {
    this.params = { ...params };
  }
}

export class TextDocument {
  font = "ArialMT";
  fontSize = 36;
  private fillValue: number[] = [1, 1, 1];
  private strokeValue: number[] = [0, 0, 0];
  private strokeWidthValue = 0;
  strokeOverFill = false;
  applyFill = true;
  applyStroke = false;
  tracking = 0;
  leading = 0;
  autoLeading = true;
  justification: number = ParagraphJustification.LEFT_JUSTIFY;
  boxText = false;
  pointText = true;
  boxTextSize: number[] = [0, 0];
  boxTextPos: number[] = [0, 0];
  allCaps = false;
  smallCaps = false;
  fauxBold = false;
  fauxItalic = false;
  baselineShift = 0;
  horizontalScale = 1;
  verticalScale = 1;

  constructor(public text = "") {}

  /** Throws on read unless applyFill (Scripting Guide); setting it turns applyFill on. */
  get fillColor(): number[] {
    if (!this.applyFill) throw new Error("After Effects error: fillColor is unavailable because applyFill is false");
    return this.fillValue;
  }

  set fillColor(value: number[]) {
    this.fillValue = Array.from(value);
    this.applyFill = true;
  }

  get strokeColor(): number[] {
    if (!this.applyStroke) throw new Error("After Effects error: strokeColor is unavailable because applyStroke is false");
    return this.strokeValue;
  }

  set strokeColor(value: number[]) {
    this.strokeValue = Array.from(value);
    this.applyStroke = true;
  }

  get strokeWidth(): number {
    if (!this.applyStroke) throw new Error("After Effects error: strokeWidth is unavailable because applyStroke is false");
    return this.strokeWidthValue;
  }

  set strokeWidth(value: number) {
    this.strokeWidthValue = Math.max(0.01, value);
  }

  resetCharStyle(): void {
    this.font = "ArialMT";
    this.fontSize = 36;
    this.fillColor = [1, 1, 1];
    this.tracking = 0;
  }

  resetParagraphStyle(): void {
    this.justification = ParagraphJustification.LEFT_JUSTIFY;
  }
}

export class Shape {
  vertices: number[][] = [];
  inTangents: number[][] = [];
  outTangents: number[][] = [];
  closed = true;
  featherSegLocs: number[] = [];
  featherRelSegLocs: number[] = [];
  featherRadii: number[] = [];
}

export class ImportOptions {
  importAs: number = ImportAsType.FOOTAGE;
  sequence = false;
  forceAlphabetical = false;
  file: FileMock | null = null;

  constructor(file?: FileMock) {
    if (file) this.file = file;
  }

  /** Media files import as footage; layered files (PSD, AI) and projects also as comps. */
  canImportAs(type: number): boolean {
    const name = this.file ? this.file.displayName : "";
    if (type === ImportAsType.FOOTAGE) return /\.(mov|mp4|m4v|avi|mxf|webm|wav|mp3|aif|aiff|m4a|png|jpe?g|tiff?|psd|ai|gif|bmp|exr|svg|dpx|tga)$/i.test(name);
    if (type === ImportAsType.COMP || type === ImportAsType.COMP_CROPPED_LAYERS) return /\.(psd|ai)$/i.test(name);
    if (type === ImportAsType.PROJECT) return /\.aepx?$/i.test(name);
    return false;
  }
}

/**
 * A deep copy of a property value into this module's arrays. Arrays coming
 * from a script are realm arrays without ES5 methods, so never call
 * `.map`/`.every` on an argument before copying it with Array.from.
 */
function copyValue<T>(value: T): T {
  if (Array.isArray(value)) return Array.from(value as unknown[], (v) => copyValue(v)) as T;
  if (value instanceof TextDocument) return Object.assign(new TextDocument(value.text), value) as T;
  if (value instanceof MarkerValue) {
    const copy = Object.assign(new MarkerValue(value.comment), value);
    copy.setParameters(value.getParameters());
    return copy as T;
  }
  if (value instanceof Shape) return Object.assign(new Shape(), JSON.parse(JSON.stringify(value))) as T;
  return value;
}

// ---------------------------------------------------------------------------
// State shared by one mock's objects

export interface UndoCall {
  kind: "begin" | "end";
  title?: string;
  depth: number;
}

export class AeMockState {
  nextItemId = 1;
  /** Layer ids start far from indexes, so tests catch id/index mix-ups. */
  nextLayerId = 101;
  undoDepth = 0;
  /** Every beginUndoGroup / endUndoGroup call. */
  readonly undoCalls: UndoCall[] = [];
  /** app.executeCommand ids. */
  readonly commands: number[] = [];
  /** Files written by CompItem.saveFrameToPng (size after the comp's resolution factor). */
  readonly savedFrames: { comp: number; time: number; path: string; width: number; height: number; resolutionFactor: number[] }[] = [];
  /** Effects `addProperty` and `app.effects` know (DEFAULT_EFFECTS plus registerEffect). */
  readonly effects: EffectDef[] = [];
  /** PostScript names of installed fonts (`app.fonts` in 24+; before 24 other fonts do not take). */
  readonly fonts = new Set<string>();
  /** `$.sleep` calls before a saveFrameToPng file has its content (the file exists, empty, before that). */
  frameWriteDelay = 2;
  /** The undo depth at each `app.executeCommand` call. */
  readonly commandDepths: number[] = [];
  /** Messages passed to `alert` (modal in After Effects: a script waits there until someone clicks OK). */
  readonly alerts: string[] = [];
  /** The undo depth at each render queue change (add, remove, the Render checkbox): 0 = outside any undo group. */
  readonly queueChangeDepths: number[] = [];
  /** Whether Adobe Media Encoder is installed (renderQueue.canQueueInAME also needs a queued item). */
  canQueueInAME = true;
  /** Output module template names (default: what this version ships). */
  outputTemplates: string[] = [];

  constructor(
    readonly es: ExtendScriptMock,
    readonly majorVersion: number,
  ) {}

  /** Top-level undo group titles, in order. */
  get undoGroups(): string[] {
    return this.undoCalls.filter((call) => call.kind === "begin" && call.depth === 0).map((call) => call.title ?? "");
  }

  array<T>(items: readonly T[]): T[] {
    return this.es.state.link.array(items);
  }
}

// ---------------------------------------------------------------------------
// 1-based collections

/** Makes `collection[1]…[n]` work like After Effects' 1-based collections. */
function oneBased<T extends object>(target: T, list: () => readonly unknown[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) return list()[Number(prop) - 1];
      return Reflect.get(obj, prop, receiver);
    },
  });
}

// ---------------------------------------------------------------------------
// Properties

export interface MockKey {
  time: number;
  value: unknown;
  inInterpolation: number;
  outInterpolation: number;
  inEase: KeyframeEase[];
  outEase: KeyframeEase[];
  inSpatialTangent?: number[];
  outSpatialTangent?: number[];
  temporalAutoBezier: boolean;
  temporalContinuous: boolean;
  spatialAutoBezier: boolean;
  spatialContinuous: boolean;
  selected: boolean;
}

/**
 * After Effects reports a syntax error in `expressionError` as soon as an
 * expression is set; the mock checks syntax with acorn (runtime errors such
 * as unknown functions are not simulated).
 */
function expressionSyntaxError(source: string): string {
  try {
    parseJs(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
    return "";
  } catch (error) {
    return `Error: SyntaxError: ${(error as Error).message}`;
  }
}

const KEY_TIME_EPSILON = 1e-6;

export abstract class PropertyBase {
  parentProperty: PropertyGroup | null = null;

  /** The mock state of the layer this property belongs to (for realm arrays). */
  protected get mockState(): AeMockState | undefined {
    return stateOf(this);
  }

  /** A value as scripts see it: arrays become realm arrays (no ES5 methods), deep. */
  protected exported<T>(value: T): T {
    const state = this.mockState;
    const out = (v: unknown): unknown => (Array.isArray(v) ? (state ? state.array(v.map(out)) : v.map(out)) : v);
    return out(copyValue(value)) as T;
  }

  enabled = true;
  selected = false;
  readonly isEffect: boolean = false;
  readonly isMask: boolean = false;
  abstract readonly propertyType: number;

  constructor(
    public name: string,
    readonly matchName: string,
  ) {}

  get propertyIndex(): number {
    return this.parentProperty ? this.parentProperty.children.indexOf(this) + 1 : 0;
  }

  get propertyDepth(): number {
    return this.parentProperty ? this.parentProperty.propertyDepth + 1 : 0;
  }

  /** The group `countUp` levels up (default 1). */
  propertyGroup(countUp = 1): PropertyGroup | null {
    let group: PropertyGroup | null = this.parentProperty;
    for (let i = 1; i < countUp && group; i += 1) group = group.parentProperty;
    return group;
  }

  remove(): void {
    if (!this.parentProperty) throw new Error("After Effects error: cannot remove a top-level property");
    const siblings = this.parentProperty.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentProperty = null;
  }
}

export interface PropertyOptions {
  valueType?: number;
  /** Spatial (position-like): one ease per key whatever the dimensions. */
  spatial?: boolean;
  canVaryOverTime?: boolean;
  min?: number;
  max?: number;
  /** Returns why the property cannot take a value right now (After Effects hides it), or null. */
  guard?: () => string | null;
}

export class Property extends PropertyBase {
  readonly propertyType = PropertyType.PROPERTY;
  readonly propertyValueType: number;
  readonly isSpatial: boolean;
  readonly canVaryOverTime: boolean;
  readonly hasMin: boolean;
  readonly hasMax: boolean;
  readonly minValue: number | undefined;
  readonly maxValue: number | undefined;
  expressionError = "";
  private expressionOn = false;
  canSetExpression = true;
  dimensionsSeparated = false;
  readonly keys: MockKey[] = [];
  private staticValue: unknown;
  private expressionText = "";

  /** Setting an expression enables it and reports syntax errors in expressionError, like After Effects. */
  get expression(): string {
    return this.expressionText;
  }

  set expression(value: string) {
    if (!this.canSetExpression) throw new Error(`After Effects error: "${this.name}" cannot have an expression`);
    this.expressionText = String(value);
    this.expressionError = this.expressionText === "" ? "" : expressionSyntaxError(this.expressionText);
    // A valid expression enables itself; one with an error stays off.
    this.expressionOn = this.expressionText !== "" && this.expressionError === "";
  }

  get expressionEnabled(): boolean {
    return this.expressionOn;
  }

  /** Only a valid expression can be switched on (Scripting Guide, Property.expressionEnabled). */
  set expressionEnabled(value: boolean) {
    if (value && (this.expressionText === "" || this.expressionError !== "")) {
      throw new Error(`After Effects error: can't enable the expression on "${this.name}": ${this.expressionError || "it is empty"}`);
    }
    this.expressionOn = value;
  }

  /** Position is the leader of X/Y/Z Position; when its dimensions are separated only the followers take values. */
  get isSeparationLeader(): boolean {
    return this.matchName === "ADBE Position";
  }

  private checkNotSeparated(): void {
    if (this.dimensionsSeparated && this.isSeparationLeader) {
      throw new Error(`After Effects error: "${this.name}" has separated dimensions; set X Position and Y Position instead`);
    }
    const hidden = this.options.guard?.();
    if (hidden) throw new Error(`After Effects error: can't set "${this.name}": ${hidden}`);
  }

  /** Before After Effects 24 a font that is not installed does not take: the document keeps its font. */
  private withInstalledFont(value: unknown): unknown {
    const state = this.mockState;
    if (!(value instanceof TextDocument) || !state || state.majorVersion >= 24 || state.fonts.has(value.font)) return value;
    const previous = (this.keys.length ? (this.keys[0] as MockKey).value : this.staticValue) as TextDocument;
    const copy = copyValue(value);
    copy.font = previous.font;
    return copy;
  }

  /** A deep copy (Layer.duplicate). */
  clone(): Property {
    const copy = new Property(this.name, this.matchName, this.staticValue, {
      ...this.options,
      valueType: this.propertyValueType,
      spatial: this.isSpatial,
      canVaryOverTime: this.canVaryOverTime,
    });
    copy.enabled = this.enabled;
    copy.dimensionsSeparated = this.dimensionsSeparated;
    copy.canSetExpression = this.canSetExpression;
    if (this.expressionText) copy.expression = this.expressionText;
    if (copy.expressionEnabled !== this.expressionEnabled) copy.expressionEnabled = this.expressionEnabled;
    for (const key of this.keys) copy.keys.push({ ...key, value: copyValue(key.value), inEase: [...key.inEase], outEase: [...key.outEase] });
    return copy;
  }

  /** Text, markers and layer/mask references only hold. */
  isInterpolationTypeValid(type: number): boolean {
    const holdOnly: number[] = [PropertyValueType.TEXT_DOCUMENT, PropertyValueType.MARKER, PropertyValueType.LAYER_INDEX, PropertyValueType.MASK_INDEX];
    if (this.propertyValueType === PropertyValueType.NO_VALUE || this.propertyValueType === PropertyValueType.CUSTOM_VALUE) return false;
    if (holdOnly.includes(this.propertyValueType)) return type === KeyframeInterpolationType.HOLD;
    return Object.values(KeyframeInterpolationType).includes(type as never);
  }

  private readonly options: PropertyOptions;

  constructor(name: string, matchName: string, value: unknown, options: PropertyOptions = {}) {
    super(name, matchName);
    this.options = options;
    this.staticValue = copyValue(value);
    this.propertyValueType = options.valueType ?? inferValueType(value);
    this.isSpatial = options.spatial ?? false;
    this.canVaryOverTime = options.canVaryOverTime ?? true;
    this.hasMin = options.min !== undefined;
    this.hasMax = options.max !== undefined;
    this.minValue = options.min;
    this.maxValue = options.max;
  }

  /** Static value, or the value at time 0 when keyframed (After Effects: at the comp's current time). */
  get value(): unknown {
    return this.exported(this.keys.length > 0 ? this.interpolate(0) : this.staticValue);
  }

  get numKeys(): number {
    return this.keys.length;
  }

  get isTimeVarying(): boolean {
    return this.keys.length > 0 || (this.expressionEnabled && this.expression !== "");
  }

  /** Ease arrays have one entry per dimension, except spatial and 1D properties (one). */
  get easeDimensions(): number {
    if (this.isSpatial) return 1;
    if (this.propertyValueType === PropertyValueType.TwoD) return 2;
    if (this.propertyValueType === PropertyValueType.ThreeD) return 3;
    return 1;
  }

  private checkRange(value: unknown): void {
    if (typeof value === "number" && ((this.hasMin && value < (this.minValue as number)) || (this.hasMax && value > (this.maxValue as number)))) {
      throw new Error(`After Effects error: value ${value} is out of range for ${this.name}`);
    }
  }

  setValue(value: unknown): void {
    this.checkNotSeparated();
    if (this.keys.length > 0) {
      throw new Error(`After Effects error: can't use setValue on "${this.name}" because it has keyframes; use setValueAtTime or setValueAtKey`);
    }
    this.checkRange(value);
    this.staticValue = copyValue(this.withInstalledFont(value));
  }

  private defaultEase(): KeyframeEase[] {
    return Array.from({ length: this.easeDimensions }, () => new KeyframeEase(0, 16.666667));
  }

  private keyAt(time: number): number {
    return this.keys.findIndex((key) => Math.abs(key.time - time) < KEY_TIME_EPSILON);
  }

  /** Adds or replaces the key at `time`; returns its 1-based index. */
  private putKey(time: number, value: unknown): number {
    this.checkNotSeparated();
    if (!this.canVaryOverTime) throw new Error(`After Effects error: "${this.name}" can't be keyframed`);
    this.checkRange(value);
    const existing = this.keyAt(time);
    if (existing >= 0) {
      const key = this.keys[existing] as MockKey;
      key.value = copyValue(this.withInstalledFont(value));
      return existing + 1;
    }
    const key: MockKey = {
      time,
      value: copyValue(this.withInstalledFont(value)),
      inInterpolation: KeyframeInterpolationType.LINEAR,
      outInterpolation: KeyframeInterpolationType.LINEAR,
      inEase: this.defaultEase(),
      outEase: this.defaultEase(),
      temporalAutoBezier: false,
      temporalContinuous: false,
      spatialAutoBezier: this.isSpatial,
      spatialContinuous: this.isSpatial,
      selected: false,
    };
    this.keys.push(key);
    this.keys.sort((a, b) => a.time - b.time);
    return this.keys.indexOf(key) + 1;
  }

  setValueAtTime(time: number, value: unknown): void {
    this.putKey(time, value);
  }

  setValuesAtTimes(times: number[], values: unknown[]): void {
    Array.from(times).forEach((time, i) => this.putKey(time, values[i]));
  }

  setValueAtKey(index: number, value: unknown): void {
    this.key(index).value = copyValue(value);
  }

  addKey(time: number): number {
    return this.putKey(time, this.interpolate(time));
  }

  removeKey(index: number): void {
    this.key(index);
    this.keys.splice(index - 1, 1);
  }

  /** The key record (1-based), for tests. */
  key(index: number): MockKey {
    const key = this.keys[index - 1];
    if (!key) throw new Error(`After Effects error: key index ${index} out of range (${this.keys.length} keys) on "${this.name}"`);
    return key;
  }

  keyTime(index: number): number {
    return this.key(index).time;
  }

  keyValue(index: number): unknown {
    return this.exported(this.key(index).value);
  }

  nearestKeyIndex(time: number): number {
    if (this.keys.length === 0) throw new Error(`After Effects error: "${this.name}" has no keys`);
    let best = 0;
    this.keys.forEach((key, i) => {
      if (Math.abs(key.time - time) < Math.abs((this.keys[best] as MockKey).time - time)) best = i;
    });
    return best + 1;
  }

  /**
   * Linear between keys (enough for tests; After Effects evaluates the eased
   * curve). Before the first / after the last key: that key's value.
   */
  valueAtTime(time: number, _preExpression?: boolean): unknown {
    return this.exported(this.interpolate(time));
  }

  private interpolate(time: number): unknown {
    if (this.keys.length === 0) return copyValue(this.staticValue);
    const first = this.keys[0] as MockKey;
    const last = this.keys[this.keys.length - 1] as MockKey;
    if (time <= first.time) return copyValue(first.value);
    if (time >= last.time) return copyValue(last.value);
    const nextIndex = this.keys.findIndex((key) => key.time > time);
    const a = this.keys[nextIndex - 1] as MockKey;
    const b = this.keys[nextIndex] as MockKey;
    if (a.outInterpolation === KeyframeInterpolationType.HOLD) return copyValue(a.value);
    const t = (time - a.time) / (b.time - a.time);
    const lerp = (x: unknown, y: unknown): unknown => {
      if (typeof x === "number" && typeof y === "number") return x + (y - x) * t;
      if (Array.isArray(x) && Array.isArray(y)) return x.map((v, i) => lerp(v, y[i]));
      return x;
    };
    return lerp(a.value, b.value);
  }

  setInterpolationTypeAtKey(index: number, inType: number, outType: number = inType): void {
    if (!this.isInterpolationTypeValid(inType) || !this.isInterpolationTypeValid(outType)) {
      throw new Error(`After Effects error: interpolation type ${inType}/${outType} is not valid for "${this.name}"`);
    }
    const key = this.key(index);
    key.inInterpolation = inType;
    key.outInterpolation = outType;
  }

  keyInInterpolationType(index: number): number {
    return this.key(index).inInterpolation;
  }

  keyOutInterpolationType(index: number): number {
    return this.key(index).outInterpolation;
  }

  private checkEase(ease: unknown, label: string): KeyframeEase[] {
    const list = Array.isArray(ease) ? Array.from(ease as unknown[]) : [];
    if (list.length !== this.easeDimensions || !list.every((e) => e instanceof KeyframeEase)) {
      throw new Error(
        `After Effects error: ${label} ease for "${this.name}" must be an array of ${this.easeDimensions} KeyframeEase object(s)`,
      );
    }
    return (list as KeyframeEase[]).map((e) => new KeyframeEase(e.speed, e.influence));
  }

  setTemporalEaseAtKey(index: number, inEase: KeyframeEase[], outEase: KeyframeEase[] = inEase): void {
    if (!this.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER)) {
      throw new Error(`After Effects error: "${this.name}" has no temporal ease`);
    }
    const key = this.key(index);
    key.inEase = this.checkEase(inEase, "in");
    key.outEase = this.checkEase(outEase, "out");
  }

  keyInTemporalEase(index: number): KeyframeEase[] {
    return this.exported(this.key(index).inEase.map((e) => new KeyframeEase(e.speed, e.influence)));
  }

  keyOutTemporalEase(index: number): KeyframeEase[] {
    return this.exported(this.key(index).outEase.map((e) => new KeyframeEase(e.speed, e.influence)));
  }

  setTemporalAutoBezierAtKey(index: number, value: boolean): void {
    this.key(index).temporalAutoBezier = value;
  }

  setTemporalContinuousAtKey(index: number, value: boolean): void {
    this.key(index).temporalContinuous = value;
  }

  setSpatialAutoBezierAtKey(index: number, value: boolean): void {
    this.key(index).spatialAutoBezier = value;
  }

  setSpatialTangentsAtKey(index: number, inTangent: number[], outTangent: number[] = inTangent): void {
    const key = this.key(index);
    const size = this.propertyValueType === PropertyValueType.TwoD_SPATIAL ? 2 : 3;
    if (!this.isSpatial) throw new Error(`After Effects error: "${this.name}" is not spatial`);
    if (Array.from(inTangent).length !== size || Array.from(outTangent).length !== size) {
      throw new Error(`After Effects error: spatial tangents for "${this.name}" need ${size} values`);
    }
    key.inSpatialTangent = Array.from(inTangent);
    key.outSpatialTangent = Array.from(outTangent);
  }

  setSpatialContinuousAtKey(index: number, value: boolean): void {
    this.key(index).spatialContinuous = value;
  }

  keySpatialContinuous(index: number): boolean {
    return this.key(index).spatialContinuous;
  }

  keySpatialAutoBezier(index: number): boolean {
    return this.key(index).spatialAutoBezier;
  }

  keyTemporalAutoBezier(index: number): boolean {
    return this.key(index).temporalAutoBezier;
  }

  keyTemporalContinuous(index: number): boolean {
    return this.key(index).temporalContinuous;
  }

  keyInSpatialTangent(index: number): number[] {
    return this.exported(this.key(index).inSpatialTangent ?? []);
  }

  keyOutSpatialTangent(index: number): number[] {
    return this.exported(this.key(index).outSpatialTangent ?? []);
  }

  setSelectedAtKey(index: number, selected: boolean): void {
    this.key(index).selected = selected;
  }
}

function stateOf(property: PropertyBase | null): AeMockState | undefined {
  if (!property) return undefined;
  if (property instanceof PropertyGroup && property.state) return property.state;
  return stateOf(property.parentProperty);
}

function inferValueType(value: unknown): number {
  if (value instanceof TextDocument) return PropertyValueType.TEXT_DOCUMENT;
  if (value instanceof MarkerValue) return PropertyValueType.MARKER;
  if (value instanceof Shape) return PropertyValueType.SHAPE;
  if (Array.isArray(value)) return value.length === 2 ? PropertyValueType.TwoD : PropertyValueType.ThreeD;
  if (typeof value === "number") return PropertyValueType.OneD;
  return PropertyValueType.CUSTOM_VALUE;
}

/** What a property group can create with `addProperty` (by match name or display name). */
export interface AddableProperty {
  name: string;
  create: (state: AeMockState) => PropertyBase;
  /** Name new children "<name> <n>" (Mask 1, Animator 2, Range Selector 1, Group 3). */
  numbered?: boolean;
}

export interface PropertyGroupOptions {
  indexed?: boolean;
  /** match name → what addProperty creates. */
  addable?: Map<string, AddableProperty>;
  isEffect?: boolean;
  isMask?: boolean;
  state?: AeMockState;
}

export class PropertyGroup extends PropertyBase {
  readonly propertyType: number;
  readonly children: PropertyBase[] = [];
  readonly addable: Map<string, AddableProperty>;
  override readonly isEffect: boolean;
  override readonly isMask: boolean;
  readonly state: AeMockState | undefined;

  constructor(name: string, matchName: string, options: PropertyGroupOptions = {}) {
    super(name, matchName);
    this.propertyType = options.indexed ? PropertyType.INDEXED_GROUP : PropertyType.NAMED_GROUP;
    this.addable = options.addable ?? new Map();
    this.isEffect = options.isEffect ?? false;
    this.isMask = options.isMask ?? false;
    this.state = options.state;
  }

  get numProperties(): number {
    return this.children.length;
  }

  /** Child by 1-based index, display name or match name; null when missing (like After Effects). */
  property(ref: number | string): PropertyBase | null {
    if (typeof ref === "number") return this.children[ref - 1] ?? null;
    return this.children.find((child) => child.name === ref || child.matchName === ref) ?? null;
  }

  /** Append a child (mock construction helper). */
  add<P extends PropertyBase>(child: P): P {
    child.parentProperty = this;
    this.children.push(child);
    return child;
  }

  private addableFor(ref: string): AddableProperty | undefined {
    return this.addable.get(ref) ?? [...this.addable.values()].find((entry) => entry.name === ref);
  }

  canAddProperty(ref: string): boolean {
    return this.addableFor(ref) !== undefined;
  }

  addProperty(ref: string): PropertyBase {
    const entry = this.addableFor(ref);
    if (!entry || !this.state) throw new Error(`After Effects error: can't add a property named "${ref}" to "${this.name}"`);
    const child = this.add(entry.create(this.state));
    if (entry.numbered) child.name = `${entry.name} ${this.children.filter((sibling) => sibling.matchName === child.matchName).length}`;
    return child;
  }

  /** A deep copy (Layer.duplicate). */
  clone(): PropertyGroup {
    const options: PropertyGroupOptions = {
      indexed: this.propertyType === PropertyType.INDEXED_GROUP,
      addable: this.addable,
      isEffect: this.isEffect,
      isMask: this.isMask,
    };
    if (this.state) options.state = this.state;
    const copy = new PropertyGroup(this.name, this.matchName, options);
    copy.enabled = this.enabled;
    for (const child of this.children) copy.add(cloneProperty(child));
    return copy;
  }
}

function cloneProperty(source: PropertyBase): PropertyBase {
  if (source instanceof MaskPropertyGroup) return source.clone();
  if (source instanceof PropertyGroup) return source.clone();
  return (source as Property).clone();
}

// ---------------------------------------------------------------------------
// Effects and masks

export interface EffectParamDef {
  name: string;
  matchName: string;
  value: unknown;
  options?: PropertyOptions;
}

export interface EffectDef {
  displayName: string;
  matchName: string;
  category: string;
  params: EffectParamDef[];
}

/** Effects the mock can add (`app.effects` lists them). Tests and tools add more with `mock.registerEffect`. */
export const DEFAULT_EFFECTS: EffectDef[] = [
  {
    displayName: "Gradient Wipe",
    matchName: "ADBE Gradient Wipe",
    category: "Transition",
    params: [
      { name: "Transition Completion", matchName: "ADBE Gradient Wipe-0001", value: 0, options: { min: 0, max: 100 } },
      { name: "Transition Softness", matchName: "ADBE Gradient Wipe-0002", value: 0, options: { min: 0, max: 100 } },
      { name: "Gradient Layer", matchName: "ADBE Gradient Wipe-0003", value: 1, options: { valueType: PropertyValueType.LAYER_INDEX } },
      { name: "Gradient Placement", matchName: "ADBE Gradient Wipe-0004", value: 1 },
      { name: "Invert Gradient", matchName: "ADBE Gradient Wipe-0005", value: 0 },
    ],
  },
  {
    displayName: "Gaussian Blur",
    matchName: "ADBE Gaussian Blur 2",
    category: "Blur & Sharpen",
    params: [
      { name: "Blurriness", matchName: "ADBE Gaussian Blur 2-0001", value: 0, options: { min: 0, max: 3000 } },
      { name: "Blur Dimensions", matchName: "ADBE Gaussian Blur 2-0002", value: 1 },
      { name: "Repeat Edge Pixels", matchName: "ADBE Gaussian Blur 2-0003", value: 0 },
    ],
  },
  {
    displayName: "Fill",
    matchName: "ADBE Fill",
    category: "Generate",
    params: [
      { name: "Color", matchName: "ADBE Fill-0002", value: [1, 0, 0, 1], options: { valueType: PropertyValueType.COLOR } },
      { name: "Opacity", matchName: "ADBE Fill-0005", value: 1, options: { min: 0, max: 1 } },
    ],
  },
  {
    displayName: "Drop Shadow",
    matchName: "ADBE Drop Shadow",
    category: "Perspective",
    params: [
      { name: "Shadow Color", matchName: "ADBE Drop Shadow-0001", value: [0, 0, 0, 1], options: { valueType: PropertyValueType.COLOR } },
      { name: "Opacity", matchName: "ADBE Drop Shadow-0002", value: 127.5, options: { min: 0, max: 255 } },
      { name: "Direction", matchName: "ADBE Drop Shadow-0003", value: 135 },
      { name: "Distance", matchName: "ADBE Drop Shadow-0004", value: 5, options: { min: 0 } },
      { name: "Softness", matchName: "ADBE Drop Shadow-0005", value: 0, options: { min: 0 } },
    ],
  },
  {
    displayName: "Slider Control",
    matchName: "ADBE Slider Control",
    category: "Expression Controls",
    params: [{ name: "Slider", matchName: "ADBE Slider Control-0001", value: 0 }],
  },
  lumetriColor(),
  {
    displayName: "Color Balance",
    matchName: "ADBE Color Balance 2",
    category: "Color Correction",
    params: [
      ...["Shadow", "Midtone", "Highlight"].flatMap((range, r) =>
        ["Red", "Green", "Blue"].map((channel, c) => ({
          name: `${range} ${channel} Balance`,
          matchName: `ADBE Color Balance 2-${String(r * 3 + c + 1).padStart(4, "0")}`,
          value: 0,
          options: { min: -100, max: 100 },
        })),
      ),
      { name: "Preserve Luminosity", matchName: "ADBE Color Balance 2-0010", value: 0, options: { min: 0, max: 1 } },
    ],
  },
];

/**
 * Lumetri Color as After Effects lays it out: one flat list in which the
 * twirl-down sections (Basic Correction, Creative, Vignette...) are NO_VALUE
 * markers, so two parameters can share a name (Saturation). Match names
 * here are placeholders; tools find Lumetri parameters by section and name.
 */
function lumetriColor(): EffectDef {
  const marker = (name: string): EffectParamDef => ({ name, matchName: "", value: null, options: { valueType: PropertyValueType.NO_VALUE, canVaryOverTime: false } });
  const slider = (name: string, value: number, min: number, max: number): EffectParamDef => ({ name, matchName: "", value, options: { min, max } });
  const params: EffectParamDef[] = [
    marker("Basic Correction"),
    marker("White Balance"),
    slider("Temperature", 0, -100, 100),
    slider("Tint", 0, -100, 100),
    marker("Tone"),
    slider("Exposure", 0, -5, 5),
    slider("Contrast", 0, -100, 100),
    slider("Highlights", 0, -100, 100),
    slider("Shadows", 0, -100, 100),
    slider("Whites", 0, -100, 100),
    slider("Blacks", 0, -100, 100),
    slider("Saturation", 100, 0, 200),
    marker("Creative"),
    slider("Intensity", 100, 0, 200),
    marker("Adjustments"),
    slider("Faded Film", 0, 0, 100),
    slider("Sharpen", 0, -100, 100),
    slider("Vibrance", 0, -100, 100),
    slider("Saturation", 100, 0, 200),
    { name: "Shadow Tint", matchName: "", value: [0, 0, 0, 1], options: { valueType: PropertyValueType.COLOR } },
    { name: "Highlight Tint", matchName: "", value: [0, 0, 0, 1], options: { valueType: PropertyValueType.COLOR } },
    slider("Tint Balance", 0, -100, 100),
    marker("Vignette"),
    slider("Amount", 0, -5, 5),
    slider("Midpoint", 50, 0, 100),
    slider("Roundness", 0, -100, 100),
    slider("Feather", 50, 0, 100),
  ];
  return {
    displayName: "Lumetri Color",
    matchName: "ADBE Lumetri",
    category: "Color Correction",
    params: params.map((param, i) => ({ ...param, matchName: `ADBE Lumetri-${String(i + 1).padStart(4, "0")}` })),
  };
}

function addableEffect(def: EffectDef): AddableProperty {
  return {
    name: def.displayName,
    create: (state) => {
      const group = new PropertyGroup(def.displayName, def.matchName, { isEffect: true, state });
      for (const param of def.params) group.add(new Property(param.name, param.matchName, param.value, param.options));
      return group;
    },
  };
}

const ADDABLE_MASK: AddableProperty = {
  name: "Mask",
  numbered: true,
  create: (state) => {
    const mask = new MaskPropertyGroup(state);
    mask.add(new Property("Mask Path", "ADBE Mask Shape", new Shape(), { valueType: PropertyValueType.SHAPE }));
    mask.add(new Property("Mask Feather", "ADBE Mask Feather", [0, 0], { valueType: PropertyValueType.TwoD }));
    mask.add(new Property("Mask Opacity", "ADBE Mask Opacity", 100, { min: 0, max: 100 }));
    mask.add(new Property("Mask Expansion", "ADBE Mask Offset", 0));
    return mask;
  },
};

export class MaskPropertyGroup extends PropertyGroup {
  maskMode: number = MaskMode.ADD;
  inverted = false;
  rotoBezier = false;
  locked = false;
  color: number[] = [1, 1, 0];

  constructor(state: AeMockState) {
    super("Mask 1", "ADBE Mask Atom", { isMask: true, state });
  }

  override clone(): MaskPropertyGroup {
    const copy = new MaskPropertyGroup(this.state as AeMockState);
    Object.assign(copy, { name: this.name, maskMode: this.maskMode, inverted: this.inverted, rotoBezier: this.rotoBezier, locked: this.locked, color: [...this.color] });
    for (const child of this.children) copy.add(cloneProperty(child));
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Items

export abstract class Item {
  readonly id: number;
  comment = "";
  label = 0;
  selected = false;
  parentFolder: FolderItem | null = null;
  abstract readonly typeName: string;

  constructor(
    protected readonly mock: AeMockState,
    public name: string,
    readonly project: Project,
  ) {
    this.id = mock.nextItemId++;
  }

  remove(): void {
    this.project.removeItem(this);
  }
}

export class FolderItem extends Item {
  readonly typeName = "Folder";
  readonly items: ItemCollection;

  constructor(mock: AeMockState, name: string, project: Project) {
    super(mock, name, project);
    this.items = new ItemCollection(mock, project, this);
  }

  get numItems(): number {
    return this.project.allItems.filter((item) => item.parentFolder === this).length;
  }

  item(index: number): Item {
    const item = this.project.allItems.filter((candidate) => candidate.parentFolder === this)[index - 1];
    if (!item) throw new Error(`After Effects error: folder "${this.name}" has no item ${index}`);
    return item;
  }
}

export abstract class AVItem extends Item {
  width = 1920;
  height = 1080;
  pixelAspect = 1;
  frameRate = 30;
  duration = 10;
  hasVideo = true;
  hasAudio = false;
  footageMissing = false;
  useProxy = false;
  time = 0;

  get frameDuration(): number {
    return 1 / this.frameRate;
  }
}

export abstract class FootageSource {
  hasAlpha = false;
  isStill = false;
  loop = 1;
}

export class FileSource extends FootageSource {
  constructor(public file: FileMock | null) {
    super();
  }

  get missingFootagePath(): string {
    return this.file && !this.file.exists ? this.file.fsName : "";
  }
}

export class SolidSource extends FootageSource {
  constructor(public color: number[]) {
    super();
  }
}

export class PlaceholderSource extends FootageSource {}

export class FootageItem extends AVItem {
  readonly typeName = "Footage";

  constructor(
    mock: AeMockState,
    name: string,
    project: Project,
    public mainSource: FootageSource,
  ) {
    super(mock, name, project);
  }

  get file(): FileMock | null {
    return this.mainSource instanceof FileSource ? this.mainSource.file : null;
  }
}

export class CompItem extends AVItem {
  readonly typeName = "Composition";
  readonly layerList: Layer[] = [];
  readonly layers: LayerCollection;
  workAreaStart = 0;
  workAreaDuration = 10;
  bgColor: number[] = [0, 0, 0];
  displayStartTime = 0;
  motionBlur = false;
  shutterAngle = 180;
  shutterPhase = -90;
  frameBlending = false;
  hideShyLayers = false;
  draft3d = false;
  private resolution: number[] = [1, 1];
  readonly markerProperty: Property;
  openedInViewer = 0;

  /** Scripting Guide: two integers in the range [1..99]. */
  get resolutionFactor(): number[] {
    return this.mock.array([...this.resolution]);
  }

  set resolutionFactor(value: number[]) {
    const factors = Array.from(value);
    if (factors.length !== 2 || !factors.every((f) => Number.isInteger(f) && f >= 1 && f <= 99)) {
      throw new Error(`After Effects error: resolutionFactor takes two integers in [1, 99], got ${JSON.stringify(factors)}`);
    }
    this.resolution = factors;
  }

  constructor(mock: AeMockState, name: string, project: Project) {
    super(mock, name, project);
    this.layers = oneBased(new LayerCollection(mock, this), () => this.layerList);
    this.markerProperty = new Property("Marker", "ADBE Marker", new MarkerValue(""), { valueType: PropertyValueType.MARKER });
  }

  get numLayers(): number {
    return this.layerList.length;
  }

  /** By 1-based index or name (first match), like After Effects. */
  layer(ref: number | string): Layer {
    const layer = typeof ref === "number" ? this.layerList[ref - 1] : this.layerList.find((candidate) => candidate.name === ref);
    if (!layer) throw new Error(`After Effects error: comp "${this.name}" has no layer ${String(ref)}`);
    return layer;
  }

  get selectedLayers(): Layer[] {
    return this.mock.array(this.layerList.filter((layer) => layer.selected));
  }

  openInViewer(): void {
    this.openedInViewer += 1;
    this.project.activeItem = this;
  }

  /**
   * Writes a black PNG of the comp's size divided by its resolution factor.
   * Like After Effects it returns first: the file exists but is empty until
   * the script has called `$.sleep` `frameWriteDelay` times.
   */
  saveFrameToPng(time: number, file: FileMock): void {
    const [fx, fy] = Array.from(this.resolutionFactor) as [number, number];
    const width = Math.max(1, Math.round(this.width / fx));
    const height = Math.max(1, Math.round(this.height / fy));
    this.mock.savedFrames.push({ comp: this.id, time, path: file.fsName, width, height, resolutionFactor: [fx, fy] });
    const png = blackPng(width, height);
    const delay = this.mock.frameWriteDelay;
    if (delay <= 0) {
      writeFileSync(file.fsName, png);
      return;
    }
    writeFileSync(file.fsName, Buffer.alloc(0));
    const hooks = this.mock.es.state.sleepHooks;
    let sleeps = 0;
    const hook = (): void => {
      sleeps += 1;
      if (sleeps < delay) return;
      writeFileSync(file.fsName, png);
      hooks.splice(hooks.indexOf(hook), 1);
    };
    hooks.push(hook);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid all-black 8-bit greyscale PNG. */
export function blackPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The smallest valid PNG (1×1, opaque black). */
export const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export class ItemCollection {
  constructor(
    private readonly mock: AeMockState,
    private readonly project: Project,
    private readonly folder: FolderItem | null,
  ) {}

  private get list(): Item[] {
    return this.folder ? this.project.allItems.filter((item) => item.parentFolder === this.folder) : this.project.allItems;
  }

  get length(): number {
    return this.list.length;
  }

  addComp(name: string, width: number, height: number, pixelAspect: number, duration: number, frameRate: number): CompItem {
    if (!(width >= 4 && width <= 30000 && height >= 4 && height <= 30000)) throw new Error("After Effects error: comp size out of range");
    if (!(duration > 0 && frameRate > 0)) throw new Error("After Effects error: comp duration and frame rate must be positive");
    const comp = new CompItem(this.mock, name, this.project);
    Object.assign(comp, { width, height, pixelAspect, duration, frameRate, workAreaDuration: duration });
    this.project.addItem(comp, this.folder);
    return comp;
  }

  addFolder(name: string): FolderItem {
    const folder = new FolderItem(this.mock, name, this.project);
    this.project.addItem(folder, this.folder);
    return folder;
  }
}

// ---------------------------------------------------------------------------
// Layers

function transformGroup(comp: CompItem, width: number, height: number): PropertyGroup {
  const group = new PropertyGroup("Transform", "ADBE Transform Group");
  group.add(new Property("Anchor Point", "ADBE Anchor Point", [width / 2, height / 2, 0], { spatial: true, valueType: PropertyValueType.ThreeD_SPATIAL }));
  group.add(new Property("Position", "ADBE Position", [comp.width / 2, comp.height / 2, 0], { spatial: true, valueType: PropertyValueType.ThreeD_SPATIAL }));
  // Separated dimensions: always in the DOM, used when Position.dimensionsSeparated is true.
  group.add(new Property("X Position", "ADBE Position_0", comp.width / 2));
  group.add(new Property("Y Position", "ADBE Position_1", comp.height / 2));
  group.add(new Property("Z Position", "ADBE Position_2", 0));
  group.add(new Property("Scale", "ADBE Scale", [100, 100, 100], { valueType: PropertyValueType.ThreeD }));
  group.add(new Property("Rotation", "ADBE Rotate Z", 0));
  group.add(new Property("Opacity", "ADBE Opacity", 100, { min: 0, max: 100 }));
  return group;
}

export abstract class Layer {
  name: string;
  comment = "";
  enabled = true;
  solo = false;
  locked = false;
  shy = false;
  selected = false;
  label = 0;
  startTime = 0;
  inPoint = 0;
  outPoint: number;
  stretch = 100;
  parent: Layer | null = null;
  nullLayer = false;
  readonly root: PropertyGroup;
  /** Present on After Effects 22+ only (see AeMockOptions.version). */
  readonly id?: number;

  constructor(
    protected readonly mock: AeMockState,
    readonly containingComp: CompItem,
    name: string,
    width: number,
    height: number,
  ) {
    this.name = name;
    this.outPoint = containingComp.duration;
    if (mock.majorVersion >= 22) this.id = mock.nextLayerId++;
    else mock.nextLayerId++;
    this.root = new PropertyGroup(name, "ADBE Root", { state: mock });
    this.root.add(new Property("Marker", "ADBE Marker", new MarkerValue(""), { valueType: PropertyValueType.MARKER }));
    this.root.add(transformGroup(containingComp, width, height));
  }

  get index(): number {
    return this.containingComp.layerList.indexOf(this) + 1;
  }

  get time(): number {
    return this.containingComp.time;
  }

  get hasVideo(): boolean {
    return true;
  }

  /** Top-level groups by name or match name ("Transform", "ADBE Effect Parade", …). */
  property(ref: number | string): PropertyBase | null {
    return this.root.property(ref);
  }

  get numProperties(): number {
    return this.root.numProperties;
  }

  get transform(): PropertyGroup {
    return this.root.property("ADBE Transform Group") as PropertyGroup;
  }

  get marker(): Property {
    return this.root.property("ADBE Marker") as Property;
  }

  /** `layer.position` etc., the shortcuts scripts use. */
  get anchorPoint(): Property {
    return this.transform.property("ADBE Anchor Point") as Property;
  }

  get position(): Property {
    return this.transform.property("ADBE Position") as Property;
  }

  get scale(): Property {
    return this.transform.property("ADBE Scale") as Property;
  }

  get rotation(): Property {
    return this.transform.property("ADBE Rotate Z") as Property;
  }

  get opacity(): Property {
    return this.transform.property("ADBE Opacity") as Property;
  }

  private move(to: number): void {
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 1);
    list.splice(to, 0, this);
  }

  moveToBeginning(): void {
    this.move(0);
  }

  moveToEnd(): void {
    this.move(this.containingComp.layerList.length - 1);
  }

  moveBefore(other: Layer): void {
    this.containingComp.layerList.splice(this.containingComp.layerList.indexOf(this), 1);
    this.containingComp.layerList.splice(this.containingComp.layerList.indexOf(other), 0, this);
  }

  moveAfter(other: Layer): void {
    this.containingComp.layerList.splice(this.containingComp.layerList.indexOf(this), 1);
    this.containingComp.layerList.splice(this.containingComp.layerList.indexOf(other) + 1, 0, this);
  }

  remove(): void {
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 1);
    for (const layer of list) if (layer.parent === this) layer.parent = null;
  }

  setParentWithJump(parent: Layer | null): void {
    this.parent = parent;
  }

  /** A copy (properties, keyframes, effects, masks) placed directly above this layer, like After Effects. */
  duplicate(): Layer {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this) as object) as Layer, this);
    const fields = copy as unknown as { root: PropertyGroup; id?: number };
    fields.root = this.root.clone();
    if (this.mock.majorVersion >= 22) fields.id = this.mock.nextLayerId++;
    else this.mock.nextLayerId++;
    const list = this.containingComp.layerList;
    list.splice(list.indexOf(this), 0, copy);
    return copy;
  }

  activeAtTime(time: number): boolean {
    return this.enabled && time >= this.inPoint && time < this.outPoint;
  }
}

export class AVLayer extends Layer {
  source: AVItem | null;
  adjustmentLayer = false;
  threeDLayer = false;
  blendingMode: number = BlendingMode.NORMAL;
  motionBlur = false;
  quality: number = LayerQuality.BEST;
  trackMatteType: number = TrackMatteType.NO_TRACK_MATTE;
  audioEnabled = true;
  collapseTransformation = false;
  frameBlending = false;
  preserveTransparency = false;
  guideLayer = false;
  /** After Effects 2023+: setTrackMatte / removeTrackMatte / trackMatteLayer (absent before). */
  setTrackMatte?: (layer: AVLayer | null, type: number) => void;
  removeTrackMatte?: () => void;
  private matteLayer: AVLayer | null = null;

  constructor(mock: AeMockState, comp: CompItem, name: string, source: AVItem | null, width: number, height: number) {
    super(mock, comp, name, width, height);
    this.source = source;
    if (source && source.hasAudio) {
      // Layers of footage with audio have Audio > Audio Levels (dB, left and right).
      const audio = new PropertyGroup("Audio", "ADBE Audio Group", { state: mock });
      audio.add(new Property("Audio Levels", "ADBE Audio Levels", [0, 0], { valueType: PropertyValueType.TwoD }));
      this.root.add(audio);
    }
    if (mock.majorVersion >= 23) {
      // Scripting Guide, AVLayer: passing NO_TRACK_MATTE "is invalid and will result in no-op";
      // null as the layer removes the matte; removeTrackMatte keeps the type.
      this.setTrackMatte = (layer, type) => {
        if (type === TrackMatteType.NO_TRACK_MATTE) return;
        this.matteLayer = layer;
        if (layer) this.trackMatteType = type;
      };
      this.removeTrackMatte = () => {
        this.matteLayer = null;
      };
    }
    this.root.add(new PropertyGroup("Masks", "ADBE Mask Parade", { indexed: true, state: mock, addable: new Map([["ADBE Mask Atom", ADDABLE_MASK]]) }));
    this.root.add(
      new PropertyGroup("Effects", "ADBE Effect Parade", {
        indexed: true,
        state: mock,
        addable: new Map(mock.effects.map((def) => [def.matchName, addableEffect(def)])),
      }),
    );
  }

  get width(): number {
    return this.source ? this.source.width : this.containingComp.width;
  }

  get height(): number {
    return this.source ? this.source.height : this.containingComp.height;
  }

  get isTrackMatte(): boolean {
    const below = this.containingComp.layerList[this.index];
    return below instanceof AVLayer && below.trackMatteType !== TrackMatteType.NO_TRACK_MATTE;
  }

  get hasTrackMatte(): boolean {
    if (this.mock.majorVersion >= 23) return this.matteLayer !== null && this.trackMatteType !== TrackMatteType.NO_TRACK_MATTE;
    return this.trackMatteType !== TrackMatteType.NO_TRACK_MATTE;
  }

  /** After Effects 2023+ only (undefined before). */
  get trackMatteLayer(): AVLayer | null | undefined {
    return this.mock.majorVersion >= 23 ? this.matteLayer : undefined;
  }

  get hasAudio(): boolean {
    return this.source ? this.source.hasAudio : false;
  }

  /** Precomps and vector layers (text, shapes) can collapse transformations. */
  get canSetCollapseTransformation(): boolean {
    return this.source instanceof CompItem || this instanceof TextLayer || this instanceof ShapeLayer;
  }

  /** Bounds of the layer content (the whole source for footage/solids). */
  sourceRectAtTime(_time: number, _includeExtents: boolean): { top: number; left: number; width: number; height: number } {
    return { top: 0, left: 0, width: this.width, height: this.height };
  }

  replaceSource(item: AVItem, _fixExpressions: boolean): void {
    this.source = item;
  }
}

export class TextLayer extends AVLayer {
  constructor(mock: AeMockState, comp: CompItem, text: TextDocument) {
    super(mock, comp, text.text || "Text", null, comp.width, comp.height);
    const textGroup = new PropertyGroup("Text", "ADBE Text Properties");
    textGroup.add(new Property("Source Text", "ADBE Text Document", text, { valueType: PropertyValueType.TEXT_DOCUMENT }));
    textGroup.add(new PropertyGroup("Animators", "ADBE Text Animators", { indexed: true, state: mock, addable: new Map([["ADBE Text Animator", ADDABLE_TEXT_ANIMATOR]]) }));
    this.root.children.splice(1, 0, textGroup);
    textGroup.parentProperty = this.root;
  }

  /**
   * A rough box in layer space, the origin at the first baseline: 0.6 em per
   * character, cap height 0.75 em above the baseline, the leading (or 1.2 em)
   * per extra line. Centered and right-justified text extend left of the
   * origin; paragraph text is its box, centred on the origin.
   */
  override sourceRectAtTime(time: number, _includeExtents: boolean): { top: number; left: number; width: number; height: number } {
    const doc = (this.property("ADBE Text Properties") as PropertyGroup).property("ADBE Text Document") as Property;
    const value = doc.valueAtTime(time) as TextDocument;
    if (value.boxText) {
      const [w, h] = Array.from(value.boxTextSize) as [number, number];
      return { top: -h / 2, left: -w / 2, width: w, height: h };
    }
    const lines = value.text.split(/\r|\n/);
    const width = Math.max(...lines.map((line) => line.length)) * value.fontSize * 0.6;
    const lineHeight = value.leading > 0 ? value.leading : value.fontSize * 1.2;
    const height = value.fontSize + (lines.length - 1) * lineHeight;
    const left = value.justification === ParagraphJustification.CENTER_JUSTIFY ? -width / 2 : value.justification === ParagraphJustification.RIGHT_JUSTIFY ? -width : 0;
    return { top: -value.fontSize * 0.75, left, width, height };
  }
}

// ---------------------------------------------------------------------------
// Text animators (Scripting Guide match names; Range Selector dropdowns are 1-based)

function rangeSelector(state: AeMockState): PropertyGroup {
  const selector = new PropertyGroup("Range Selector 1", "ADBE Text Selector", { state });
  const advanced = new PropertyGroup("Advanced", "ADBE Text Range Advanced", { state });
  // Percentage and Index values both exist; After Effects only lets scripts set the ones Units reveals.
  const units = (): number => (advanced.property("ADBE Text Range Units") as Property).value as number;
  const percent = (): string | null => (units() === 1 ? null : "it is hidden while Units is Index");
  const index = (): string | null => (units() === 2 ? null : "it is hidden while Units is Percentage");
  selector.add(new Property("Start", "ADBE Text Percent Start", 0, { min: 0, max: 100, guard: percent }));
  selector.add(new Property("End", "ADBE Text Percent End", 100, { min: 0, max: 100, guard: percent }));
  selector.add(new Property("Offset", "ADBE Text Percent Offset", 0, { min: -100, max: 100, guard: percent }));
  selector.add(new Property("Start", "ADBE Text Index Start", 0, { min: 0, guard: index }));
  selector.add(new Property("End", "ADBE Text Index End", 1, { min: 0, guard: index }));
  selector.add(new Property("Offset", "ADBE Text Index Offset", 0, { guard: index }));
  selector.add(advanced);
  advanced.add(new Property("Units", "ADBE Text Range Units", 1, { min: 1, max: 2 }));
  advanced.add(new Property("Based On", "ADBE Text Range Type2", 1, { min: 1, max: 4 }));
  advanced.add(new Property("Mode", "ADBE Text Selector Mode", 1, { min: 1, max: 6 }));
  advanced.add(new Property("Amount", "ADBE Text Selector Max Amount", 100, { min: -100, max: 100 }));
  advanced.add(new Property("Shape", "ADBE Text Range Shape", 1, { min: 1, max: 6 }));
  advanced.add(new Property("Smoothness", "ADBE Text Selector Smoothness", 100, { min: 0, max: 100 }));
  advanced.add(new Property("Ease High", "ADBE Text Levels Max Ease", 0, { min: -100, max: 100 }));
  advanced.add(new Property("Ease Low", "ADBE Text Levels Min Ease", 0, { min: -100, max: 100 }));
  advanced.add(new Property("Randomize Order", "ADBE Text Randomize Order", 0, { min: 0, max: 1 }));
  advanced.add(new Property("Random Seed", "ADBE Text Random Seed", 0));
  return selector;
}

const TEXT_ANIMATOR_PROPERTIES = new Map<string, AddableProperty>([
  ["ADBE Text Opacity", { name: "Opacity", create: () => new Property("Opacity", "ADBE Text Opacity", 100, { min: 0, max: 100 }) }],
  ["ADBE Text Position 3D", { name: "Position", create: () => new Property("Position", "ADBE Text Position 3D", [0, 0, 0], { valueType: PropertyValueType.ThreeD }) }],
  ["ADBE Text Scale 3D", { name: "Scale", create: () => new Property("Scale", "ADBE Text Scale 3D", [100, 100, 100], { valueType: PropertyValueType.ThreeD }) }],
  ["ADBE Text Rotation", { name: "Rotation", create: () => new Property("Rotation", "ADBE Text Rotation", 0) }],
  ["ADBE Text Blur", { name: "Blur", create: () => new Property("Blur", "ADBE Text Blur", [0, 0], { valueType: PropertyValueType.TwoD }) }],
  ["ADBE Text Tracking Amount", { name: "Tracking Amount", create: () => new Property("Tracking Amount", "ADBE Text Tracking Amount", 0) }],
  ["ADBE Text Fill Color", { name: "Fill Color", create: () => new Property("Fill Color", "ADBE Text Fill Color", [1, 1, 1, 1], { valueType: PropertyValueType.COLOR }) }],
]);

const ADDABLE_TEXT_ANIMATOR: AddableProperty = {
  name: "Animator",
  numbered: true,
  create: (state) => {
    const animator = new PropertyGroup("Animator 1", "ADBE Text Animator", { state });
    animator.add(
      new PropertyGroup("Selectors", "ADBE Text Selectors", {
        indexed: true,
        state,
        addable: new Map([["ADBE Text Selector", { name: "Range Selector", numbered: true, create: rangeSelector }]]),
      }),
    );
    animator.add(new PropertyGroup("Properties", "ADBE Text Animator Properties", { state, addable: TEXT_ANIMATOR_PROPERTIES }));
    return animator;
  },
};

// ---------------------------------------------------------------------------
// Shape layer contents

function vectorTransform(state: AeMockState): PropertyGroup {
  const transform = new PropertyGroup("Transform", "ADBE Vector Transform Group", { state });
  transform.add(new Property("Anchor Point", "ADBE Vector Anchor", [0, 0], { spatial: true, valueType: PropertyValueType.TwoD_SPATIAL }));
  transform.add(new Property("Position", "ADBE Vector Position", [0, 0], { spatial: true, valueType: PropertyValueType.TwoD_SPATIAL }));
  transform.add(new Property("Scale", "ADBE Vector Scale", [100, 100], { valueType: PropertyValueType.TwoD }));
  transform.add(new Property("Rotation", "ADBE Vector Rotation", 0));
  transform.add(new Property("Opacity", "ADBE Vector Group Opacity", 100, { min: 0, max: 100 }));
  return transform;
}

function shapeItem(name: string, matchName: string, children: (state: AeMockState) => PropertyBase[]): AddableProperty {
  return {
    name,
    numbered: true,
    create: (state) => {
      const group = new PropertyGroup(`${name} 1`, matchName, { state });
      for (const child of children(state)) group.add(child);
      return group;
    },
  };
}

const SHAPE_ITEMS: Map<string, AddableProperty> = new Map([
  [
    "ADBE Vector Group",
    shapeItem("Group", "ADBE Vector Group", (state) => [
      new PropertyGroup("Contents", "ADBE Vectors Group", { indexed: true, state, addable: SHAPE_ITEMS }),
      vectorTransform(state),
    ]),
  ],
  [
    "ADBE Vector Shape - Rect",
    shapeItem("Rectangle Path", "ADBE Vector Shape - Rect", () => [
      new Property("Size", "ADBE Vector Rect Size", [100, 100], { valueType: PropertyValueType.TwoD }),
      new Property("Position", "ADBE Vector Rect Position", [0, 0], { spatial: true, valueType: PropertyValueType.TwoD_SPATIAL }),
      new Property("Roundness", "ADBE Vector Rect Roundness", 0, { min: 0 }),
    ]),
  ],
  [
    "ADBE Vector Shape - Ellipse",
    shapeItem("Ellipse Path", "ADBE Vector Shape - Ellipse", () => [
      new Property("Size", "ADBE Vector Ellipse Size", [100, 100], { valueType: PropertyValueType.TwoD }),
      new Property("Position", "ADBE Vector Ellipse Position", [0, 0], { spatial: true, valueType: PropertyValueType.TwoD_SPATIAL }),
    ]),
  ],
  [
    "ADBE Vector Graphic - Fill",
    shapeItem("Fill", "ADBE Vector Graphic - Fill", () => [
      new Property("Color", "ADBE Vector Fill Color", [1, 0, 0, 1], { valueType: PropertyValueType.COLOR }),
      new Property("Opacity", "ADBE Vector Fill Opacity", 100, { min: 0, max: 100 }),
    ]),
  ],
  [
    "ADBE Vector Graphic - Stroke",
    shapeItem("Stroke", "ADBE Vector Graphic - Stroke", () => [
      new Property("Color", "ADBE Vector Stroke Color", [1, 1, 1, 1], { valueType: PropertyValueType.COLOR }),
      new Property("Opacity", "ADBE Vector Stroke Opacity", 100, { min: 0, max: 100 }),
      new Property("Stroke Width", "ADBE Vector Stroke Width", 2, { min: 0 }),
    ]),
  ],
]);

export class ShapeLayer extends AVLayer {
  constructor(mock: AeMockState, comp: CompItem) {
    super(mock, comp, "Shape Layer 1", null, comp.width, comp.height);
    const contents = new PropertyGroup("Contents", "ADBE Root Vectors Group", { indexed: true, state: mock, addable: SHAPE_ITEMS });
    this.root.children.splice(1, 0, contents);
    contents.parentProperty = this.root;
  }
}

export class CameraLayer extends Layer {
  constructor(mock: AeMockState, comp: CompItem, name: string) {
    super(mock, comp, name, comp.width, comp.height);
  }
}

export class LightLayer extends Layer {
  lightType: number = LightType.SPOT;

  constructor(mock: AeMockState, comp: CompItem, name: string) {
    super(mock, comp, name, comp.width, comp.height);
  }
}

export class LayerCollection {
  constructor(
    private readonly mock: AeMockState,
    private readonly comp: CompItem,
  ) {}

  get length(): number {
    return this.comp.layerList.length;
  }

  private insert<L extends Layer>(layer: L): L {
    this.comp.layerList.unshift(layer);
    return layer;
  }

  /** Stills span `duration` (default: the comp); other items their own duration. */
  add(item: AVItem, duration?: number): AVLayer {
    const layer = new AVLayer(this.mock, this.comp, item.name, item, item.width, item.height);
    const still = item instanceof FootageItem && item.mainSource.isStill;
    layer.outPoint = still ? (duration ?? this.comp.duration) : Math.min(this.comp.duration, item.duration);
    return this.insert(layer);
  }

  addSolid(color: number[], name: string, width: number, height: number, pixelAspect: number, duration?: number): AVLayer {
    const project = this.comp.project;
    const solid = new FootageItem(this.mock, name, project, new SolidSource(Array.from(color)));
    Object.assign(solid, { width, height, pixelAspect, duration: duration ?? this.comp.duration, frameRate: this.comp.frameRate });
    project.addItem(solid, project.solidsFolder());
    const layer = new AVLayer(this.mock, this.comp, name, solid, width, height);
    if (duration !== undefined) layer.outPoint = duration;
    return this.insert(layer);
  }

  addNull(duration?: number): AVLayer {
    const layer = this.addSolid([1, 1, 1], "Null 1", 100, 100, 1, duration);
    layer.nullLayer = true;
    return layer;
  }

  addText(text?: string | TextDocument): TextLayer {
    const doc = text instanceof TextDocument ? text : new TextDocument(text ?? "");
    return this.insert(new TextLayer(this.mock, this.comp, doc));
  }

  addBoxText(size: number[], text?: string): TextLayer {
    const doc = new TextDocument(text ?? "");
    doc.boxText = true;
    doc.pointText = false;
    doc.boxTextSize = Array.from(size);
    return this.insert(new TextLayer(this.mock, this.comp, doc));
  }

  addShape(): ShapeLayer {
    return this.insert(new ShapeLayer(this.mock, this.comp));
  }

  addCamera(name: string, _centerPoint: number[]): CameraLayer {
    return this.insert(new CameraLayer(this.mock, this.comp, name));
  }

  addLight(name: string, _centerPoint: number[]): LightLayer {
    return this.insert(new LightLayer(this.mock, this.comp, name));
  }

  /** Moves the layers at `indices` into a new comp and returns it (moveAllAttributes semantics). */
  precompose(indices: number[], name: string, _moveAllAttributes = true): CompItem {
    const project = this.comp.project;
    const comp = project.items.addComp(name, this.comp.width, this.comp.height, this.comp.pixelAspect, this.comp.duration, this.comp.frameRate);
    const moving = Array.from(indices, (index) => this.comp.layer(index));
    const top = Math.min(...Array.from(indices)) - 1;
    for (const layer of moving) this.comp.layerList.splice(this.comp.layerList.indexOf(layer), 1);
    for (const layer of moving) {
      (layer as { containingComp: CompItem }).containingComp = comp;
      comp.layerList.push(layer);
    }
    const precompLayer = new AVLayer(this.mock, this.comp, name, comp, comp.width, comp.height);
    this.comp.layerList.splice(top, 0, precompLayer);
    return comp;
  }

  byName(name: string): Layer | null {
    return this.comp.layerList.find((layer) => layer.name === name) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Render queue

/** The output module templates a fresh install of each After Effects version ships. */
export function defaultOutputTemplates(majorVersion: number): string[] {
  const base = ["Lossless", "Lossless with Alpha", "Alpha Only", "AIFF 48kHz", "Photoshop", "TIFF Sequence with Alpha", "Multi-Machine Sequence"];
  const highQuality = majorVersion >= 22 ? ["High Quality", "High Quality with Alpha"] : [];
  const h264 = majorVersion >= 23 ? ["H.264 - Match Render Settings - 15 Mbps", "H.264 - Match Render Settings - 40 Mbps", "H.264 - Match Render Settings - 5 Mbps"] : [];
  return [...h264, ...highQuality, ...base];
}

export const RENDER_SETTINGS_TEMPLATES = ["Best Settings", "Current Settings", "DV Settings", "Draft Settings", "Multi-Machine Settings"];

export class OutputModule {
  file: FileMock | null = null;
  templateName = "Lossless";

  constructor(private readonly mock: AeMockState) {}

  get templates(): string[] {
    return this.mock.array(this.mock.outputTemplates);
  }

  applyTemplate(name: string): void {
    if (!this.mock.outputTemplates.includes(name)) throw new Error(`After Effects error: no output module template named "${name}"`);
    this.templateName = name;
  }
}

export class RenderQueueItem {
  status: number = RQItemStatus.QUEUED;
  readonly outputModules: OutputModule[];
  timeSpanStart = 0;
  timeSpanDuration: number;
  renderSettings = "Best Settings";
  private renderFlag = true;

  constructor(
    private readonly queue: RenderQueue,
    readonly comp: CompItem,
  ) {
    this.timeSpanDuration = comp.duration;
    this.outputModules = [new OutputModule(queue.mock)];
  }

  /** The Render checkbox: unchecking a queued item unqueues it. */
  get render(): boolean {
    return this.renderFlag;
  }

  set render(value: boolean) {
    this.queue.mock.queueChangeDepths.push(this.queue.mock.undoDepth);
    this.renderFlag = value;
    if (this.status === RQItemStatus.QUEUED || this.status === RQItemStatus.UNQUEUED) {
      this.status = value ? RQItemStatus.QUEUED : RQItemStatus.UNQUEUED;
    }
  }

  get templates(): string[] {
    return this.queue.mock.array(RENDER_SETTINGS_TEMPLATES);
  }

  applyTemplate(name: string): void {
    if (!RENDER_SETTINGS_TEMPLATES.includes(name)) throw new Error(`After Effects error: no render settings template named "${name}"`);
    this.renderSettings = name;
  }

  get numOutputModules(): number {
    return this.outputModules.length;
  }

  outputModule(index: number): OutputModule {
    const module = this.outputModules[index - 1];
    if (!module) throw new Error(`After Effects error: no output module ${index}`);
    return module;
  }

  remove(): void {
    this.queue.mock.queueChangeDepths.push(this.queue.mock.undoDepth);
    this.queue.list.splice(this.queue.list.indexOf(this), 1);
  }
}

/** `renderQueue.items`: 1-based, with `add(comp)`. */
export class RenderQueueItems {
  constructor(private readonly queue: RenderQueue) {}

  get length(): number {
    return this.queue.list.length;
  }

  add(comp: CompItem): RenderQueueItem {
    this.queue.mock.queueChangeDepths.push(this.queue.mock.undoDepth);
    const item = new RenderQueueItem(this.queue, comp);
    this.queue.list.push(item);
    return item;
  }
}

export class RenderQueue {
  readonly list: RenderQueueItem[] = [];
  rendering = false;
  /** Comp ids passed to queueInAME. */
  readonly sentToMediaEncoder: number[] = [];
  readonly items: RenderQueueItems = oneBased(new RenderQueueItems(this), () => this.list);
  /** Comp ids rendered by render(), in order. */
  readonly rendered: number[] = [];
  /** The undo depth when render() / queueInAME() ran (they should run outside any undo group). */
  readonly undoDepthAtRender: number[] = [];
  /** Make the next render() stop with ERR_STOPPED, leaving a partial file (tests). */
  failNextRender = false;

  constructor(readonly mock: AeMockState) {}

  /** Scripting Guide: whether there are queued items to send; false without Media Encoder (the mock's option). */
  get canQueueInAME(): boolean {
    return this.mock.canQueueInAME && this.list.some((item) => item.status === RQItemStatus.QUEUED && item.render);
  }

  get numItems(): number {
    return this.list.length;
  }

  item(index: number): RenderQueueItem {
    const item = this.list[index - 1];
    if (!item) throw new Error(`After Effects error: render queue has no item ${index}`);
    return item;
  }

  /** Renders queued items with Render checked: writes a small file at each output path and marks them done. */
  render(): void {
    this.undoDepthAtRender.push(this.mock.undoDepth);
    for (const item of this.list) {
      if (item.status !== RQItemStatus.QUEUED || !item.render) continue;
      if (this.failNextRender) {
        // Like a render stopped part way: a partial file at the output.
        this.failNextRender = false;
        for (const module of item.outputModules) if (module.file) writeFileSync(module.file.fsName, "partial");
        item.status = RQItemStatus.ERR_STOPPED;
        continue;
      }
      for (const module of item.outputModules) {
        if (module.file) writeFileSync(module.file.fsName, `rendered ${item.comp.name} with ${module.templateName}`);
      }
      this.rendered.push(item.comp.id);
      item.status = RQItemStatus.DONE;
    }
  }

  queueInAME(_renderImmediately: boolean): void {
    this.undoDepthAtRender.push(this.mock.undoDepth);
    for (const item of this.list) if (item.status === RQItemStatus.QUEUED && item.render) this.sentToMediaEncoder.push(item.comp.id);
  }
}

// ---------------------------------------------------------------------------
// Project and app

export class Project {
  file: FileMock | null = null;
  dirty = false;
  bitsPerChannel = 8;
  activeItem: Item | null = null;
  readonly allItems: Item[] = [];
  readonly items: ItemCollection;
  readonly rootFolder: FolderItem;
  readonly renderQueue: RenderQueue;
  expressionEngine: "extendscript" | "javascript-1.0" = "javascript-1.0";
  /** After Effects 22+: replaced with undefined for older versions. */
  layerByID?: (id: number) => Layer | null;

  constructor(private readonly mock: AeMockState) {
    this.renderQueue = new RenderQueue(mock);
    this.rootFolder = new FolderItem(mock, "Root", this);
    this.items = oneBased(new ItemCollection(mock, this, null), () => this.allItems);
    if (mock.majorVersion >= 22) {
      this.layerByID = (id: number) => {
        for (const item of this.allItems) {
          if (item instanceof CompItem) {
            const layer = item.layerList.find((candidate) => candidate.id === id);
            if (layer) return layer;
          }
        }
        return null;
      };
    }
  }

  get numItems(): number {
    return this.allItems.length;
  }

  item(index: number): Item {
    const item = this.allItems[index - 1];
    if (!item) throw new Error(`After Effects error: project has no item ${index}`);
    return item;
  }

  itemByID(id: number): Item | null {
    return this.allItems.find((item) => item.id === id) ?? null;
  }

  get selection(): Item[] {
    return this.mock.array(this.allItems.filter((item) => item.selected));
  }

  addItem(item: Item, folder: FolderItem | null): void {
    item.parentFolder = folder ?? this.rootFolder;
    this.allItems.push(item);
    this.dirty = true;
  }

  removeItem(item: Item): void {
    this.allItems.splice(this.allItems.indexOf(item), 1);
    if (this.activeItem === item) this.activeItem = null;
    this.dirty = true;
  }

  /** The "Solids" folder After Effects creates on first use. */
  solidsFolder(): FolderItem {
    const existing = this.allItems.find((item): item is FolderItem => item instanceof FolderItem && item.name === "Solids");
    return existing ?? this.items.addFolder("Solids");
  }

  /** File > Import > Placeholder: a stand-in footage item for missing media, in the root folder. */
  importPlaceholder(name: string, width: number, height: number, frameRate: number, duration: number): FootageItem {
    if (!(width >= 4 && width <= 30000 && height >= 4 && height <= 30000)) throw new Error("After Effects error: placeholder size out of range");
    if (!(frameRate >= 1 && frameRate <= 999 && duration > 0)) throw new Error("After Effects error: placeholder frame rate or duration out of range");
    const item = new FootageItem(this.mock, name, this, new PlaceholderSource());
    Object.assign(item, { width, height, frameRate, duration });
    this.addItem(item, null);
    return item;
  }

  importFile(options: ImportOptions): Item {
    if (!options.file) throw new Error("After Effects error: ImportOptions has no file");
    if (!options.file.exists) throw new Error(`After Effects error: file "${options.file.fsName}" does not exist`);
    const name = options.file.displayName;
    const still = /\.(png|jpe?g|tiff?|psd|gif|bmp|exr|svg)$/i.test(name) && !options.sequence;
    const item = new FootageItem(this.mock, name, this, new FileSource(options.file));
    item.mainSource.isStill = still;
    item.hasAudio = /\.(mov|mp4|wav|mp3|aif|aiff|m4a)$/i.test(name);
    item.hasVideo = !/\.(wav|mp3|aif|aiff|m4a)$/i.test(name);
    if (still) item.duration = 0;
    this.addItem(item, null);
    return item;
  }

  save(file?: FileMock): boolean {
    if (file) this.file = file;
    if (!this.file) throw new Error("After Effects error: an untitled project needs a file to save");
    this.file.open("w");
    this.file.write("<AfterEffectsProject/>");
    this.file.close();
    this.dirty = false;
    return true;
  }
}

/** Menu command ids the tools use (After Effects' real ids). */
export const MENU_COMMANDS: Record<string, number> = { Undo: 16, Redo: 2035, Save: 5, "Save As...": 6 };

export class App {
  version: string;
  buildName = "12";
  isoLanguage = "en_US";
  project: Project;

  constructor(
    private readonly mock: AeMockState,
    version: string,
  ) {
    this.version = version;
    this.project = new Project(mock);
  }

  /** After Effects 24+: the font list (undefined before 24). */
  get fonts(): { getFontsByPostScriptName(name: string): { postScriptName: string; familyName: string; isSubstitute: boolean }[] } | undefined {
    if (this.mock.majorVersion < 24) return undefined;
    const mock = this.mock;
    return {
      getFontsByPostScriptName: (name: string) =>
        mock.array(mock.fonts.has(name) ? [{ postScriptName: name, familyName: name.split("-")[0] ?? name, isSubstitute: false }] : []),
    };
  }

  get effects(): { displayName: string; matchName: string; category: string; version: string }[] {
    return this.mock.array(this.mock.effects.map((def) => ({ displayName: def.displayName, matchName: def.matchName, category: def.category, version: "1.0" })));
  }

  beginUndoGroup(title: string): void {
    this.mock.undoCalls.push({ kind: "begin", title, depth: this.mock.undoDepth });
    this.mock.undoDepth += 1;
  }

  endUndoGroup(): void {
    if (this.mock.undoDepth === 0) throw new Error("After Effects error: endUndoGroup without a matching beginUndoGroup");
    this.mock.undoDepth -= 1;
    this.mock.undoCalls.push({ kind: "end", depth: this.mock.undoDepth });
  }

  findMenuCommandId(name: string): number {
    return MENU_COMMANDS[name] ?? 0;
  }

  executeCommand(id: number): void {
    this.mock.commands.push(id);
    this.mock.commandDepths.push(this.mock.undoDepth);
  }
}

// ---------------------------------------------------------------------------
// Factory

export interface AeMockOptions extends ExtendScriptMockOptions {
  /** `app.version` (default "26.3x12"); before 22, layers have no `id` and the project no `layerByID`. */
  version?: string;
  /** Installed fonts by PostScript name (default: Arial and Helvetica Neue, no Inter). */
  fonts?: string[];
  /** `$.sleep` calls before a saved frame has content (default 2; 0 = written at once). */
  frameWriteDelay?: number;
  /** Adobe Media Encoder installed (default true); `renderQueue.canQueueInAME` also needs a queued item. */
  canQueueInAME?: boolean;
  /** Output module templates (default: what this version ships). */
  outputTemplates?: string[];
}

/** Fonts a stock Mac without extra fonts has. */
export const DEFAULT_FONTS = ["ArialMT", "Arial-BoldMT", "HelveticaNeue", "HelveticaNeue-Bold"];

export interface CompOptions {
  name?: string;
  width?: number;
  height?: number;
  pixelAspect?: number;
  duration?: number;
  frameRate?: number;
  /** Make it the active item (default true). */
  active?: boolean;
}

export interface AeMock {
  /** Pass to loadHostScript("aeft", mock.globals). */
  globals: HostGlobals;
  app: App;
  project: Project;
  state: AeMockState;
  es: ExtendScriptMock;
  /** `$.writeln` output. */
  log: string[];
  /** Adds a comp (default 1920×1080, 30 fps, 10 s) and, unless `active: false`, makes it the active item. */
  addComp(options?: CompOptions): CompItem;
  /** Makes an effect available to `addProperty` and `app.effects`. */
  registerEffect(def: EffectDef): void;
}

export function createAeMock(options: AeMockOptions = {}): AeMock {
  const version = options.version ?? "26.3x12";
  const es = createExtendScriptMock(options);
  const state = new AeMockState(es, Number.parseInt(version, 10));
  state.effects.push(...DEFAULT_EFFECTS);
  for (const font of options.fonts ?? DEFAULT_FONTS) state.fonts.add(font);
  state.frameWriteDelay = options.frameWriteDelay ?? 2;
  state.canQueueInAME = options.canQueueInAME ?? true;
  state.outputTemplates = options.outputTemplates ?? defaultOutputTemplates(state.majorVersion);
  const app = new App(state, version);
  const globals: HostGlobals = {
    app,
    alert: (message?: unknown) => {
      state.alerts.push(String(message));
    },
    $: es.$,
    File: es.File,
    Folder: es.Folder,
    CompItem,
    FolderItem,
    FootageItem,
    AVItem,
    Item,
    AVLayer,
    Layer,
    TextLayer,
    ShapeLayer,
    CameraLayer,
    LightLayer,
    Property,
    PropertyGroup,
    MaskPropertyGroup,
    FileSource,
    SolidSource,
    PlaceholderSource,
    KeyframeEase,
    MarkerValue,
    TextDocument,
    Shape,
    ImportOptions,
    KeyframeInterpolationType,
    PropertyValueType,
    PropertyType,
    BlendingMode,
    TrackMatteType,
    LayerQuality,
    ImportAsType,
    RQItemStatus,
    ParagraphJustification,
    MaskMode,
    LightType,
    CloseOptions,
  };
  globals[BIND_REALM] = (realm: Realm) => es.state.link.bind(realm);
  return {
    globals,
    app,
    project: app.project,
    state,
    es,
    log: es.state.log,
    addComp(compOptions: CompOptions = {}) {
      const comp = app.project.items.addComp(
        compOptions.name ?? "Comp 1",
        compOptions.width ?? 1920,
        compOptions.height ?? 1080,
        compOptions.pixelAspect ?? 1,
        compOptions.duration ?? 10,
        compOptions.frameRate ?? 30,
      );
      if (compOptions.active !== false) app.project.activeItem = comp;
      return comp;
    },
    registerEffect(def: EffectDef) {
      state.effects.push(def);
    },
  };
}
