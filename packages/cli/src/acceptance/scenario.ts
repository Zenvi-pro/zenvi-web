/**
 * Acceptance scenarios as data: what an agent would call through MCP, what
 * each receipt must say, and a cheap check of the result. Scenarios live in
 * ./scenarios/*.json and are validated here before anything runs.
 *
 * Arguments and checks may reference earlier results with `${...}`:
 * `${fixtures.clipA}` is a generated media file's absolute path,
 * `${work}` the scenario's working folder, and `${<step id>.<path>}` a value
 * from that step's receipt (`${add.clips[0].id}`, `${import.data.fileIds}`);
 * `${<step id>.ids[n]}` is the n-th id named in its summary (the desktop's
 * import receipt has its file ids only there).
 * A string that is exactly one reference keeps the value's type (an array of
 * ids stays an array); references inside longer strings are spliced in.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type RunnerKind = "portable" | "desktop";

const range = z.object({ min: z.number().optional(), max: z.number().optional() }).strict();
export type Range = z.infer<typeof range>;

/** A value a receipt path must have: exact JSON, a numeric range, a length range, or just present. */
const expectation = z.union([
  range,
  z.object({ length: range }).strict(),
  z.object({ exists: z.boolean() }).strict(),
  z.object({ matches: z.string() }).strict(),
  z.object({ equals: z.unknown() }).strict(),
]);
export type Expectation = z.infer<typeof expectation>;

const expectSchema = z
  .object({
    /** Statuses that pass (default: applied). */
    status: z.array(z.string()).optional(),
    /** Receipt paths and what they must hold (`clips`: `{length: {min: 2}}`). */
    receipt: z.record(z.string(), expectation).optional(),
    /** At least one image came back (preview_frame, review_edit_tool). */
    image: z.boolean().optional(),
  })
  .strict();
export type StepExpect = z.infer<typeof expectSchema>;

const mediaCheck = z
  .object({
    kind: z.literal("media"),
    /** A file path (usually a `${...}` reference to an export). */
    file: z.string(),
    durationSeconds: range.optional(),
    streams: z.array(z.enum(["audio", "video"])).optional(),
    /** Integrated loudness, LUFS (ffmpeg ebur128). */
    loudnessLufs: range.optional(),
    /** Mean luma 0-255 of the frame at this time must reach `min` (not black). */
    frame: z.object({ at: z.number(), minLuma: z.number().default(16) }).strict().optional(),
  })
  .strict();

const imageCheck = z
  .object({
    kind: z.literal("image"),
    /** Mean luma 0-255 of the step's first returned image (not black). */
    minLuma: z.number().default(16),
  })
  .strict();

const toolCheck = z
  .object({
    kind: z.literal("tool"),
    /** A read-only tool to ask (list_clips_tool, get_project_info_tool…). */
    tool: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
    expect: expectSchema.optional(),
  })
  .strict();

const check = z.discriminatedUnion("kind", [mediaCheck, imageCheck, toolCheck]);
export type Check = z.infer<typeof check>;
export type MediaCheck = z.infer<typeof mediaCheck>;

const stepSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
    expect: expectSchema.optional(),
    checks: z.array(check).default([]),
    /** Refusals that mean "this host lacks it" (regexes on the summary): the step is skipped with that reason, not failed. */
    skipWhen: z.array(z.string()).default([]),
    /** Steps this one needs besides those its references name (an export needs the edit it exports). */
    after: z.array(z.string()).default([]),
    /** Only these runners (default: every runner that lists the tool). */
    runners: z.array(z.enum(["portable", "desktop"])).optional(),
    /** Per-runner replacement for tool/args (the desktop names some tools differently). */
    on: z
      .partialRecord(
        z.enum(["portable", "desktop"]),
        z.object({ tool: z.string().optional(), args: z.record(z.string(), z.unknown()).optional(), expect: expectSchema.optional(), checks: z.array(check).optional() }).strict(),
      )
      .optional(),
    timeoutSeconds: z.number().positive().default(300),
  })
  .strict();
export type Step = z.infer<typeof stepSchema>;

const fixtureSchema = z
  .object({
    id: z.string(),
    file: z.string(),
    /** ffmpeg lavfi sources, one input each (testsrc2, sine, color + geq…). */
    lavfi: z.array(z.string()).optional(),
    /** ffmpeg output options (codec, -t…). Default: H.264/AAC, shortest input. */
    output: z.array(z.string()).optional(),
    /** Speech to synthesise with the OS voice (macOS `say`), the input after the lavfi ones. */
    say: z.string().optional(),
  })
  .strict()
  .refine((f) => Boolean(f.lavfi?.length) || Boolean(f.say), { message: "a fixture needs lavfi sources or say" });
