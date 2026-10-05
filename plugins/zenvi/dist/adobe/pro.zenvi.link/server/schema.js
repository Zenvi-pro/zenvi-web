"use strict";

/**
 * Tool arguments against the catalog's JSON Schema: the subset zod's
 * toJSONSchema emits for host tools (type, enum, const, ranges, lengths,
 * pattern, items/prefixItems, properties/required/additionalProperties,
 * anyOf/oneOf). Every host tool refuses bad arguments the same way, before
 * any ExtendScript runs, and omitted arguments get the schema `default`.
 */

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return type === "number" ? actual === "number" || actual === "integer" : actual === type;
}

function label(path) {
  return path.length ? "`" + path.join(".") + "`" : "arguments";
}

const ARTICLE = { integer: "an integer", number: "a number", string: "a string", boolean: "true or false", array: "an array", object: "an object", null: "null" };

/** "an integer >= 1", "one of \"a\", \"b\"", "an object with index". */
function describe(schema) {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return "one of " + schema.enum.map((v) => JSON.stringify(v)).join(", ");
  const branches = schema.anyOf || schema.oneOf;
  if (branches) return branches.map(describe).join(", or ");
  const types = [].concat(schema.type || []);
  let text = types.length ? types.map((t) => ARTICLE[t] || t).join(" or ") : "a value";
  const limits = [];
  if (schema.minimum !== undefined) limits.push(">= " + schema.minimum);
  if (schema.exclusiveMinimum !== undefined) limits.push("> " + schema.exclusiveMinimum);
  if (schema.maximum !== undefined && schema.maximum < Number.MAX_SAFE_INTEGER) limits.push("<= " + schema.maximum);
  if (schema.exclusiveMaximum !== undefined) limits.push("< " + schema.exclusiveMaximum);
  if (limits.length) text += " " + limits.join(" and ");
  if (schema.pattern) text += " matching " + schema.pattern;
  if (schema.minItems !== undefined && schema.minItems === schema.maxItems) text += " of " + schema.minItems + " items";
  if (types[0] === "object" && schema.properties) text += " with " + Object.keys(schema.properties).join(", ");
  return text;
}

/** First problem with `value` against `schema`, as a sentence, or null. */
function check(schema, value, path) {
  const branches = schema.anyOf || schema.oneOf;
  if (branches) {
    const passing = branches.filter((branch) => check(branch, value, path) === null).length;
    if (passing === 0 || (schema.oneOf && passing > 1)) {
      // One branch of the right type gives the most useful message.
      const typed = branches.filter((branch) => [].concat(branch.type || []).some((t) => matchesType(value, t)));
      if (typed.length === 1) return check(typed[0], value, path);
      return label(path) + " must be " + describe(schema) + ", got " + typeOf(value);
    }
    return null;
  }
  if (schema.const !== undefined && value !== schema.const) return label(path) + " must be " + JSON.stringify(schema.const);
  if (schema.enum && schema.enum.indexOf(value) < 0) {
    return label(path) + " must be " + describe(schema) + ", got " + JSON.stringify(value);
  }
  const types = [].concat(schema.type || []);
  if (types.length && !types.some((t) => matchesType(value, t))) {
    return label(path) + " must be " + describe(schema) + ", got " + typeOf(value);
  }
  const outOfRange = () => label(path) + " must be " + describe(schema) + ", got " + JSON.stringify(value);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return outOfRange();
    if (schema.maximum !== undefined && value > schema.maximum) return outOfRange();
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return outOfRange();
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return outOfRange();
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return label(path) + (schema.minLength === 1 ? " must not be empty" : " must be at least " + schema.minLength + " characters");
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return label(path) + " must be at most " + schema.maxLength + " characters";
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return label(path) + " must match " + schema.pattern + ", got " + JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return label(path) + " needs at least " + schema.minItems + " items";
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return label(path) + " takes at most " + schema.maxItems + " items";
    const prefix = schema.prefixItems || [];
    for (let i = 0; i < value.length; i += 1) {
      const itemSchema = i < prefix.length ? prefix[i] : schema.items;
      if (itemSchema && typeof itemSchema === "object") {
        const problem = check(itemSchema, value[i], path.concat(String(i)));
        if (problem) return problem;
      }
    }
  }
  if (typeOf(value) === "object") {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined) return label(path.concat(key)) + " is required";
    }
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        const problem = check(properties[key], value[key], path.concat(key));
        if (problem) return problem;
      } else if (schema.additionalProperties === false) {
        const known = Object.keys(properties);
        return label(path.concat(key)) + " is not a known argument" + (known.length ? " (expected: " + known.join(", ") + ")" : " (this takes no arguments)");
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const problem = check(schema.additionalProperties, value[key], path.concat(key));
        if (problem) return problem;
      }
    }
  }
  return null;
}

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** `value` with schema defaults filled in for omitted properties (nested objects too, not inside anyOf). */
function withDefaults(schema, value) {
  if (typeOf(value) !== "object" || !schema.properties) return value;
  const out = Object.assign({}, value);
  for (const key of Object.keys(schema.properties)) {
    const property = schema.properties[key];
    if (out[key] === undefined && property.default !== undefined) out[key] = copy(property.default);
    else if (out[key] !== undefined) out[key] = withDefaults(property, out[key]);
  }
  return out;
}

function acceptsNull(schema) {
  if (!schema) return false;
  if (schema.const === null || (schema.enum && schema.enum.indexOf(null) >= 0)) return true;
  if ([].concat(schema.type || []).indexOf("null") >= 0) return true;
  return (schema.anyOf || schema.oneOf || []).some(acceptsNull);
}

/**
 * Validate tool arguments (`undefined` = `{}`). A `null` the schema does not
 * allow counts as omitted (models send null for "not set").
 * Returns {ok: true, args} with defaults filled, or {ok: false, message}.
 */
function validateArguments(schema, raw) {
  if (raw !== undefined && raw !== null && typeOf(raw) !== "object") return { ok: false, message: "arguments must be a JSON object, got " + typeOf(raw) };
  const properties = schema.properties || {};
  const args = {};
  for (const key of Object.keys(raw || {})) {
    if (raw[key] !== null || acceptsNull(properties[key])) args[key] = raw[key];
  }
  const problem = check(schema, args, []);
  if (problem) return { ok: false, message: problem };
  return { ok: true, args: withDefaults(schema, args) };
}

module.exports = { validateArguments, check, describe };
