/**
 * Test helpers: a real Zenvi Link host server (packages/adobe-link
 * extension/server: protocol, auth, schema validation, queue, images) with a
 * fake ExtendScript bridge, and its discovery + token files written by the
 * extension's own DiscoveryFile. Test-only.
 */

import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { catalogFor, toCatalogJson, type CatalogToolJson, type HostId } from "@zenvi/adobe-link";

const require = createRequire(import.meta.url);
// packages/adobe-link/src/index.ts → packages/adobe-link
const linkRoot = path.dirname(path.dirname(require.resolve("@zenvi/adobe-link")));

interface LinkServer {
  start(): Promise<{ url: string; port: number; token: string }>;
  stop(): Promise<void>;
  readonly url: string;
  readonly token: string;
}

interface DiscoveryFileInstance {
  readonly file: string;
  readonly tokenFile: string;
  publish(details: { url: string; token: string; project: string | null; version: string; appName: string; appVersion: string }): void;
  remove(): boolean;
}

const { createLinkServer } = require(path.join(linkRoot, "extension", "server", "server.js")) as {
  createLinkServer(options: { host: HostId; catalog: { host: HostId; version: string; tools: CatalogToolJson[] }; bridge: { evalScript(script: string): Promise<string> }; tempDir?: string }): LinkServer;
};
const { DiscoveryFile } = require(path.join(linkRoot, "extension", "server", "discovery.js")) as {
  DiscoveryFile: new (options: { host: HostId; dir: string; pid?: number; now?: () => Date; minIntervalMs?: number }) => DiscoveryFileInstance;
};

/** What a fake tool returns: a receipt's status/summary/data (the rest is filled in). */
export interface FakeReceipt {
  status?: "ok" | "applied" | "unchanged" | "refused" | "error";
  summary?: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  undoSteps?: number | null;
  error?: { code: string; message: string };
}

export type FakeHostHandler = (args: Record<string, unknown>) => FakeReceipt | Promise<FakeReceipt>;

export interface FakeLinkHost {
  host: HostId;
  url: string;
  token: string;
  /** tools/call arguments as the bridge received them (after schema defaults). */
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  discoveryFile: string;
  stop(): Promise<void>;
}

export interface FakeLinkHostOptions {
  host: HostId;
  /** `~/.openshot_qt` of the test (discovery files go to `<desktopDir>/link`). */
  desktopDir: string;
  /** Extra catalog tools (added unless the real catalog already has that name). */
  tools?: Array<Partial<CatalogToolJson> & { name: string }>;
  handlers?: Record<string, FakeHostHandler>;
  project?: string | null;
  appVersion?: string;
  lastActive?: string;
  /** Discovery `pid` (default this process, so it counts as alive). */
  pid?: number;
  tempDir?: string;
}