export type Fixture = z.infer<typeof fixtureSchema>;

export const scenarioSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string(),
    description: z.string().optional(),
    /** Host programs the fixtures need (`say`); a scenario without them is skipped. */
    requires: z.array(z.enum(["ffmpeg", "say"])).default(["ffmpeg"]),
    /** Seconds the whole scenario should take (reported; CI fails the basic one past it). */
    budgetSeconds: z.number().positive().optional(),
    fixtures: z.array(fixtureSchema).default([]),
    steps: z.array(stepSchema).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const step of s.steps) {
      if (seen.has(step.id)) ctx.addIssue({ code: "custom", message: `duplicate step id ${step.id}` });
      for (const dep of step.after) if (!seen.has(dep)) ctx.addIssue({ code: "custom", message: `${step.id} runs after ${dep}, which is not an earlier step` });
      seen.add(step.id);
    }
  });
export type Scenario = z.infer<typeof scenarioSchema>;

export const SCENARIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "scenarios");

export function parseScenario(raw: unknown, source = "scenario"): Scenario {
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${source}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Every scenario in `dir` (default the bundled ones), sorted by file name. */
export async function loadScenarios(dir: string = SCENARIO_DIR): Promise<Scenario[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  return Promise.all(names.map(async (n) => parseScenario(JSON.parse(await readFile(path.join(dir, n), "utf8")), n)));
}

// ---------------------------------------------------------------------------
// References and paths

/** `clips[0].id` → ["clips", 0, "id"]; `clips.length` reads an array's length. */
export function getPath(value: unknown, dotted: string): unknown {
  let cur = value;
  for (const part of dotted.match(/[^.[\]]+/g) ?? []) {
    if (cur === null || cur === undefined) return undefined;
    if (part === "length" && (Array.isArray(cur) || typeof cur === "string")) cur = cur.length;
    else if (/^\d+$/.test(part) && Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export class MissingReference extends Error {
  constructor(readonly ref: string) {
    super(`\${${ref}} has no value`);
    this.name = "MissingReference";
  }
}

/** Steps and fixtures a value refers to (`${add.clips[0].id}` → "add"). */
export function referencedRoots(value: unknown): Set<string> {
  const roots = new Set<string>();
  JSON.stringify(value ?? null).replace(/\$\{([a-z][a-z0-9_]*)/g, (_, root: string) => (roots.add(root), ""));
  return roots;
}

/** Replace `${...}` references in `value` from `scope` (step receipts, `fixtures`, `work`). Throws MissingReference. */
export function resolveRefs(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const whole = /^\$\{([^}]+)\}$/.exec(value);
    if (whole) {
      const got = getPath(scope, whole[1]!);
      if (got === undefined) throw new MissingReference(whole[1]!);
      return got;
    }
    return value.replace(/\$\{([^}]+)\}/g, (_, ref: string) => {
      const got = getPath(scope, ref);
      if (got === undefined) throw new MissingReference(ref);
      return typeof got === "string" ? got : JSON.stringify(got);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, scope));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, scope)]));
  return value;
}

export function inRange(n: number, r: Range): boolean {
  return (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
}

function rangeText(r: Range): string {
  if (r.min !== undefined && r.max !== undefined) return `${r.min}..${r.max}`;
  return r.min !== undefined ? `>= ${r.min}` : `<= ${r.max}`;
}

/** "" when `actual` meets `want`, else why not. */
export function unmet(actual: unknown, want: Expectation): string {
  if ("exists" in want) return (actual !== undefined && actual !== null) === want.exists ? "" : want.exists ? "missing" : `present (${short(actual)})`;
  if ("matches" in want) return typeof actual === "string" && new RegExp(want.matches, "i").test(actual) ? "" : `${short(actual)} does not match /${want.matches}/`;
  if ("equals" in want) return JSON.stringify(actual) === JSON.stringify(want.equals) ? "" : `${short(actual)} is not ${short(want.equals)}`;
  if ("length" in want && want.length) {
    const n = Array.isArray(actual) || typeof actual === "string" ? actual.length : undefined;
    return n !== undefined && inRange(n, want.length) ? "" : `length ${n ?? "n/a"} is not ${rangeText(want.length)}`;
  }
  const n = typeof actual === "number" ? actual : Number.NaN;
  return Number.isFinite(n) && inRange(n, want as Range) ? "" : `${short(actual)} is not ${rangeText(want as Range)}`;
}

function short(v: unknown): string {
  const s = JSON.stringify(v) ?? "undefined";
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}
