import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { parseTicket } from "./dispatch.js";

describe("render tickets", () => {
  it("read the job a queue message names, and nothing else", () => {
    expect(parseTicket(JSON.stringify({ userId: "u-1", renderId: "r_abc123" }))).toEqual({ userId: "u-1", renderId: "r_abc123" });
    expect(parseTicket(JSON.stringify({ userId: "u-1", renderId: "../../etc" }))).toBeNull();
    expect(parseTicket(JSON.stringify({ userId: "", renderId: "r_abc123" }))).toBeNull();
    expect(parseTicket("not json")).toBeNull();
    expect(parseTicket("null")).toBeNull();
  });

  it("are on only with Azure storage and a valid queue name", () => {
    const azure = { AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true" };
    expect(loadConfig({ ...azure, ZENVI_RENDER_QUEUE: "render-jobs" }).renderQueue).toBe("render-jobs");
    expect(loadConfig(azure).renderQueue).toBeNull();
    expect(() => loadConfig({ ...azure, ZENVI_RENDER_QUEUE: "Render_Jobs" })).toThrow(/invalid ZENVI_RENDER_QUEUE/);
    expect(() => loadConfig({ ...azure, ZENVI_RENDER_QUEUE: "render--jobs" })).toThrow(/invalid ZENVI_RENDER_QUEUE/);
    expect(() => loadConfig({ STORAGE: "memory", ZENVI_RENDER_QUEUE: "render-jobs" })).toThrow(/needs Azure storage/);
  });
});
