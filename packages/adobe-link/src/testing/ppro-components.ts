/**
 * Premiere Pro components for the mock DOM: ComponentParam (values,
 * keyframes, interpolation, colours), Component, the built-in components every
 * clip carries and a small effect / transition catalogue with Premiere's
 * names. Parameter order follows a reflection of a live Premiere (pymiere's
 * class data: Opacity = Opacity, Blend Mode; Motion = Position, Scale, Scale
 * Width, Uniform Scale, Rotation, Anchor Point, Anti-flicker Filter).
 */

import { TICKS_PER_SECOND, ticksOf } from "./ppro-time.js";
import type { RealmLink } from "./realm.js";

/** What the components need from the mock state. */
export interface ComponentHost {
  readonly link: RealmLink;
  /** Throw on setInterpolationTypeAtKey with the legacy ease modes 1-3 (to test the Bezier fallback). */
  rejectLegacyEase: boolean;
  undoable(label: string): void;
}

export interface MockKey {
  value: unknown;
  /** setInterpolationTypeAtKey value; 0 (linear) until set. */
  interpolation: number;
}

/** A plain JS value from a script value (realm arrays become JS arrays). */
function plain(value: unknown): unknown {
  if (value && typeof value === "object" && typeof (value as { length?: unknown }).length === "number" && !(typeof value === "string")) {
    return Array.from(value as ArrayLike<unknown>);
  }
  return value;
}

export class MockParam {
  value: unknown;
  timeVarying = false;
  keyframesSupported = true;
  readonly keys = new Map<number, MockKey>();
  /** [a, r, g, b] 0-255 for colour parameters. */
  color: [number, number, number, number] | null = null;
  /** Every setValue / setValueAtKey / interpolation call, for assertions. */
  readonly calls: string[] = [];

  constructor(
    private readonly host: ComponentHost,
    public displayName: string,
    value: unknown,
  ) {
    this.value = value;
  }

  private time(value: unknown): { ticks: string; seconds: number } {
    const ticks = ticksOf(value);
    return { ticks: String(ticks), seconds: ticks / TICKS_PER_SECOND };
  }

  getValue(): unknown {
    const value = this.value;
    return Array.isArray(value) ? this.host.link.array(value) : value;
  }

  /** Premiere only sets the static value of a parameter that is not time-varying. */
  setValue(value: unknown, _updateUI?: unknown): boolean {
    this.calls.push(`setValue(${JSON.stringify(plain(value))})`);
    if (this.timeVarying) return false;
    this.value = plain(value);
    this.host.undoable(`setValue ${this.displayName}`);
    return true;
  }

  isTimeVarying(): boolean {
    return this.timeVarying;
  }

  setTimeVarying(on: boolean, _updateUI?: boolean): boolean {
    this.calls.push(`setTimeVarying(${on})`);
    this.timeVarying = Boolean(on);
    if (!on) this.keys.clear();
    this.host.undoable(`setTimeVarying ${this.displayName}`);
    return true;
  }

  areKeyframesSupported(): boolean {
    return this.keyframesSupported;
  }

  addKey(time: unknown): number {
    if (!this.timeVarying) throw new Error(`${this.displayName}: keyframes are off (call setTimeVarying(true) first)`);
    const ticks = ticksOf(time);
    if (!this.keys.has(ticks)) this.keys.set(ticks, { value: this.value, interpolation: 0 });
    this.host.undoable(`addKey ${this.displayName}`);
    return 0;
  }

  removeKey(time: unknown): number {
    this.keys.delete(ticksOf(time));
    this.host.undoable(`removeKey ${this.displayName}`);
    return 0;
  }

  removeKeyRange(start: unknown, end: unknown): number {
    const from = ticksOf(start);
    const to = ticksOf(end);
    for (const ticks of [...this.keys.keys()]) if (ticks >= from && ticks <= to) this.keys.delete(ticks);
    return 0;
  }

