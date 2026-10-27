import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import { findProfile } from "../../model/profiles.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { snapshotOf } from "../test-support/fixture.js";
import { KINETIC_TITLE_KEY } from "./kinetic-titles.js";

const doc = () => new ProjectDocument(createProject({ id: "TITLES0001", profile: findProfile("HD 1080p 30 fps")! }));
const dataOf = (r: { data?: unknown }) => (r.data as { data: Record<string, unknown> }).data;

describe("add_kinetic_title_tool", () => {
  it("adds the title as tagged clips in one undo step, every word's letters moving (scramble)", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_kinetic_title_tool", { text: "Rho saves 491GB", style: "creator", animation: "scramble", position_seconds: 2, duration_seconds: 1.5 });
    expect(r.ok, r.text).toBe(true);
    expect(d.undoLabels).toEqual(["Add kinetic title (scramble)"]);
    const clips = d.project.clips.filter((c) => (c as Record<string, unknown>)[KINETIC_TITLE_KEY]);
    // Three words, each decoded through its scramble drawings before it.
    expect(clips.length).toBeGreaterThan(3 * 2);
    expect(Math.min(...clips.map((c) => Number(c.position)))).toBeCloseTo(2, 6);
    expect(Math.max(...clips.map((c) => Number(c.position) + Number(c.end) - Number(c.start)))).toBeCloseTo(3.5, 1);
    expect(dataOf(r).created_clip_ids).toHaveLength(clips.length);
    d.undo();
    expect(d.project.clips).toHaveLength(0);
  });

  it("sets a title larger than a caption of its style", async () => {
    const d = doc();
    const r = await runTool({ doc: d, host: fakeHost() }, "add_kinetic_title_tool", { text: "build ship repeat", style: "documentary", animation: "typewriter" });
    expect(r.ok, r.text).toBe(true);
    const [, , , h] = dataOf(r).box as number[];
    // documentary captions are 46 px at 1080; a title 1.5x that: the line's ink is over 5 % of the frame tall.
    expect(h!).toBeGreaterThan(0.05);
  });

  it("sets a chapter card: the colour full frame under the word, the word in the card's ink", async () => {
    const d = doc();
    const h = fakeHost();
    const r = await runTool({ doc: d, host: h }, "add_kinetic_title_tool", { text: "DOUBT", style: "stack", animation: "slam", background: "#d4141c", duration_seconds: 1.2 });
    expect(r.ok, r.text).toBe(true);
    const svgs = [...h.written.values()].map((v) => (typeof v === "string" ? v : new TextDecoder().decode(v)));
    expect(svgs.some((svg) => svg.includes("#d4141c") && svg.includes('width="1920"'))).toBe(true);
    // The emphasis word takes the ink (white), not the red accent, on a red card; no frame reading behind a card.
    expect(svgs.some((svg) => svg.includes("#ff2d2d"))).toBe(false);
    expect(h.calls.some((c) => c.startsWith("renderFrame"))).toBe(false);
    const card = d.project.clips.reduce((a, b) => (Number(b.layer) < Number(a.layer) ? b : a));
    expect(Number(card.end) - Number(card.start)).toBeCloseTo(1.2, 1);
    // A light card: near-black words.
    const light = fakeHost();
    await runTool({ doc: doc(), host: light }, "add_kinetic_title_tool", { text: "The bet was right.", style: "editorial", background: "#f4f2ee" });
    expect([...light.written.values()].map((v) => (typeof v === "string" ? v : new TextDecoder().decode(v))).some((svg) => svg.includes("#111111"))).toBe(true);
  });

  it("refuses a long text or a bad colour without touching the project", async () => {
    const d = doc();
    const before = snapshotOf(d.project);
    const long = await runTool({ doc: d, host: fakeHost() }, "add_kinetic_title_tool", { text: Array.from({ length: 13 }, (_, i) => `w${i}`).join(" ") });
    expect(long.text).toContain("at most 12 words");
    const colour = await runTool({ doc: d, host: fakeHost() }, "add_kinetic_title_tool", { text: "Hi", accent: "not a colour" });
    expect(colour.ok).toBe(false);
    expect(snapshotOf(d.project)).toEqual(before);
    expect(d.undoLabels).toEqual([]);
  });
});
