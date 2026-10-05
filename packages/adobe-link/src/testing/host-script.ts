/**
 * Run a host script under Node: `loadHostScript("aeft", createAeMock().globals)`
 * concatenates the JSX exactly like the extension build (src/host-bundle.ts)
 * and evaluates it in a `vm` realm stripped down to ECMAScript 3 (realm.ts),
 * with the mock DOM as globals.
 */

import vm from "node:vm";
import { bundleHostScript, locateBundleLine, type HostApp, type HostBundle } from "../host-bundle.js";
import type { HostReceipt } from "../receipt.js";
import { BIND_REALM, ES3_REALM_SCRIPT, type HostGlobals, type Realm } from "./realm.js";


export interface RegisteredHostTool {
  name: string;
  title: string;
  mutating: boolean;
}

export interface LoadedHostScript {
  bundle: HostBundle;
  context: vm.Context;
  /** `ZenviLink.dispatch(name, JSON.stringify(args))`, parsed. */
  dispatch(name: string, args?: Record<string, unknown>): HostReceipt;
  /** The raw string dispatch returns (what evalScript hands the server). */
  dispatchRaw(name: string, argsJson: string): string;
  listTools(): RegisteredHostTool[];
  hostInfo(): Record<string, unknown>;
  /** Evaluate ExtendScript in the realm (like CEP evalScript). */
  evaluate(code: string): unknown;
  /** Source file and line for a bundle line (e.g. a HOST_ERROR receipt's error.line). */
  locate(line: number): { file: string; line: number } | undefined;
}

export interface LoadHostScriptOptions {
  /** Keep ES5+ built-ins in the realm (default false: ExtendScript-like). */
  modernRealm?: boolean;
}

/** A realm with the mock DOM wired in but no host script loaded (CEP before ScriptPath ran). */
export interface HostRealm {
  context: vm.Context;
  evaluate(code: string, filename?: string): unknown;
}

export function createHostRealm(globals: HostGlobals = {}, options: LoadHostScriptOptions = {}): HostRealm {
  const context = vm.createContext({});
  if (!options.modernRealm) vm.runInContext(ES3_REALM_SCRIPT, context, { filename: "es3-realm.js" });
  for (const [key, value] of Object.entries(globals)) context[key] = value;
  const toArray = vm.runInContext(
    "(function (items) { var out = []; for (var i = 0; i < items.length; i += 1) { out.push(items[i]); } return out; })",
    context,
  ) as <T>(items: readonly T[]) => T[];
  const realm: Realm = {
    array: (items) => toArray(items),
    evaluate: (code, filename) => vm.runInContext(code, context, { filename }),
    global: context as Record<string, unknown>,
  };
  globals[BIND_REALM]?.(realm);
  return { context, evaluate: (code, filename = "evalScript") => vm.runInContext(code, context, { filename }) };
}

export function loadHostScript(app: HostApp, globals: HostGlobals = {}, options: LoadHostScriptOptions = {}): LoadedHostScript {
  const bundle = bundleHostScript(app);
  const { context } = createHostRealm(globals, options);
  vm.runInContext(bundle.text, context, { filename: `${app}.jsx` });

  const zenvi = (): Record<string, (...args: unknown[]) => string> => {
    const value = context.ZenviLink as Record<string, (...args: unknown[]) => string> | undefined;
    if (!value) throw new Error("ZenviLink is not defined after loading the host script");
    return value;
  };
  const dispatchRaw = (name: string, argsJson: string): string => {
    const raw = zenvi().dispatch?.(name, argsJson);
    if (typeof raw !== "string") throw new Error(`dispatch returned ${typeof raw}, not a string`);
    return raw;
  };
  return {
    bundle,
    context,
    dispatchRaw,
    dispatch: (name, args = {}) => JSON.parse(dispatchRaw(name, JSON.stringify(args))) as HostReceipt,
    listTools: () => JSON.parse(zenvi().listTools?.() ?? "[]") as RegisteredHostTool[],
    hostInfo: () => JSON.parse(zenvi().hostInfo?.() ?? "{}") as Record<string, unknown>,
    evaluate: (code) => vm.runInContext(code, context, { filename: "evalScript" }),
    locate: (line) => locateBundleLine(bundle, line),
  };
}