  keyExistsAtTime(time: unknown): boolean {
    return this.keys.has(ticksOf(time));
  }

  /** Key times as Time-like objects (a realm array), in time order. */
  getKeys(): unknown {
    const times = [...this.keys.keys()].sort((a, b) => a - b).map((ticks) => this.time(ticks));
    return times.length ? this.host.link.array(times) : 0;
  }

  getValueAtKey(time: unknown): unknown {
    const key = this.keys.get(ticksOf(time));
    if (!key) return 0;
    return Array.isArray(key.value) ? this.host.link.array(key.value) : key.value;
  }

  setValueAtKey(time: unknown, value: unknown, _updateUI?: unknown): number {
    const key = this.keys.get(ticksOf(time));
    if (!key) throw new Error(`${this.displayName}: no keyframe at ${ticksOf(time)} ticks`);
    key.value = plain(value);
    this.calls.push(`setValueAtKey(${ticksOf(time)}, ${JSON.stringify(key.value)})`);
    return 0;
  }

  setInterpolationTypeAtKey(time: unknown, type: number, _updateUI?: unknown): number {
    const key = this.keys.get(ticksOf(time));
    if (!key) throw new Error(`${this.displayName}: no keyframe at ${ticksOf(time)} ticks`);
    if (this.host.rejectLegacyEase && type >= 1 && type <= 3) throw new Error("Illegal Parameter type");
    key.interpolation = type;
    this.calls.push(`setInterpolationTypeAtKey(${ticksOf(time)}, ${type})`);
    return 0;
  }

  getColorValue(): unknown {
    return this.host.link.array(this.color ?? [255, 255, 255, 255]);
  }

  setColorValue(alpha: number, red: number, green: number, blue: number, _updateUI?: unknown): number {
    this.color = [alpha, red, green, blue];
    this.calls.push(`setColorValue(${alpha}, ${red}, ${green}, ${blue})`);
    this.host.undoable(`setColorValue ${this.displayName}`);
    return 0;
  }

  /** Test helper: the keys as [{seconds, value, interpolation}], in time order. */
  keyList(): { seconds: number; value: unknown; interpolation: number }[] {
    return [...this.keys.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ticks, key]) => ({ seconds: Math.round((ticks / TICKS_PER_SECOND) * 1e6) / 1e6, value: key.value, interpolation: key.interpolation }));
  }
}

/** 0-based collection with numItems/length over a live list. */
export function collection<T extends object>(target: T, list: () => readonly unknown[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) return list()[Number(prop)];
      if (prop === "numItems" || prop === "length") return list().length;
      return Reflect.get(obj, prop, receiver);
    },
  });
}

export class ComponentParamCollection {
  constructor(private readonly params: MockParam[]) {}

  getParamForDisplayName(name: string): MockParam | null {
    return this.params.find((param) => param.displayName === name) ?? null;
  }
}

export class MockComponent {
  readonly params: MockParam[];
  readonly properties: ComponentParamCollection;

  constructor(
    host: ComponentHost,
    public displayName: string,
    public matchName: string,
    params: readonly (readonly [string, unknown])[],
  ) {
    this.params = params.map(([name, value]) => new MockParam(host, name, value));
    this.properties = collection(new ComponentParamCollection(this.params), () => this.params);
  }

  /** Test helper: a parameter by display name (the first one when names repeat). */
  param(name: string): MockParam {
    const found = this.params.find((param) => param.displayName === name);
    if (!found) throw new Error(`${this.displayName} has no parameter ${name}`);
    return found;
  }
}

/** Normal in Premiere's Blend Mode index order (alphabetical, then Subtract, Divide). */
export const BLEND_NORMAL = 18;

export function videoIntrinsics(host: ComponentHost): MockComponent[] {
  return [
    new MockComponent(host, "Opacity", "AE.ADBE Opacity", [
      ["Opacity", 100],
      ["Blend Mode", BLEND_NORMAL],
    ]),
    new MockComponent(host, "Motion", "AE.ADBE Motion", [
      ["Position", [0.5, 0.5]],
      ["Scale", 100],
      ["Scale Width", 100],
      ["", true],
      ["Rotation", 0],
      ["Anchor Point", [0.5, 0.5]],
      ["Anti-flicker Filter", 0],
    ]),
  ];
}

