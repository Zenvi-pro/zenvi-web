import { describe, expect, it } from "vitest";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHostOptions } from "../test-support/fake-host.js";
import { IDS, fixtureDoc } from "../test-support/fixture.js";
import { pixelFrameHost, solid } from "../test-support/pixel-host.js";
import type { ToolHost } from "../types.js";
import { cacheKey, styleLine } from "./broll-set.js";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function host(routes: FakeHostOptions["routes"] = {}): ToolHost & { backendCalls: { path: string; body: unknown }[] } {
  const h = fakeHost({ routes });
  // Every picture is warm orange: the reference's measured palette and light are predictable.
  return Object.assign(h, { frames: pixelFrameHost((_p, w, hh) => solid(w, hh, [214, 120, 40, 255])) });
}

const SHOTS = ["hands pour coffee into a ceramic cup", "steam over the cup by the window", "beans tumble in the roaster"];

describe("generate_broll_set_tool", () => {
  it("ends every prompt with one style line and sends the reference frame with each still", async () => {
    const doc = fixtureDoc();
    const h = host({ "/api/v1/generation/image": () => ({ image_base64: PNG_1PX, mime_type: "image/png", provider: "gemini" }) });
    const result = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS, style: "35mm lens, shallow depth of field", reference_file_id: IDS.broll });
    expect(result.data?.status, result.data?.summary).toBe("applied");
    const images = h.backendCalls.filter((c) => c.path === "/api/v1/generation/image").map((c) => c.body as Record<string, string>);
    expect(images).toHaveLength(3);
    const line = images[0]!.prompt.slice(SHOTS[0]!.length + 2);
    expect(line).toMatch(/^Style of the whole set: 35mm lens, shallow depth of field\. Match the reference: palette #[0-9a-f]{6}, mid exposure, warm light\. Every shot of this set is from the same shoot/);
    for (const [i, body] of images.entries()) {
      expect(body.prompt).toBe(`${SHOTS[i]}. ${line}`);
      expect(body.provider).toBe("gemini");
      expect(body.reference_image_url).toMatch(/^data:image\/(jpeg|png);base64,/);
    }
    // Each still is animated from itself: start and end frame are the still.
    const morphs = h.backendCalls.filter((c) => c.path === "/api/v1/generation/morph").map((c) => c.body as Record<string, unknown>);
    expect(morphs).toHaveLength(3);
    expect(morphs[0]!.start_image_url).toBe(`data:image/png;base64,${PNG_1PX}`);
    expect(morphs[0]!.end_image_url).toBe(morphs[0]!.start_image_url);
    expect(morphs[0]!.duration_seconds).toBe(5);
    // Six files (three stills, three clips) in one undo step, stamped as generated with their cache keys.
    expect(doc.undoLabels).toEqual(["Generate B-roll set (3)"]);
    const made = doc.project.files.filter((f) => (f.ai_metadata as { source?: string } | undefined)?.source === "broll_set");
    expect(made).toHaveLength(6);
    expect(made.every((f) => String(f.tags).includes("ai_generated"))).toBe(true);
    expect(result.data?.warnings ?? []).toEqual([]);
    expect(result.data?.summary).toMatch(/every still from one reference image/);
    expect(result.data?.summary).toMatch(new RegExp(`Next: place them, then unify_grade_tool reference_file_id=${IDS.broll}`));
  });

  it("reuses what the bin already has: the same call again pays nothing", async () => {
    const doc = fixtureDoc();
    const h = host();
    const args = { shots: SHOTS.slice(0, 2), style: "warm tungsten interior" };
    await runTool({ doc, host: h }, "generate_broll_set_tool", args);
    const paid = h.backendCalls.length;
    const again = await runTool({ doc, host: h }, "generate_broll_set_tool", args);
    expect(again.data?.status).toBe("unchanged");
    expect(h.backendCalls.length).toBe(paid);
    expect(doc.undoLabels).toHaveLength(1);
    // One more shot: only it is generated.
    const more = await runTool({ doc, host: h }, "generate_broll_set_tool", { ...args, shots: SHOTS });
    expect(h.backendCalls.slice(paid).map((c) => c.path)).toEqual(["/api/v1/generation/image", "/api/v1/generation/morph"]);
    expect(more.data?.summary).toMatch(/\(cached\) {2}'hands pour coffee/);
  });

  it("keeps the stills when a clip fails, animates only them next time, and stops spending on a credit error", async () => {
    const doc = fixtureDoc();
    let morphFails = true;
    const h = host({
      "/api/v1/generation/morph": () => (morphFails ? { error: "Insufficient credits for video generation" } : { video_url: "https://cdn.example.com/morph.mp4" }),
    });
    const first = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS, style: "overcast daylight" });
    expect(first.data?.status).toBe("applied");
    // The first clip's credit error stops the set: one still made, nothing more spent.
    expect(h.backendCalls.map((c) => c.path)).toEqual(["/api/v1/generation/image", "/api/v1/generation/morph"]);
    expect(first.data?.warnings?.[0]).toMatch(/the clip failed \(its still is kept/);
    morphFails = false;
    const before = h.backendCalls.length;
    await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS, style: "overcast daylight" });
    // Shot 1 only animates; shots 2 and 3 are made whole.
    expect(h.backendCalls.slice(before).map((c) => c.path)).toEqual([
      "/api/v1/generation/morph",
      "/api/v1/generation/image",
      "/api/v1/generation/morph",
      "/api/v1/generation/image",
      "/api/v1/generation/morph",
    ]);
  });

  it("says when the backend ignored the reference, and makes stills only when asked", async () => {
    const doc = fixtureDoc();
    const h = host();
    const result = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS.slice(0, 2), reference_file_id: IDS.broll, animate: false });
    expect(h.backendCalls.map((c) => c.path)).toEqual(["/api/v1/generation/image", "/api/v1/generation/image"]);
    // An older backend answers no provider: the reference is not sent again.
    expect((h.backendCalls[1]!.body as Record<string, unknown>).reference_image_url).toBeUndefined();
    expect(result.data?.warnings?.join(" ")).toMatch(/ignored the reference image/);
  });

  it("dry run lists the plan and spends nothing; refuses a set without a style or reference", async () => {
    const doc = fixtureDoc();
    const h = host();
    const dry = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS.join("; "), style: "neon night street", dry_run: true });
    expect(dry.data?.summary).toMatch(/^Dry run, nothing generated: 3 shot\(s\), 3 still\(s\) and 3 clip\(s\) of 5s to generate/);
    expect(h.backendCalls).toEqual([]);
    const bare = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS });
    expect(bare.data?.summary).toBe("Error: give the set's style (palette, light, lens) or a reference_file_id to match.");
    const audio = doc.project.files.find((f) => f.media_type === "audio")!;
    const sound = await runTool({ doc, host: h }, "generate_broll_set_tool", { shots: SHOTS, reference_file_id: String(audio.id) });
    expect(sound.data?.summary).toMatch(/has no picture to match/);
    expect(doc.undoLabels).toEqual([]);
  });
});

describe("broll set helpers", () => {
  it("keys differ by every part and are stable", () => {
    expect(cacheKey("still", "a", 1)).toBe(cacheKey("still", "a", 1));
    expect(cacheKey("still", "a", 1)).not.toBe(cacheKey("still", "a", 2));
    expect(cacheKey("still", "a", 1)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("writes the measured look only when there is one", () => {
    expect(styleLine("film grain.", null)).toBe(
      "Style of the whole set: film grain. Every shot of this set is from the same shoot: same camera and lens, same lighting, same colour grade. Photographic, no text, no logos, no watermark.",
    );
    expect(styleLine(undefined, { colors: ["#112233"], brightness: "dark", light: "cool" })).toMatch(/^Match the reference: palette #112233, dark exposure, cool light\. /);
  });
});
