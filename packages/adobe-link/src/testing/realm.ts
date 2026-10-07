/**
 * The Node `vm` realm the host scripts run in during tests, made to look
 * like ExtendScript (ECMAScript 3): the ES5+ built-ins ExtendScript lacks are
 * deleted before the scripts load, so a host script that calls
 * `[].map`, `Object.assign` or `"x".startsWith` fails in tests exactly as it
 * would in After Effects or Premiere Pro, and the polyfills in
 * `common/01-polyfills.jsx` are what the tests exercise.
 */

/** Hook a mock's `globals` carry so loadHostScript can wire it to the realm. */
export const BIND_REALM: unique symbol = Symbol("zenvi-link.bind-realm");

export interface Realm {
  /** An Array of the script realm (so ES5 array methods are missing on it, as in ExtendScript). */
  array<T>(items: readonly T[]): T[];
  /** Evaluate code in the script realm (`$.evalFile`). Returns the completion value. */
  evaluate(code: string, filename: string): unknown;
  /** The script realm's global object (`$.global`). */
  readonly global: Record<string, unknown>;
}

export type RealmBinder = (realm: Realm) => void;

/** Globals passed to loadHostScript; a mock adds its BIND_REALM hook. */
export type HostGlobals = Record<string, unknown> & { [BIND_REALM]?: RealmBinder };

/** Lets a mock built before the realm exists create realm arrays later. */
export class RealmLink {
  private realm: Realm | undefined;

  bind(realm: Realm): void {
    this.realm = realm;
  }

  /** Realm array when bound (else a plain copy). */
  array<T>(items: readonly T[]): T[] {
    return this.realm ? this.realm.array(items) : [...items];
  }

  evaluate(code: string, filename: string): unknown {
    if (!this.realm) throw new Error("this mock is not loaded into a host script realm yet");
    return this.realm.evaluate(code, filename);
  }

  get global(): Record<string, unknown> | undefined {
    return this.realm?.global;
  }
}

/** Run in the fresh realm before any host script: removes what ExtendScript does not have. */
export const ES3_REALM_SCRIPT = `
(function (global) {
  function strip(target, names) {
    for (var i = 0; i < names.length; i += 1) {
      delete target[names[i]];
    }
  }
  strip(global, ["JSON", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry", "Promise", "Symbol",
    "Proxy", "Reflect", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics", "BigInt", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float16Array", "Float32Array",
    "Float64Array", "BigInt64Array", "BigUint64Array", "AggregateError", "Intl", "WebAssembly", "globalThis", "Iterator",
    "SuppressedError", "DisposableStack", "AsyncDisposableStack"]);
  strip(Object, ["keys", "values", "entries", "assign", "create", "defineProperty", "defineProperties", "getPrototypeOf",
    "setPrototypeOf", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors",
    "getOwnPropertySymbols", "freeze", "isFrozen", "seal", "isSealed", "preventExtensions", "isExtensible", "is",
    "fromEntries", "hasOwn", "groupBy"]);
  strip(Array, ["isArray", "from", "of", "fromAsync"]);
  strip(Array.prototype, ["indexOf", "lastIndexOf", "forEach", "map", "filter", "some", "every", "reduce", "reduceRight",
    "find", "findIndex", "findLast", "findLastIndex", "includes", "fill", "keys", "values", "entries", "flat", "flatMap",
    "at", "copyWithin", "toSorted", "toReversed", "toSpliced", "with"]);
  strip(String, ["fromCodePoint", "raw"]);
  strip(String.prototype, ["trim", "trimStart", "trimEnd", "trimLeft", "trimRight", "startsWith", "endsWith", "includes",
    "repeat", "padStart", "padEnd", "codePointAt", "normalize", "at", "replaceAll", "matchAll", "isWellFormed",
    "toWellFormed"]);
  strip(Function.prototype, ["bind"]);
  strip(Date, ["now"]);
  strip(Date.prototype, ["toISOString", "toJSON"]);
  strip(Number, ["isInteger", "isFinite", "isNaN", "isSafeInteger", "parseFloat", "parseInt", "EPSILON",
    "MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER"]);
  strip(Math, ["trunc", "sign", "cbrt", "log10", "log2", "log1p", "expm1", "hypot", "fround", "imul", "clz32", "sinh",
    "cosh", "tanh", "asinh", "acosh", "atanh", "f16round"]);
}(this));
`;
