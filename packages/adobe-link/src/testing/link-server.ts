/**
 * Typed access to the extension's CommonJS modules (extension/server,
 * extension/panel) for tests. They ship as plain JavaScript because CEP
 * loads them without a build step.
 */

import { createRequire } from "node:module";
import type { CatalogJson } from "../catalog/types.js";
import type { HostReceipt } from "../receipt.js";

const require = createRequire(import.meta.url);

export interface Bridge {
  evalScript(script: string): Promise<string>;
}

export interface CallEvent {
  tool: string;
  status: HostReceipt["status"];
  summary: string;
  ms: number;
  at: string;
}

export interface LinkServerOptions {
  host: "aftereffects" | "premiere";
  catalog: CatalogJson;
  bridge: Bridge;
  token?: string;
  busyAfterMs?: number;
  tempDir?: string;
  bodyLimit?: number;
  log?: (line: string) => void;
  onActivity?: () => void;
}

export interface LinkServer {
  start(): Promise<{ url: string; port: number; token: string }>;
  stop(): Promise<void>;
  callTool(name: string, args: unknown): Promise<{ receipt: HostReceipt; images: { type: "image"; data: string; mimeType: string }[] }>;
  evalWhenIdle(script: string, timeoutMs?: number): Promise<string | null>;
  on(event: "call", listener: (call: CallEvent) => void): void;
  off(event: "call", listener: (call: CallEvent) => void): void;
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly host: string;
  readonly version: string;
  readonly queue: { idle: boolean };
  recentCalls(): CallEvent[];
}

export const serverModule = require("../../extension/server/server.js") as {
  createLinkServer(options: LinkServerOptions): LinkServer;
  dispatchScript(name: string, args: unknown): string;
  scriptLiteral(text: string): string;
  PROTOCOL_VERSIONS: string[];
};

export interface QueueOutcome {
  kind: "done" | "error" | "timeout" | "busy" | "expired";
  ms: number;
  value?: unknown;
  error?: unknown;
  running?: { label: string; ms: number } | null;
}

export interface CallQueue {
  readonly idle: boolean;
  run(label: string, timeoutMs: number, execute: () => Promise<unknown>): Promise<QueueOutcome>;
  current(): { label: string; ms: number } | null;
}

export const queueModule = require("../../extension/server/queue.js") as {
  CallQueue: new (options?: { busyAfterMs?: number; now?: () => number }) => CallQueue;
};

export const schemaModule = require("../../extension/server/schema.js") as {
  validateArguments(schema: unknown, raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; message: string };
};

export interface DiscoveryFileInstance {
  readonly file: string;
  readonly tokenFile: string;
  readonly pid: number;
  publish(details: { url: string; token: string; project: string | null; version: string; appName: string; appVersion: string }): void;
  setProject(project: string | null): boolean;
  touch(): void;
  remove(): boolean;
}

export const discoveryModule = require("../../extension/server/discovery.js") as {
  DiscoveryFile: new (options: { host: string; dir?: string; pid?: number; now?: () => Date; minIntervalMs?: number }) => DiscoveryFileInstance;
  DISCOVERY_KEYS: string[];
  linkDir(home?: string): string;
};

export interface BootedLink {
  host: string;
  server: LinkServer;
  discovery: DiscoveryFileInstance;
  status(): Record<string, unknown> & { mode: string; url: string; host_script: { ok: boolean; problem: string | null }; recent: CallEvent[] };
  stop(): Promise<void>;
}

export const bootModule = require("../../extension/server/index.js") as {
  boot(options: {
    cep?: unknown;
    bridge?: unknown;
    window?: unknown;
    mode?: "service" | "panel";
    extensionDir?: string;
    home?: string;
    linkDir?: string;
    pollMs?: number;
    touchIntervalMs?: number;
    busyAfterMs?: number;
    log?: (line: string) => void;
  }): Promise<BootedLink>;
  marketingName(host: string, appVersion: string): string;
  hostOf(environment: { appName?: string }): string | null;
  EVENTS: Record<"activate" | "beforeQuit" | "statusRequest" | "status" | "call", string>;
};

export const bridgeModule = require("../../extension/server/bridge.js") as {
  createCepBridge(cep: unknown): Bridge & Record<string, (...args: never[]) => unknown>;
  fileUriToPath(uri: string): string;
};
