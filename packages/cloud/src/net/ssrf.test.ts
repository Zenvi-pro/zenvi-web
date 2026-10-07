import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadToFile, fetchJson, safeGet } from "./fetch.js";
import { checkUrl, isPublicAddress, PUBLIC_HTTPS, resolveChecked, SsrfError, type UrlPolicy } from "./ssrf.js";

describe("address classification", () => {
  it("allows public unicast only", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "20.237.62.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "168.63.129.16", // Azure platform endpoint
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
      "192.0.2.1",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe", // mapped 169.254.169.254
      "64:ff9b::a00:1", // NAT64 of 10.0.0.1
      "2002:a00:1::", // 6to4 of 10.0.0.1
      "2001:db8::1",
      "::127.0.0.1",
      "fe80::1%eth0",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("URL checks", () => {
  it("only allows https on the default port without credentials", () => {
    expect(checkUrl("https://cdn.example.com/a.mp4", PUBLIC_HTTPS).hostname).toBe("cdn.example.com");
    for (const bad of [
      "http://cdn.example.com/a.mp4",
      "ftp://cdn.example.com/a.mp4",
      "file:///etc/passwd",
      "https://user:pass@cdn.example.com/a.mp4",
      "https://cdn.example.com:8443/a.mp4",
      "https://localhost/a.mp4",
      "https://intranet/a.mp4",
      "https://printer.local/a.mp4",
      "https://metadata.google.internal/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data",
      "not a url",
    ]) {
      expect(() => checkUrl(bad, PUBLIC_HTTPS), bad).toThrow(SsrfError);
    }
  });

  it("rejects a name if any of its addresses is private (DNS rebinding)", async () => {
    const resolver = async (host: string) =>
      host === "mixed.example.com"
        ? [
            { address: "93.184.216.34", family: 4 as const },
            { address: "10.0.0.1", family: 4 as const },
          ]
        : [{ address: "93.184.216.34", family: 4 as const }];
    await expect(resolveChecked("mixed.example.com", resolver, PUBLIC_HTTPS)).rejects.toThrow(SsrfError);
    await expect(resolveChecked("ok.example.com", resolver, PUBLIC_HTTPS)).resolves.toHaveLength(1);
    await expect(resolveChecked("empty.example.com", async () => [], PUBLIC_HTTPS)).rejects.toThrow(SsrfError);
  });
});

describe("safeGet", () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function serve(handler: Parameters<typeof createServer>[1]): Promise<number> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
  }

  // Tests reach a local server through fake names; only 127.0.0.1 counts as "public" here.
  const policy: UrlPolicy = { protocols: ["http:"], isAllowedAddress: (ip) => ip === "127.0.0.1", allowAnyPort: true };
  const resolver = async (host: string) => [{ address: host === "private.test" ? "192.168.0.10" : "127.0.0.1", family: 4 as const }];

  it("connects to the checked address even though the URL names a host", async () => {
    const port = await serve((req, res) => res.end(`host=${req.headers.host}`));
    const response = await safeGet(`http://media.test:${port}/x`, { policy, resolver, timeoutMs: 5000 });
    const dir = await mkdtemp(join(tmpdir(), "zenvi-ssrf-"));
    dirs.push(dir);
    const out = join(dir, "x");
    await downloadToFile(response, out, 1000);
    expect(await readFile(out, "utf8")).toBe(`host=media.test:${port}`);
  });

  it("re-checks every redirect hop", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/to-private") res.writeHead(302, { location: "http://private.test/secret" }).end();
      else if (req.url === "/to-ftp") res.writeHead(301, { location: "ftp://media.test/x" }).end();
      else if (req.url === "/loop") res.writeHead(302, { location: "/loop" }).end();
      else res.end("ok");
    });
    await expect(safeGet(`http://media.test:${port}/to-private`, { policy, resolver, timeoutMs: 5000 })).rejects.toThrow(SsrfError);
    await expect(safeGet(`http://media.test:${port}/to-ftp`, { policy, resolver, timeoutMs: 5000 })).rejects.toThrow(SsrfError);
    await expect(safeGet(`http://media.test:${port}/loop`, { policy, resolver, timeoutMs: 5000, maxRedirects: 3 })).rejects.toThrow("Too many redirects");
  });

  it("caps the size, declared or streamed", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/declared") res.writeHead(200, { "content-length": "5000" }).end("x".repeat(5000));
      else {
        // Two writes: no Content-Length, chunked transfer.
        res.writeHead(200);
        res.write("y".repeat(2500));
        res.end("y".repeat(2500));
      }
    });
    const dir = await mkdtemp(join(tmpdir(), "zenvi-ssrf-"));
    dirs.push(dir);
    const declared = await safeGet(`http://media.test:${port}/declared`, { policy, resolver, timeoutMs: 5000 });
    await expect(downloadToFile(declared, join(dir, "a"), 1000)).rejects.toThrow("larger than");
    const streamed = await safeGet(`http://media.test:${port}/chunked`, { policy, resolver, timeoutMs: 5000 });
    await expect(downloadToFile(streamed, join(dir, "b"), 1000)).rejects.toThrow("larger than");
    await expect(fetchJson(`http://media.test:${port}/chunked`, { policy, resolver, timeoutMs: 5000, maxBytes: 100 })).rejects.toThrow("too large");
  });

  it("gives up on slow servers", async () => {
    const port = await serve(() => {
      // never answers
    });
    await expect(safeGet(`http://media.test:${port}/slow`, { policy, resolver, timeoutMs: 200 })).rejects.toThrow("too long");
  });

  it("blocks loopback with the production policy", async () => {
    const port = await serve((_req, res) => res.end("secret"));
    await expect(safeGet(`http://127.0.0.1:${port}/`, { timeoutMs: 1000 })).rejects.toThrow(SsrfError);
    await expect(safeGet("https://localhost/", { timeoutMs: 1000 })).rejects.toThrow(SsrfError);
  });
});