/** A Zenvi Link server for `host` whose ExtendScript side is `handlers`; publishes its discovery file. */
export async function fakeLinkHost(options: FakeLinkHostOptions): Promise<FakeLinkHost> {
  const { host } = options;
  const real = toCatalogJson(host, catalogFor(host));
  const names = new Set(real.tools.map((t) => t.name));
  const extra: CatalogToolJson[] = (options.tools ?? [])
    .filter((t) => !names.has(t.name))
    .map((t) => ({
      title: t.name,
      description: `Test tool ${t.name}.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      returnsImage: false,
      timeoutMs: 120000,
      ...t,
    }));
  const calls: FakeLinkHost["calls"] = [];
  const dispatch = async (tool: string, argsJson: string): Promise<string> => {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    calls.push({ tool, args });
    const handler = options.handlers?.[tool];
    const got: FakeReceipt = handler ? await handler(args) : { status: "ok", summary: `${tool} ran`, data: {} };
    const failed = got.status === "refused" || got.status === "error";
    return JSON.stringify({
      contract: 3,
      status: got.status ?? "ok",
      tool,
      host,
      summary: got.summary ?? `${tool} ran`,
      data: got.data ?? {},
      warnings: got.warnings ?? [],
      undoSteps: got.undoSteps === undefined ? (failed || got.status === "ok" ? 0 : 1) : got.undoSteps,
      ...(got.error ? { error: got.error } : {}),
    });
  };
  const bridge = {
    // The server evaluates `ZenviLink.dispatch("<tool>", "<args json>")` in ExtendScript.
    evalScript: async (script: string) => {
      let pending: Promise<string> | undefined;
      vm.runInNewContext(script, { ZenviLink: { dispatch: (tool: string, json: string) => ((pending = dispatch(tool, json)), "") } });
      return pending ?? "";
    },
  };
  const server = createLinkServer({ host, catalog: { ...real, tools: [...real.tools, ...extra] }, bridge, tempDir: options.tempDir });
  await server.start();
  const lastActive = options.lastActive;
  const file = new DiscoveryFile({ host, dir: path.join(options.desktopDir, "link"), pid: options.pid, now: lastActive ? () => new Date(lastActive) : undefined });
  file.publish({
    url: server.url,
    token: server.token,
    project: options.project ?? null,
    version: real.version,
    appName: host === "aftereffects" ? "Adobe After Effects 2026" : "Adobe Premiere Pro 2026",
    appVersion: options.appVersion ?? "26.3.0",
  });
  return {
    host,
    url: server.url,
    token: server.token,
    calls,
    discoveryFile: file.file,
    async stop() {
      file.remove();
      await server.stop();
    },
  };
}

/**
 * Zenvi Link for After Effects running the real host script (the ExtendScript
 * the extension ships, in adobe-link's ES3 realm) on adobe-link's mock After
 * Effects DOM with one comp, "Promo".
 */
export async function realAfterEffects(options: { desktopDir: string; tempDir: string }): Promise<{ stop(): Promise<void> }> {
  const testing = (await import(path.join(linkRoot, "src", "testing", "index.ts"))) as {
    createAeMock(options: { tempDir: string }): { globals: Record<string, unknown>; addComp(comp: { name: string }): unknown };
    loadHostScript(app: "aeft", globals: Record<string, unknown>): unknown;
  };
  const cep = (await import(path.join(linkRoot, "src", "testing", "fake-cep.ts"))) as { evalInHostScript(host: unknown): (script: string) => string };
  const mock = testing.createAeMock({ tempDir: options.tempDir });
  mock.addComp({ name: "Promo" });
  const evaluate = cep.evalInHostScript(testing.loadHostScript("aeft", mock.globals));
  const catalog = toCatalogJson("aftereffects", catalogFor("aftereffects"));
  const server = createLinkServer({ host: "aftereffects", catalog, bridge: { evalScript: async (script) => evaluate(script) }, tempDir: options.tempDir });
  await server.start();
  const file = new DiscoveryFile({ host: "aftereffects", dir: path.join(options.desktopDir, "link") });
  file.publish({ url: server.url, token: server.token, project: null, version: catalog.version, appName: "Adobe After Effects 2026", appVersion: "26.3.0" });
  return {
    async stop() {
      file.remove();
      await server.stop();
    },
  };
}

/** Catalog entries for tools the Zenvi Link catalog may not have yet (the W1b/W1c tools these tests orchestrate). */
export const RENDER_FOR_ZENVI_TOOL = {
  name: "ae_render_for_zenvi",
  inputSchema: {
    type: "object" as const,
    properties: {
      comp: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", minLength: 1 }] },
      alpha: { type: "boolean", default: false },
      output: { type: "string" },
    },
    additionalProperties: false as const,
  },
  timeoutMs: 1_800_000,
};

export const EXPORT_XML_TOOL = {
  name: "premiere_export_xml",
  inputSchema: {
    type: "object" as const,
    properties: { output: { type: "string" }, overwrite: { type: "boolean", default: false }, sequence: { type: "string", minLength: 1 } },
    additionalProperties: false as const,
  },
};

export const CAPTURE_FRAME_TOOL = {
  name: "ae_capture_frame",
  inputSchema: { type: "object" as const, properties: { time: { type: "number", minimum: 0 } }, additionalProperties: false as const },
  annotations: { readOnlyHint: true },
  returnsImage: true,
};
