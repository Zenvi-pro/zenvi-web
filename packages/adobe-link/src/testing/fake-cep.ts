/**
 * A stand-in for `window.__adobe_cep__` (what CEP gives an extension page),
 * so the extension's boot code runs under Node: evalScript goes to a loaded
 * host script (or any function), events are recorded and can be fired.
 */

import { pathToFileURL } from "node:url";
import type { LoadedHostScript } from "./host-script.js";

export interface FakeCepOptions {
  appName: "AEFT" | "PPRO" | string;
  appVersion: string;
  extensionDir: string;
  /** Evaluates ExtendScript; return what CEP's callback would get. */
  evalScript: (script: string) => string | Promise<string>;
  extensionId?: string;
}

export interface FakeCepEvent {
  type: string;
  scope?: string;
  appId?: string;
  extensionId?: string;
  data?: string;
}

export class FakeCep {
  readonly dispatched: FakeCepEvent[] = [];
  readonly scripts: string[] = [];
  private readonly listeners = new Map<string, Set<(event: FakeCepEvent) => void>>();

  constructor(private readonly options: FakeCepOptions) {}

  evalScript(script: string, callback?: (result: string) => void): void {
    this.scripts.push(script);
    Promise.resolve()
      .then(() => this.options.evalScript(script))
      .then((result) => callback?.(result), () => callback?.("EvalScript error."));
  }

  getHostEnvironment(): string {
    return JSON.stringify({
      appName: this.options.appName,
      appVersion: this.options.appVersion,
      appId: this.options.appName,
      appLocale: "en_US",
      appUILocale: "en_US",
      isAppOnline: true,
      appSkinInfo: {
        baseFontFamily: "Helvetica",
        baseFontSize: 10,
        panelBackgroundColor: { antialiasLevel: 0, type: 1, color: { red: 35, green: 35, blue: 35, alpha: 255 } },
      },
    });
  }

  getSystemPath(kind: string): string {
    if (kind !== "extension") throw new Error(`FakeCep: no ${kind} path`);
    return pathToFileURL(this.options.extensionDir).href;
  }

  getExtensionId(): string {
    return this.options.extensionId ?? "pro.zenvi.link.service";
  }

  addEventListener(type: string, listener: (event: FakeCepEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: (event: FakeCepEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: FakeCepEvent): void {
    this.dispatched.push(event);
  }

  /** Deliver an event to this extension's listeners (an app event or another extension's message). */
  fire(type: string, data?: unknown): void {
    const event: FakeCepEvent = { type, data: data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data) };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** evalScript the way CEP does it in a host script realm: the result as a string, "EvalScript error." when it throws. */
export function evalInHostScript(host: Pick<LoadedHostScript, "evaluate">): (script: string) => string {
  return (script) => {
    try {
      const value = host.evaluate(script);
      return value === undefined || value === null ? "" : String(value);
    } catch {
      return "EvalScript error.";
    }
  };
}
