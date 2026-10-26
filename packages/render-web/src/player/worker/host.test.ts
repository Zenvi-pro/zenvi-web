import { describe, expect, it } from "vitest";
import { proxiedFetch } from "./host.js";
import type { WireResponse, WorkerCall } from "./protocol.js";

type FetchCall = Extract<WorkerCall, { method: "fetch" }>;

/** A proxied fetch whose page answers with `respond`; the calls it made. */
function proxy(respond: (request: FetchCall, signal: AbortSignal) => Promise<WireResponse>) {
  const calls: { request: FetchCall; signal: AbortSignal }[] = [];
  const fetchFn = proxiedFetch("file:U", (request, signal) => {
    const call = request as FetchCall;
    calls.push({ request: call, signal });
    return respond(call, signal);
  });
  return { fetchFn, calls };
}

const partial = (): Promise<WireResponse> =>
  Promise.resolve({ status: 206, statusText: "Partial Content", headers: [["content-range", "bytes 0-1/2"]], body: new Uint8Array([1, 2]).buffer });

describe("proxiedFetch", () => {
  it("sends the request's method, headers and body to the page and rebuilds its response", async () => {
    const { fetchFn, calls } = proxy(partial);
    const response = await fetchFn("https://cdn.test/u.webm", { method: "POST", headers: { range: "bytes=0-1" }, body: "hi" });
    expect(response.status).toBe(206);
    expect(response.statusText).toBe("Partial Content");
    expect(response.headers.get("content-range")).toBe("bytes 0-1/2");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2]);
    const { request } = calls[0]!;
    expect(request.key).toBe("file:U");
    expect(request.url).toBe("https://cdn.test/u.webm");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toContainEqual(["range", "bytes=0-1"]);
    expect(new TextDecoder().decode(request.init.body)).toBe("hi");

    // A Request as input, without a body.
    await fetchFn(new Request("https://cdn.test/u.webm", { headers: { range: "bytes=1-1" } }));
    expect(calls[1]!.request.init.method).toBe("GET");
    expect(calls[1]!.request.init.headers).toContainEqual(["range", "bytes=1-1"]);
    expect(calls[1]!.request.init.body).toBeUndefined();
  });

  it("answers an opaque (status 0) response with a network-error response", async () => {
    const { fetchFn } = proxy(() => Promise.resolve({ status: 0, statusText: "", headers: [], body: null }));
    const response = await fetchFn("https://cdn.test/u.webm", { mode: "no-cors" });
    expect(response.status).toBe(0);
    expect(response.ok).toBe(false);
    expect(response.type).toBe("error");
  });

  it("follows the caller's abort signal", async () => {
    const { fetchFn, calls } = proxy((_request, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
    const controller = new AbortController();
    const reading = fetchFn("https://cdn.test/u.webm", { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(calls[0]!.signal.aborted).toBe(true);

    // Already aborted: the page is not asked.
    await expect(fetchFn("https://cdn.test/u.webm", { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
  });
});