/** 0 dB = 10^(-15/20): Premiere's Level is normalised so +15 dB = 1. */
export const LEVEL_0DB = Math.pow(10, -15 / 20);

export function audioIntrinsics(host: ComponentHost): MockComponent[] {
  return [
    new MockComponent(host, "Volume", "Internal Volume Stereo", [
      ["Bypass", false],
      ["Level", LEVEL_0DB],
    ]),
    new MockComponent(host, "Channel Volume", "Internal Channel Volume Stereo", [
      ["Bypass", false],
      ["Left", LEVEL_0DB],
      ["Right", LEVEL_0DB],
    ]),
    new MockComponent(host, "Panner", "Internal Panner", [["Balance", 0]]),
  ];
}

export interface EffectSpec {
  kind: "video" | "audio";
  matchName: string;
  params: readonly (readonly [string, unknown])[];
}

/** Lumetri Color's parameters in panel order, with section headers (names repeat across sections). */
const LUMETRI_PARAMS: readonly (readonly [string, unknown])[] = [
  ["Basic Correction", null],
  ["Input LUT", 0],
  ["Temperature", 0],
  ["Tint", 0],
  ["Exposure", 0],
  ["Contrast", 0],
  ["Highlights", 0],
  ["Shadows", 0],
  ["Whites", 0],
  ["Blacks", 0],
  ["Saturation", 100],
  ["Creative", null],
  ["Look", 0],
  ["Intensity", 100],
  ["Faded Film", 0],
  ["Sharpen", 0],
  ["Vibrance", 0],
  ["Saturation", 100],
  ["Shadow Tint", null],
  ["Highlight Tint", null],
  ["Tint Balance", 0],
  ["Curves", null],
  ["Saturation", 100],
  ["Color Wheels & Match", null],
  ["HSL Secondary", null],
  ["Amount", 0],
  ["Vignette", null],
  ["Amount", 0],
  ["Midpoint", 50],
  ["Roundness", 0],
  ["Feather", 50],
];

export const EFFECTS: Record<string, EffectSpec> = {
  "Gaussian Blur": {
    kind: "video",
    matchName: "AE.ADBE Gaussian Blur 2",
    params: [
      ["Blurriness", 0],
      ["Blur Dimensions", 1],
      ["Repeat Edge Pixels", false],
    ],
  },
  "Lumetri Color": { kind: "video", matchName: "AE.ADBE Lumetri", params: LUMETRI_PARAMS },
  Transform: {
    kind: "video",
    matchName: "AE.ADBE Geometry2",
    params: [
      ["Anchor Point", [0.5, 0.5]],
      ["Position", [0.5, 0.5]],
      ["Scale", 100],
      ["Opacity", 100],
    ],
  },
  DeNoise: { kind: "audio", matchName: "AE.ADBE DeNoise", params: [["Amount", 40]] },
  "Parametric Equalizer": { kind: "audio", matchName: "AE.ADBE Parametric EQ", params: [["Master Gain", 0]] },
};

export const TRANSITIONS: Record<string, "video" | "audio"> = {
  "Cross Dissolve": "video",
  "Dip to Black": "video",
  "Film Dissolve": "video",
  "Constant Power": "audio",
  "Constant Gain": "audio",
};

export function createEffect(host: ComponentHost, name: string): MockComponent {
  const spec = EFFECTS[name];
  if (!spec) throw new Error(`No effect ${name}`);
  const component = new MockComponent(host, name, spec.matchName, spec.params);
  for (const param of component.params) {
    if (param.displayName === "Shadow Tint" || param.displayName === "Highlight Tint") param.color = [255, 128, 128, 128];
  }
  return component;
}
