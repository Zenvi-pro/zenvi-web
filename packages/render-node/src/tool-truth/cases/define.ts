/**
 * A small vocabulary for hand-written tool cases: a tool with its target and
 * the arguments every run shares, then one line per parameter value.
 */

import { clipId, type Args, type Expectation, type Probe, type ToolStep, type TruthCase, type TruthClip } from "../harness.js";

export const A = clipId("A");
export const B = clipId("B");
export const PICTURE: Probe = { kind: "picture", at: 0.5 };
export const SOUND: Probe = { kind: "sound" };
export const BARS: TruthClip[] = [{ fixture: "bars.mp4", id: "A" }];
/** Two shots cut together on one track (A then B), for transitions. */
export const CUT: TruthClip[] = [
  { fixture: "bars.mp4", id: "A", position: 0 },
  { fixture: "rings.mp4", id: "B", position: 1 },
];

export const up = (metric: Expectation["metric"]): Expectation => ({ metric, direction: "up" });
export const down = (metric: Expectation["metric"]): Expectation => ({ metric, direction: "down" });

export interface ToolSpec {
  tool: string;
  /** Arguments every run of this tool shares (the target clip and the context). */
  args?: Args;
  clips?: TruthClip[];
  setup?: ToolStep[];
  probe?: Probe;
  desktop?: boolean;
  /**
   * The tool refuses a call that changes nothing, so the default run is
   * "not called" unless a case gives a base value.
   */
  needsChange?: boolean;
}

export interface ParamOptions {
  /** Extra arguments both runs get, so this parameter has something to act on. */
  with?: Args;
  /** Case id suffix when one parameter has several cases. */
  label?: string;
  expect?: Expectation[];
  clips?: TruthClip[];
  setup?: ToolStep[];
  probe?: Probe;
  /** The default value to send in the base run (default: leave the parameter out). */
  base?: unknown;
  /** Skip the base call entirely: the default is "the tool was not called". */
  baseIsUncalled?: boolean;
  desktop?: boolean;
}

/** One case: `spec.tool` with `param` at its default and at `value`. */
export function param(spec: ToolSpec, name: string, value: unknown, opts: ParamOptions = {}): TruthCase {
  const shared = { ...spec.args, ...opts.with };
  const base = opts.base === undefined ? shared : { ...shared, [name]: opts.base };
  return {
    id: `${spec.tool} ${name}${opts.label ? `=${opts.label}` : ""}`,
    tool: spec.tool,
    param: name,
    clips: opts.clips ?? spec.clips ?? BARS,
    setup: [...(spec.setup ?? []), ...(opts.setup ?? [])],
    base: opts.baseIsUncalled || (spec.needsChange && opts.base === undefined && opts.with === undefined) ? null : base,
    variant: { ...shared, [name]: value },
    probe: opts.probe ?? spec.probe ?? PICTURE,
    expect: opts.expect,
    desktop: opts.desktop ?? spec.desktop,
  };
}

/** The same case under each alias name the tool also accepts. */
export function aliases(spec: ToolSpec, names: readonly string[], value: unknown, opts: ParamOptions = {}): TruthCase[] {
  return names.map((name) => param(spec, name, value, opts));
}
