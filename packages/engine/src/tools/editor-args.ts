/**
 * Argument coercion for the desktop's editor tools.
 *
 * zenvi-core develop registers its newer tools with `@editor_tool`
 * (src/classes/editor_tools/_registry.py), whose registry coerces what a
 * model sends to each property's schema before the strict validation:
 * case-insensitive enums, numbers like "1.5" or "1.5s", "true"/"yes"/"y",
 * a comma-separated or JSON list for an array, a JSON object for an object.
 * `coerceEditorArgs` is a port of `coerce_args` (best effort: a value that
 * cannot be coerced is left as it came, for the validator to refuse), used
 * for every contract tool whose desktop handler is an editor tool.
 *
 * Web additions, as in `normalizeArgs`: hidden params are dropped, and an
 * empty string or null for a property that cannot hold it means "use the
 * default" (the desktop refuses it, or passes "" on), so the Assistant's
 * empty stubs work.
 */

import { HIDDEN_PARAMS, parsePythonFloat } from "./coerce.js";
import type { JsonSchema, JsonSchemaObject } from "./json-schema.js";

class EditorArgError extends Error {}

const TRUE = new Set(["true", "1", "yes", "y", "on"]);
const FALSE = new Set(["false", "0", "no", "n", "off"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** _registry._types: the schema's types without "null" (or its anyOf/oneOf branches' types). */
function kindsOf(schema: JsonSchema): string[] {
  const t = schema.type;
  if (Array.isArray(t)) {
    const kinds = t.filter((k) => k !== "null");
    return kinds.length > 0 ? kinds : ["null"];
  }
  if (typeof t === "string") return [t];
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = schema[key];
    if (branches) return branches.flatMap((branch) => kindsOf(branch));
  }
  return [];
}

function acceptsNull(schema: JsonSchema): boolean {
  if (schema.nullable) return true;
  const t = schema.type;
  if (t === "null" || (Array.isArray(t) && t.includes("null"))) return true;
  return [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].some(acceptsNull);
}

/**
 * True when "" is a value of this property: an enum listing "", or a free
 * string whose default is empty (`name=""` clears a name). A string with
 * another default (a TTS voice, a colour) reads "" as "use the default".
 */
function acceptsEmptyString(schema: JsonSchema): boolean {
  if (schema.enum) return schema.enum.includes("");
  const fallback = schema.default;
  return kindsOf(schema).includes("string") && (fallback === undefined || fallback === null || fallback === "");
}

function coerceKind(path: string, value: unknown, kind: string, schema: JsonSchema): unknown {
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const s = String(value).trim().toLowerCase();
    if (TRUE.has(s)) return true;
    if (FALSE.has(s)) return false;
    throw new EditorArgError(`argument '${path}' must be true or false`);
  }
  if (kind === "number" || kind === "integer") {
    let f: number | null;
    if (typeof value === "number") f = Number.isFinite(value) ? value : null;
    else if (typeof value === "string") {
      // Python float(str(value).strip().rstrip("s")): "1.5s" and " 2 " are numbers.
      f = parsePythonFloat(value.trim().replace(/s+$/, ""));
    } else {
      throw new EditorArgError(`argument '${path}' must be a number`);
    }
    if (f === null) throw new EditorArgError(`argument '${path}' must be a finite number`);
    if (kind === "integer") {
      if (!Number.isInteger(f)) throw new EditorArgError(`argument '${path}' must be a whole number`);
    }
    if (schema.minimum !== undefined && f < schema.minimum) throw new EditorArgError(`argument '${path}' is below the minimum`);
    if (schema.maximum !== undefined && f > schema.maximum) throw new EditorArgError(`argument '${path}' is above the maximum`);
    return f;
  }
  if (kind === "string") {
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value);
  }
  if (kind === "array") {
    let list: unknown[];
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) list = [];
      else if (s.startsWith("[")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(s);
        } catch {
          throw new EditorArgError(`argument '${path}' is not a valid JSON list`);
        }
        list = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        list = s.split(",").map((p) => p.trim()).filter(Boolean);
      }
    } else if (Array.isArray(value)) {
      list = value;
    } else {
      list = [value];
    }
    const items = schema.items;
    if (items && Object.keys(items).length > 0) return list.map((v, i) => coerceEditorValue(`${path}[${i}]`, v, items));
    return list;
  }
  if (kind === "object") {
    let obj: unknown = value;
    if (typeof value === "string") {
      const s = value.trim();
      if (!s) return {};
      try {
        obj = JSON.parse(s);
      } catch {
        throw new EditorArgError(`argument '${path}' is not a valid JSON object`);
      }
    }
    if (!isRecord(obj)) throw new EditorArgError(`argument '${path}' must be an object`);
    const props = schema.properties;
    if (!props || Object.keys(props).length === 0) return obj;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      const prop = props[key];
      if (prop) out[key] = coerceEditorValue(`${path}.${key}`, v, prop);
      else if (schema.additionalProperties === false) throw new EditorArgError(`argument '${path}' has unknown key '${key}'`);
      else out[key] = v;
    }
    for (const key of schema.required ?? []) {
      if (!(key in out)) throw new EditorArgError(`argument '${path}' needs key '${key}'`);
    }
    return out;
  }
  return value;
}

