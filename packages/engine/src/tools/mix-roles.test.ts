import { describe, expect, it } from "vitest";
import { resolveTargets } from "./mix-roles.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { fixtureDoc, fixtureProject, IDS } from "./test-support/fixture.js";

/** The fixture with its b-roll footage muted (volume 0), as an edit with stock video under a music bed has it. */
function mutedBroll() {
  const project = fixtureProject();
  const broll = project.clips.find((c) => c.id === IDS.clipB)!;
  broll.volume = { Points: [{ co: { X: 1, Y: 0 }, interpolation: 1 }] };
  return project;
}

describe("role targets skip muted clips", () => {
  it("role=music names the music you hear, not footage turned down to 0", () => {
    // Regression (sk2-product-brand): fade_out on role=music hit only the muted stock clips.
    const before = resolveTargets(fixtureProject(), { role: "music" });
    expect(typeof before !== "string" && before.map((e) => e.id)).toContain(IDS.clipB);
    const after = resolveTargets(mutedBroll(), { role: "music" });
    expect(typeof after !== "string" && after.map((e) => e.id)).toEqual([IDS.clipMusic]);
    // Named by id or track, a muted clip is still reached.
    const byId = resolveTargets(mutedBroll(), { clip_ids: [IDS.clipB] });
    expect(typeof byId !== "string" && byId.map((e) => e.id)).toEqual([IDS.clipB]);
  });

  it("automate_volume_tool fade_out on role=music leaves the muted footage alone", async () => {
    const doc = fixtureDoc(mutedBroll());
    const r = await runTool({ doc, host: fakeHost() }, "automate_volume_tool", { role: "music", shape: "fade_out" });
    expect(r.ok, r.text).toBe(true);
    expect(doc.project.clips.find((c) => c.id === IDS.clipB)!.volume!.Points).toHaveLength(1);
    expect(doc.project.clips.find((c) => c.id === IDS.clipMusic)!.volume!.Points.length).toBeGreaterThan(1);
  });
});
