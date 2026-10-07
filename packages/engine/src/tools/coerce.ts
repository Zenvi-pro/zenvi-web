/**
 * Argument coercion and validation messages.
 *
 * The Zenvi Assistant's backend stubs advertise most arguments as strings, so
 * tool args arrive as `trackIndex: ""`, `startFrame: "12"`, `force: "false"`.
 * `normalizeArgs` is a port of zenvi-core agent_tools/schema.py
 * `normalize_args` (ref b63c39be7): drop hidden and empty args, then coerce
 * integers, numbers, booleans and arrays according to each property's
 * top-level JSON `type`. Properties declared only through `oneOf`/`anyOf`
 * (the `_str_or_num` ones) are left alone, exactly like the desktop.
 *
 * One addition: a number or boolean sent for a property whose only type is
 * `string` becomes its string form (MCP clients send `track: 2`); the desktop
 * would refuse it.
 *
 * `formatIssue` phrases a zod issue the way the desktop's jsonschema reports
 * it (`'query' is a required property`, `'x' is not one of [...]`), inside the
 * desktop envelope `Error: Invalid arguments for <tool>: <message> (at <path>).`
 */

import type { z } from "zod";
import type { JsonSchema, JsonSchemaObject } from "./json-schema.js";

/** Params never exposed to models and stripped before validation (schema.py HIDDEN_PARAMS). */
export const HIDDEN_PARAMS: ReadonlySet<string> = new Set(["self", "chat_session_id", "transaction_id"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** schema.py `_prop_types`: the property's own `type`, never its oneOf/anyOf branches. */
function topLevelTypes(prop: JsonSchema | undefined): Set<string> {
  const raw = prop?.type;
  if (typeof raw === "string") return new Set([raw]);
  if (Array.isArray(raw)) return new Set(raw.map(String));
  return new Set();
}

const INTEGER_TEXT = /^-?\d+$/;
// Python float(): optional sign, digits with single underscores, fraction, exponent.
const FLOAT_TEXT = /^[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;

/** Python `float(text.strip())` for finite values; null when Python would raise (or yield inf/nan). */
export function parsePythonFloat(text: string): number | null {
  const t = text.trim();
  if (!FLOAT_TEXT.test(t)) return null;
  const n = Number(t.replaceAll("_", ""));
  return Number.isFinite(n) ? n : null;
}

function coerceValue(value: unknown, prop: JsonSchema | undefined): { keep: boolean; value: unknown } {
  if (value === null || value === undefined || value === "") return { keep: false, value };
  const types = topLevelTypes(prop);
  const isBool = typeof value === "boolean";

  if (types.has("integer") && !isBool) {
    if (typeof value === "number" && Number.isInteger(value)) return { keep: true, value };
    if (typeof value === "string") {
      const t = value.trim();
      if (INTEGER_TEXT.test(t)) return { keep: true, value: Number.parseInt(t, 10) };
    }
    return { keep: true, value };
  }
  if (types.has("number") && !isBool) {
    if (typeof value === "number") return { keep: true, value };
    if (typeof value === "string") {
      const n = parsePythonFloat(value);
      if (n !== null) return { keep: true, value: n };
    }
    return { keep: true, value };
  }
  if (types.has("boolean")) {
    if (isBool) return { keep: true, value };
    if (typeof value === "string") {
      const low = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(low)) return { keep: true, value: true };
      if (["0", "false", "no", "off"].includes(low)) return { keep: true, value: false };
    }
    return { keep: true, value };
  }
  if (types.has("array") && typeof value === "string") {
    const text = value.trim();
    if (!text) return { keep: false, value };
    try {
      return { keep: true, value: JSON.parse(text) };
    } catch {
      if (text.includes(",")) {
        const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 0 && parts.every((p) => /^\d+$/.test(p))) {
          return { keep: true, value: parts.map((p) => Number.parseInt(p, 10)) };
        }
      }
    }
    return { keep: true, value };
  }
  if (types.size === 1 && types.has("string") && (typeof value === "number" || isBool)) {
    if (typeof value === "number" && !Number.isFinite(value)) return { keep: true, value };
    return { keep: true, value: String(value) };
  }
  return { keep: true, value };
}

/**
 * Coerce raw tool args into schema shapes (schema.py `normalize_args`).
 * Non-object input is returned as-is so validation can refuse it.
 */
export function normalizeArgs(schema: JsonSchemaObject | undefined, args: unknown): unknown {
  if (args === null || args === undefined) return {};
  if (!isRecord(args)) return args;
  const out: Record<string, unknown> = {};
  const props = schema?.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    if (HIDDEN_PARAMS.has(key)) continue;
    if (!schema || !(key in props)) {
      // Unknown keys stay so validation can refuse them (additionalProperties false).
      if (value !== "") out[key] = value;
      continue;
    }
    const coerced = coerceValue(value, props[key]);
    if (coerced.keep) out[key] = coerced.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation messages
// ---------------------------------------------------------------------------

/** A rough Python `repr` for values quoted in desktop-style messages. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : value > 0 ? "inf" : value < 0 ? "-inf" : "nan";
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const body = value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
    return quote + (quote === "'" ? body.replaceAll("'", "\\'") : body) + quote;
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (isRecord(value)) return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(", ")}}`;
  return String(value);
}

function valueAt(root: unknown, path: readonly PropertyKey[]): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const part of path) {
    if (Array.isArray(current) && typeof part === "number" && part < current.length) current = current[part];
    else if (isRecord(current) && typeof part === "string" && part in current) current = current[part];
    else return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

const JSON_TYPE_NAMES: Record<string, string> = {
  string: "string",
  number: "number",
  int: "integer",
  boolean: "boolean",
  array: "array",
  object: "object",
  null: "null",
};

/** One zod issue as jsonschema would phrase it, with its path. */
export function formatIssue(issue: z.core.$ZodIssue, payload: unknown): { message: string; path: string } {
  const path = issue.path.map(String).join(".") || "(root)";
  const at = valueAt(payload, issue.path);
  const shown = pyRepr(at.value);
  switch (issue.code) {
    case "unrecognized_keys": {
      const keys = issue.keys.map(pyRepr).join(", ");
      const verb = issue.keys.length === 1 ? "was" : "were";
      return { message: `Additional properties are not allowed (${keys} ${verb} unexpected)`, path };
    }
    case "invalid_type": {
      if (!at.found && issue.path.length > 0) {
        const parentPath = issue.path.slice(0, -1).map(String).join(".") || "(root)";
        return { message: `${pyRepr(String(issue.path[issue.path.length - 1]))} is a required property`, path: parentPath };
      }
      const expected = JSON_TYPE_NAMES[issue.expected] ?? issue.expected;
      return { message: `${shown} is not of type '${expected}'`, path };
    }
    case "invalid_value":
      return { message: `${shown} is not one of [${issue.values.map(pyRepr).join(", ")}]`, path };
    case "invalid_union":
      return { message: `${shown} is not valid under any of the given schemas`, path };
    case "too_small":
      if (issue.origin === "array") {
        return { message: Number(issue.minimum) <= 1 ? `${shown} should be non-empty` : `${shown} is too short`, path };
      }
      // jsonschema: exclusiveMinimum reads "less than or equal to the minimum".
      return { message: `${shown} is less than ${issue.inclusive === false ? "or equal to " : ""}the minimum of ${pyRepr(Number(issue.minimum))}`, path };
    case "too_big":
      if (issue.origin === "array") return { message: `${shown} is too long`, path };
      return { message: `${shown} is greater than ${issue.inclusive === false ? "or equal to " : ""}the maximum of ${pyRepr(Number(issue.maximum))}`, path };
    default:
      return { message: issue.message, path };
  }
}

/** The desktop's refusal text for invalid arguments (schema.py validate_args). */
export function invalidArgumentsMessage(tool: string, issue: z.core.$ZodIssue, payload: unknown): string {
  const { message, path } = formatIssue(issue, payload);
  return `Error: Invalid arguments for ${tool}: ${message} (at ${path}).`;
}
