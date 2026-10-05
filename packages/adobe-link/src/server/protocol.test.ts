import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AE_TOOLS } from "../catalog/aftereffects.js";
import { toCatalogJson, type CatalogJson, type CatalogToolJson } from "../catalog/types.js";
import { createAeMock } from "../testing/ae-mock.js";
import { TINY_PNG_BASE64 } from "../testing/ae-mock.js";
import { evalInHostScript } from "../testing/fake-cep.js";
import { loadHostScript } from "../testing/host-script.js";
import { serverModule, type Bridge, type LinkServer, type LinkServerOptions } from "../testing/link-server.js";

const servers: LinkServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "zenvi-link-protocol-"));
}

/** A server over the real After Effects host script running on the mock DOM. */
async function aeServer(options: Partial<LinkServerOptions> = {}) {
  const mock = createAeMock({ tempDir: tempDir() });
  const host = loadHostScript("aeft", mock.globals);
  const evaluate = evalInHostScript(host);
  const scripts: string[] = [];
  const bridge: Bridge = {
    evalScript: async (script) => {
      scripts.push(script);
      return evaluate(script);
    },
  };
  const server = serverModule.createLinkServer({ host: "aftereffects", catalog: toCatalogJson("aftereffects", AE_TOOLS), bridge, ...options });
  servers.push(server);
  await server.start();
  return { server, mock, scripts };
}

