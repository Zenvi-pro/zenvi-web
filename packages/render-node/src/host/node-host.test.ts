import path from "node:path";
import { SURFACE_PROFILES, TOOL_NEEDS } from "@zenvi/engine/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { createNodeHost } from "./node-host.js";

let dir: string;
beforeAll(async () => {
  dir = await makeTempDir("zenvi-node-host-");
});
afterAll(async () => removeDir(dir));

function hasMethod(host: object, method: string): boolean {
  const [capability, name] = method.split(".") as [string, string];
  const part = (host as Record<string, Record<string, unknown> | undefined>)[capability];
  return typeof part?.[name] === "function";
}

describe("the cli surface profile", () => {
  // The profile is what docs/TOOLS.md and tool availability read: a method the
  // host has but the profile leaves out marks its tools unavailable in the CLI.
  it("lists the host methods tools need, and only methods the host has", () => {
    // As the CLI builds it (hostOptions, packages/cli/src/commands/context.ts): always a backend and the desktop's folder.
    const host = createNodeHost({
      projectFile: path.join(dir, "a.zvn"),
      backend: { baseUrl: "http://127.0.0.1:9" },
      desktopDir: path.join(dir, "desktop"),
    });
    const profile = SURFACE_PROFILES.cli;
    const conditional = new Set(Object.keys(profile.conditional ?? {}));
    const needed = new Set(Object.values(TOOL_NEEDS).flatMap((n) => [...(n.methods ?? []), ...(n.anyOf ?? []), ...(n.optional ?? [])]).filter((m) => m.includes(".")));
    for (const method of needed) {
      if (hasMethod(host, method)) expect(profile.methods, method).toContain(method);
    }
    for (const method of profile.methods) {
      if (conditional.has(method) || conditional.has(method.split(".")[0]!)) continue;
      expect(hasMethod(host, method), method).toBe(true);
    }
  });
});