/** _registry.coerce: `value` in the shape `schema` asks for; throws when it cannot be. */
function coerceEditorValue(path: string, value: unknown, schema: JsonSchema): unknown {
  if (value === null || value === undefined) {
    if (acceptsNull(schema)) return null;
    throw new EditorArgError(`argument '${path}' must not be null`);
  }
  if (schema.enum) {
    const choices = schema.enum;
    if (choices.includes(value as string)) return value;
    if (typeof value === "string") {
      const wanted = value.trim().toLowerCase();
      const hit = choices.find((c) => typeof c === "string" && c.toLowerCase() === wanted);
      if (hit !== undefined) return hit;
    }
    if (typeof value === "number") {
      const hit = choices.find((c) => typeof c === "string" && c === String(value));
      if (hit !== undefined) return hit;
    }
    throw new EditorArgError(`argument '${path}' is not one of the choices`);
  }
  const kinds = kindsOf(schema);
  let last: EditorArgError | undefined;
  for (const kind of kinds) {
    try {
      return coerceKind(path, value, kind, schema);
    } catch (error) {
      if (!(error instanceof EditorArgError)) throw error;
      last = error;
    }
  }
  if (last) throw last;
  return value;
}

/**
 * zenvi-core `_registry.coerce_args`: coerce each known argument to its
 * schema, leaving what cannot be coerced (and unknown arguments) for the
 * validator to refuse. Non-object input is returned as-is.
 */
export function coerceEditorArgs(schema: JsonSchemaObject, args: unknown): unknown {
  if (args === null || args === undefined) return {};
  if (!isRecord(args)) return args;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (HIDDEN_PARAMS.has(key)) continue;
    const prop = schema.properties[key];
    if (!prop) {
      // Unknown keys stay (validation refuses them), except empty stubs.
      if (value !== "" && value !== undefined) out[key] = value;
      continue;
    }
    if (value === undefined) continue;
    if (value === null) {
      if (acceptsNull(prop)) out[key] = null;
      continue;
    }
    if (value === "" && !acceptsEmptyString(prop)) continue;
    try {
      out[key] = coerceEditorValue(key, value, prop);
    } catch (error) {
      if (!(error instanceof EditorArgError)) throw error;
      out[key] = value;
    }
  }
  return out;
}

/** Whether a contract tool's desktop handler is an editor tool (registered with `@editor_tool`). */
export function isEditorToolHandler(handler: string | undefined): boolean {
  return typeof handler === "string" && handler.startsWith("src/classes/editor_tools/");
}
