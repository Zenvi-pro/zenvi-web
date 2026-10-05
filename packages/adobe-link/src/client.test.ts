import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { AE_TOOLS } from "./catalog/aftereffects.js";
import { toCatalogJson } from "./catalog/types.js";
import { HostClient, loopbackFetch } from "./client.js";
import { probeHost } from "./discovery.js";
import { serverModule, type LinkServer } from "./testing/link-server.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A server that answers initialize as Zenvi Link and records who reached it. */
async function target(): Promise<{ url: string; seen: string[] }> {
  const seen: string[] = [];
  const url = await listen(
    http.createServer((req, res) => {
      req.resume();
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? "-"}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "zenvi-link-aftereffects", version: "1" } } }));
    }),
  );
  return { url, seen };
}

async function redirectTo(location: string): Promise<string> {
  return listen(
    http.createServer((req, res) => {
      req.resume();
      res.writeHead(307, { location });
      res.end();
    }),
  );
}

async function linkServer(evalScript: () => Promise<string>): Promise<LinkServer> {
  const server = serverModule.createLinkServer({ host: "aftereffects", catalog: toCatalogJson("aftereffects", AE_TOOLS), bridge: { evalScript } });
  await server.start();
  closers.push(() => server.stop());
  return server;
}

test("the discovery probe does not follow redirects", async () => {
  const { url, seen } = await target();
  for (const location of [`${url}/mcp`, `${url.replace("127.0.0.1", "localhost")}/mcp`]) {
    const redirector = await redirectTo(location);
    expect(await probeHost(`${redirector}/mcp`, "SECRET", "aftereffects")).toBe(false);
  }
  expect(seen).toEqual([]);
});

test("HostClient does not follow redirects, so the token never reaches another server", async () => {
  const { url, seen } = await target();
  const redirector = await redirectTo(`${url}/mcp`);
  const client = new HostClient({ host: "aftereffects", url: `${redirector}/mcp`, token: "SECRET" });
  closers.push(() => client.close());
  await expect(client.callTool("ae_get_state")).rejects.toThrow();
  expect(seen).toEqual([]);
});

test("HostClient talks over node:http, never global fetch (whose 300 s header timeout would cut long calls)", async () => {
  const ok = JSON.stringify({ contract: 3, status: "ok", tool: "ae_get_state", host: "aftereffects", summary: "ok", data: {}, warnings: [], undoSteps: 0 });
  const server = await linkServer(() => new Promise((resolve) => setTimeout(() => resolve(ok), 300)));
  const globalFetch = vi.spyOn(globalThis, "fetch");
  const client = new HostClient({ host: "aftereffects", url: server.url, token: server.token });
  closers.push(() => client.close());
  expect((await client.listTools()).map((tool) => tool.name)).toContain("ae_get_state");
  expect((await client.callTool("ae_get_state")).receipt?.summary).toBe("ok");
  expect(globalFetch).not.toHaveBeenCalled();
});

test("loopbackFetch returns redirects and errors as responses, and honours abort", async () => {
  const redirector = await redirectTo("http://127.0.0.1:1/elsewhere");
  const response = await loopbackFetch(`${redirector}/mcp`, { method: "POST", body: "{}" });
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://127.0.0.1:1/elsewhere");
  const hanging = await listen(http.createServer(() => undefined));
  const controller = new AbortController();
  const pending = loopbackFetch(`${hanging}/mcp`, { method: "POST", body: "{}", signal: controller.signal });
  controller.abort(new Error("stop"));
  await expect(pending).rejects.toThrow("stop");
});