/** A server with a hand-made catalog and bridge. */
async function customServer(tools: Partial<CatalogToolJson>[], bridge: Bridge, options: Partial<LinkServerOptions> = {}) {
  const catalog: CatalogJson = {
    host: "aftereffects",
    version: "9.9.9",
    tools: tools.map((tool) => ({
      name: "ae_t",
      title: "Test",
      description: "A test tool.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      returnsImage: false,
      timeoutMs: 120000,
      ...tool,
    })) as CatalogToolJson[],
  };
  const server = serverModule.createLinkServer({ host: "aftereffects", catalog, bridge, ...options });
  servers.push(server);
  await server.start();
  return server;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function request(server: LinkServer, options: { body?: unknown; raw?: string; headers?: Record<string, string>; method?: string; path?: string; token?: string | null } = {}): Promise<Reply> {
  const body = options.raw ?? (options.body === undefined ? "" : JSON.stringify(options.body));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? server.token}` }),
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.port, path: options.path ?? "/mcp", method: options.method ?? "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

let nextId = 1;
const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) });
const call = (name: string, args?: unknown) => rpc("tools/call", { name, ...(args === undefined ? {} : { arguments: args }) });

describe("HTTP guards", () => {
  test("no token or a wrong token is 401 with WWW-Authenticate: Bearer", async () => {
    const { server } = await aeServer();
    for (const token of [null, "wrong", server.token.slice(0, -1)]) {
      const reply = await request(server, { body: rpc("ping"), token });
      expect(reply.status).toBe(401);
      expect(reply.headers["www-authenticate"]).toMatch(/^Bearer/);
    }
  });

  test("any Origin header is 403, even with the token", async () => {
    const { server } = await aeServer();
    for (const origin of ["https://evil.example", "http://127.0.0.1:" + server.port, "null"]) {
      expect((await request(server, { body: rpc("ping"), headers: { Origin: origin } })).status).toBe(403);
    }
  });

  test("Host must be 127.0.0.1:<port> or localhost:<port>", async () => {
    const { server } = await aeServer();
    for (const host of ["evil.example", `evil.example:${server.port}`, "127.0.0.1:1", `[::1]:${server.port}`]) {
      expect((await request(server, { body: rpc("ping"), headers: { Host: host } })).status).toBe(403);
    }
    expect((await request(server, { body: rpc("ping"), headers: { Host: `localhost:${server.port}` } })).status).toBe(200);
  });

  test("GET and DELETE are 405; other paths 404", async () => {
    const { server } = await aeServer();
    for (const method of ["GET", "DELETE"]) {
      const reply = await request(server, { method });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe("POST");
    }
    expect((await request(server, { body: rpc("ping"), path: "/other" })).status).toBe(404);
  });

  test("bodies over the limit are 413", async () => {
    const { server } = await aeServer({ bodyLimit: 1024 });
    const reply = await request(server, { body: rpc("ping", { pad: "x".repeat(4096) }) });
    expect(reply.status).toBe(413);
  });

  test("malformed JSON is a parse error; batches and non-JSON-RPC are invalid requests", async () => {
    const { server } = await aeServer();
    expect((await request(server, { raw: "{nope" })).json.error.code).toBe(-32700);
    expect((await request(server, { body: [rpc("ping")] })).json.error.code).toBe(-32600);
    expect((await request(server, { body: { id: 1, method: "ping" } })).json.error.code).toBe(-32600);
  });
});

describe("JSON-RPC methods", () => {
  test.each([
    ["2025-06-18", "2025-06-18"],
    ["2025-03-26", "2025-03-26"],
    ["2024-11-05", "2024-11-05"],
    ["1999-01-01", "2025-06-18"],
    [undefined, "2025-06-18"],
  ])("initialize with %s negotiates %s", async (asked, agreed) => {
    const { server } = await aeServer();
    const reply = await request(server, { body: rpc("initialize", { protocolVersion: asked, capabilities: {}, clientInfo: { name: "t", version: "1" } }) });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toMatch(/^application\/json/);
    expect(reply.json.result).toMatchObject({
      protocolVersion: agreed,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "zenvi-link-aftereffects", title: "Zenvi Link for After Effects", version: toCatalogJson("aftereffects", AE_TOOLS).version },
    });
    expect(reply.json.result.instructions).toContain("ae_get_state");
  });

  test("notifications get 202 with no body; mcp-session-id is ignored", async () => {
    const { server } = await aeServer();
    const reply = await request(server, { body: { jsonrpc: "2.0", method: "notifications/initialized" }, headers: { "mcp-session-id": "abc" } });
    expect(reply.status).toBe(202);
    expect(reply.text).toBe("");
    expect((await request(server, { body: rpc("ping"), headers: { "mcp-session-id": "abc" } })).json.result).toEqual({});
  });

  test("unknown methods are -32601", async () => {
    const { server } = await aeServer();
    for (const method of ["resources/list", "prompts/list", "sampling/createMessage"]) {
      expect((await request(server, { body: rpc(method) })).json.error.code).toBe(-32601);
    }
  });

  test("tools/list is the catalog", async () => {
    const { server } = await aeServer();
    const catalog = toCatalogJson("aftereffects", AE_TOOLS);
    const listed = (await request(server, { body: rpc("tools/list") })).json.result.tools;
    expect(listed).toEqual(
      catalog.tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { title: tool.title, ...tool.annotations } })),
    );
  });
});

describe("long calls", () => {
  test("a call that outlasts Node 12's default socket timeout still gets its response", async () => {
    // Node 12 creates servers with timeout = 120000; simulate it, scaled down.
    const create = http.createServer;
    vi.spyOn(http, "createServer").mockImplementation(((...args: Parameters<typeof http.createServer>) => {
      const created = create(...args);
      created.timeout = 100;
      return created;
    }) as typeof http.createServer);
    const ok = JSON.stringify({ contract: 3, status: "applied", tool: "ae_render", host: "aftereffects", summary: "Rendered", data: {}, warnings: [], undoSteps: 1 });
    const server = await customServer([{ name: "ae_render", timeoutMs: 10_000 }], {
      evalScript: () => new Promise((resolve) => setTimeout(() => resolve(ok), 400)),
    });
    vi.restoreAllMocks();
    const reply = await request(server, { body: call("ae_render", {}) });
    expect(reply.status).toBe(200);
    expect(reply.json.result.structuredContent.summary).toBe("Rendered");
  });
});

describe("tools/call", () => {
  test("runs the host script and returns the receipt as text and structuredContent", async () => {
    const { server, mock, scripts } = await aeServer();
    mock.addComp({ name: "Promo" });
    const reply = await request(server, { body: call("ae_get_state", {}) });
    const result = reply.json.result;
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(result.structuredContent).toMatchObject({ contract: 3, status: "ok", tool: "ae_get_state", host: "aftereffects", data: { active_comp: { name: "Promo" } } });
    expect(scripts).toEqual(['ZenviLink.dispatch("ae_get_state", "{}")']);
  });

  test("bad arguments are refused before any ExtendScript runs", async () => {
    const { server, scripts } = await aeServer();
    const result = (await request(server, { body: call("ae_get_state", { verbose: true }) })).json.result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "refused",
      undoSteps: 0,
      error: { code: "INVALID_ARGUMENT", message: "Invalid arguments for ae_get_state: `verbose` is not a known argument (this takes no arguments)" },
    });
    expect(result.structuredContent.summary).toMatch(/^Error: Invalid arguments/);
    expect(scripts).toEqual([]);
  });

  test("unknown tools are a JSON-RPC error", async () => {
    const { server } = await aeServer();
    const reply = await request(server, { body: call("ae_nope", {}) });
    expect(reply.json.error).toEqual({ code: -32602, message: "Unknown tool: ae_nope" });
  });

  test("schema defaults are filled and arguments reach ExtendScript as ASCII", async () => {
    const scripts: string[] = [];
    const server = await customServer(
      [{ inputSchema: { type: "object", properties: { text: { type: "string" }, d: { type: "number", default: 0.6 } }, required: ["text"], additionalProperties: false } }],
      {
        evalScript: async (script) => {
          scripts.push(script);
          return JSON.stringify({ contract: 3, status: "ok", tool: "ae_t", host: "aftereffects", summary: "ok", data: {}, warnings: [], undoSteps: 0 });
        },
      },
    );
    await request(server, { body: call("ae_t", { text: "Caf\u00e9 \u2028 \u{1F3AC}" }) });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).not.toMatch(/[\u0080-\uffff]/);
    const host = loadHostScript("aeft", createAeMock().globals);
    host.evaluate('ZenviLink.register("ae_t", function (args) { return ZenviLink.ok("echo", args); }, {});');
    const echoed = JSON.parse(String(host.evaluate(scripts[0] ?? "")));
    expect(echoed.data).toEqual({ text: "Caf\u00e9 \u2028 \u{1F3AC}", d: 0.6 });
  });

  test("a host script that does not answer is a HOST_ERROR with guidance", async () => {
    const server = await customServer([{}], { evalScript: async () => "EvalScript error." });
    const receipt = (await request(server, { body: call("ae_t", {}) })).json.result.structuredContent;
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(receipt.summary).toContain("Reload Zenvi Link");
  });

  test("calls run one at a time in arrival order", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const server = await customServer(
      [{ name: "ae_a" }, { name: "ae_b" }, { name: "ae_c" }],
      {
        evalScript: async (script) => {
          const name = /dispatch\("([a-z_]+)"/.exec(script)?.[1] ?? "?";
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          order.push(name);
          await new Promise((resolve) => setTimeout(resolve, name === "ae_a" ? 30 : 5));
          inFlight -= 1;
          return JSON.stringify({ contract: 3, status: "ok", tool: name, host: "aftereffects", summary: name, data: {}, warnings: [], undoSteps: 0 });
        },
      },
    );
    const a = request(server, { body: call("ae_a", {}) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = request(server, { body: call("ae_b", {}) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const c = request(server, { body: call("ae_c", {}) });
    const replies = await Promise.all([a, b, c]);
    expect(replies.map((reply) => reply.json.result.structuredContent.tool)).toEqual(["ae_a", "ae_b", "ae_c"]);
    expect(order).toEqual(["ae_a", "ae_b", "ae_c"]);
    expect(maxInFlight).toBe(1);
  });

  test("timeout, then BUSY while the stuck call runs on, then normal again", async () => {
    let release: (value: string) => void = () => undefined;
    const ok = (name: string) => JSON.stringify({ contract: 3, status: "ok", tool: name, host: "aftereffects", summary: name, data: {}, warnings: [], undoSteps: 0 });
    let calls = 0;
    const server = await customServer(
      [{ name: "ae_slow", timeoutMs: 60 }, { name: "ae_quick" }],
      {
        evalScript: (script) => {
          calls += 1;
          if (script.includes("ae_slow")) return new Promise<string>((resolve) => (release = resolve));
          return Promise.resolve(ok("ae_quick"));
        },
      },
      { busyAfterMs: 100 },
    );
    const timedOut = (await request(server, { body: call("ae_slow", {}) })).json.result;
    expect(timedOut.isError).toBe(true);
    expect(timedOut.structuredContent).toMatchObject({ status: "error", error: { code: "TIMEOUT" } });
    expect(timedOut.structuredContent.summary).toContain("may still be running in After Effects");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const busy = (await request(server, { body: call("ae_quick", {}) })).json.result.structuredContent;
    expect(busy).toMatchObject({ status: "refused", error: { code: "BUSY" } });
    expect(busy.summary).toContain("ae_slow");
    expect(calls).toBe(1);
    release(ok("ae_slow"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await request(server, { body: call("ae_quick", {}) })).json.result.structuredContent.status).toBe("ok");
  });

  const capture = (file: string, tool = "ae_capture") =>
    JSON.stringify({ contract: 3, status: "ok", tool, host: "aftereffects", summary: "Captured", data: { image_path: file, time: 1 }, warnings: [], undoSteps: 0 });

  test("a frame capture in Zenvi Link's temp folder becomes an image block and is deleted", async () => {
    const system = tempDir();
    let png = "";
    const server = await customServer([{ name: "ae_capture", returnsImage: true }], { evalScript: async () => capture(png) }, { tempDir: system });
    expect(server.tempDir).toBe(path.join(system, "zenvi-link"));
    expect(existsSync(server.tempDir)).toBe(true);
    png = path.join(server.tempDir, "capture-1.png");
    writeFileSync(png, Buffer.from(TINY_PNG_BASE64, "base64"));
    const result = (await request(server, { body: call("ae_capture", {}) })).json.result;
    expect(result.content[1]).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
    expect(result.structuredContent.data).toEqual({ time: 1 });
    expect(existsSync(png)).toBe(false);
  });

  test("files outside Zenvi Link's temp folder are never deleted, even in the system temp folder", async () => {
    const system = tempDir();
    const png = path.join(system, "someone-elses.png");
    const text = path.join(system, "notes.txt");
    writeFileSync(png, Buffer.from(TINY_PNG_BASE64, "base64"));
    writeFileSync(text, "not an image");
    let target = png;
    const server = await customServer([{ name: "ae_capture", returnsImage: true }], { evalScript: async () => capture(target) }, { tempDir: system });
    const attached = (await request(server, { body: call("ae_capture", {}) })).json.result;
    expect(attached.content).toHaveLength(2);
    expect(existsSync(png)).toBe(true);
    target = text;
    const refused = (await request(server, { body: call("ae_capture", {}) })).json.result;
    expect(refused.content).toHaveLength(1);
    expect(refused.structuredContent.warnings.join(" ")).toContain("not a PNG or JPEG");
    expect(existsSync(text)).toBe(true);
  });

  test("subfolders of the temp folder (renders/, titles/) are never touched; a non-image there or at the top is kept", async () => {
    let target = "";
    const server = await customServer([{ name: "ae_capture", returnsImage: true }], { evalScript: async () => capture(target) }, { tempDir: tempDir() });
    const kept: string[] = [];
    for (const relative of ["renders/comp-1.png", "titles/launch-day.png"]) {
      target = path.join(server.tempDir, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(TINY_PNG_BASE64, "base64"));
      const result = (await request(server, { body: call("ae_capture", {}) })).json.result;
      expect(result.content).toHaveLength(2);
      kept.push(target);
    }
    target = path.join(server.tempDir, "notes.txt");
    writeFileSync(target, "not an image");
    expect((await request(server, { body: call("ae_capture", {}) })).json.result.content).toHaveLength(1);
    kept.push(target);
    for (const file of kept) expect(existsSync(file), file).toBe(true);
  });

  test("oversized captures are not sent", async () => {
    let png = "";
    const server = await customServer([{ name: "ae_capture", returnsImage: true }], { evalScript: async () => capture(png) }, { tempDir: tempDir(), imageLimit: 10 });
    png = path.join(server.tempDir, "big.png");
    writeFileSync(png, Buffer.from(TINY_PNG_BASE64, "base64"));
    const result = (await request(server, { body: call("ae_capture", {}) })).json.result;
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent.warnings.join(" ")).toContain("over the 0 MB limit");
    expect(existsSync(png)).toBe(false);
  });

  test.skipIf(process.platform === "linux")("the temp folder match ignores case where the file system does", async () => {
    const server = await customServer([{ name: "ae_capture", returnsImage: true }], { evalScript: async () => "" }, { tempDir: tempDir() });
    const png = path.join(server.tempDir, "case.png");
    writeFileSync(png, Buffer.from(TINY_PNG_BASE64, "base64"));
    const shouted = path.join(path.dirname(server.tempDir), path.basename(server.tempDir).toUpperCase(), "case.png");
    expect(await serverModule.insideDir(shouted, server.tempDir)).toBe(true);
    expect(await serverModule.insideDir(path.join(os.tmpdir(), "x.png"), server.tempDir)).toBe(false);
  });

  test("tools without returnsImage keep image_path and their files", async () => {
    const keep = path.join(tempDir(), "frame.png");
    writeFileSync(keep, Buffer.from(TINY_PNG_BASE64, "base64"));
    const server = await customServer([{ name: "ae_other" }], { evalScript: async () => capture(keep, "ae_other") });
    const other = (await request(server, { body: call("ae_other", {}) })).json.result;
    expect(other.content).toHaveLength(1);
    expect(other.structuredContent.data.image_path).toBe(keep);
    expect(existsSync(keep)).toBe(true);
  });

  test("every call counts as activity and is reported to listeners", async () => {
    let activity = 0;
    const { server } = await aeServer({ onActivity: () => (activity += 1) });
    const seen: string[] = [];
    server.on("call", (event) => seen.push(`${event.tool}:${event.status}`));
    await request(server, { body: call("ae_get_state", {}) });
    await request(server, { body: call("ae_get_state", { bad: 1 }) });
    expect(activity).toBe(2);
    expect(seen).toEqual(["ae_get_state:ok", "ae_get_state:refused"]);
    expect(server.recentCalls().map((event) => event.status)).toEqual(["refused", "ok"]);
  });
});
