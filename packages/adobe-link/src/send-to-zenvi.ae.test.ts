/**
 * The After Effects "Send to Zenvi" hook (extension/panel/send-to-zenvi-aftereffects.js)
 * with the real host script on the mock DOM behind ctx.callHostTool and a
 * recording stand-in for the Zenvi desktop.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { HostReceipt } from "./receipt.js";
import { aeHarness } from "./testing/ae-harness.js";

const require = createRequire(import.meta.url);

interface ToolResult {
  receipt: HostReceipt | Record<string, unknown> | null;
  images: unknown[];
  isError: boolean;
}

interface SendContext {
  desktop: { running: boolean; pid?: number; project?: string | null };
  callHostTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult>;
  callDesktopTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<ToolResult>;
}

const sendToZenvi = require("../extension/panel/send-to-zenvi-aftereffects.js") as { label: string; run(ctx: SendContext): Promise<string> };

function scene(options: { saved?: boolean; comp?: boolean } = {}) {
  const h = aeHarness();
  if (options.saved !== false) h.mock.project.save(new h.mock.es.File(path.join(h.dir, "promo.aep")));
  if (options.comp !== false) h.mock.addComp({ name: "Promo", duration: 4 });
  const hostCalls: { name: string; timeoutMs?: number }[] = [];
  const desktopCalls: { name: string; args: Record<string, unknown>; timeoutMs?: number }[] = [];
  let desktopReply: ToolResult = { receipt: { contract: 3, status: "applied", tool: "import_linked_media_tool", summary: "Added Promo", data: { clip_id: "c1" } }, images: [], isError: false };
  const ctx: SendContext = {
    desktop: { running: true, pid: 1, project: "/x/trip.zvn" },
    async callHostTool(name, args, timeoutMs) {
      hostCalls.push({ name, timeoutMs });
      const receipt = h.call(name, args);
      return { receipt, images: [], isError: receipt.status === "error" || receipt.status === "refused" };
    },
    async callDesktopTool(name, args, timeoutMs) {
      desktopCalls.push({ name, args, timeoutMs });
      return desktopReply;
    },
  };
  return { h, ctx, hostCalls, desktopCalls, reply: (result: ToolResult) => (desktopReply = result) };
}

describe("Send to Zenvi (After Effects)", () => {
  test("renders the active comp and adds it to Zenvi as a linked clip with its SPEC 3.6 link", async () => {
    const { h, ctx, hostCalls, desktopCalls } = scene();
    expect(sendToZenvi.label).toBe("Send to Zenvi");
    const line = await sendToZenvi.run(ctx);
    expect(line).toBe('Sent "Promo" to Zenvi (4 s, h264)');
    expect(hostCalls).toEqual([{ name: "ae_render_for_zenvi", timeoutMs: 31 * 60 * 1000 }]);
    expect(desktopCalls).toHaveLength(1);
    const call = desktopCalls[0] as { name: string; args: { path: string; name: string; link: Record<string, unknown> }; timeoutMs?: number };
    expect(call.name).toBe("import_linked_media_tool");
    expect(call.timeoutMs).toBe(5 * 60 * 1000);
    expect(call.args.name).toBe("Promo");
    expect(existsSync(call.args.path)).toBe(true);
    expect(call.args.link).toMatchObject({
      version: 1,
      kind: "aftereffects",
      source: { project_dir: null, entry: null, composition: "Promo", file: null, line: null, aep: path.join(h.dir, "promo.aep") },
      props: {},
      render: { codec: "h264", width: 1920, height: 1080, fps: { num: 30, den: 1 }, duration_frames: 120, output: call.args.path, fingerprint: null },
      state: "fresh",
      error: null,
    });
  });

  test("says when Zenvi is not running, before rendering anything", async () => {
    const { ctx, hostCalls } = scene();
    ctx.desktop = { running: false };
    await expect(sendToZenvi.run(ctx)).rejects.toThrow("Zenvi is not running. Open the Zenvi desktop app with your project, then send again.");
    expect(hostCalls).toEqual([]);
  });

  test("shows After Effects' refusal without a doubled Error: prefix", async () => {
    const { ctx, desktopCalls } = scene({ comp: false });
    await expect(sendToZenvi.run(ctx)).rejects.toThrow(/^No comp is active; open one in the Timeline/);
    expect(desktopCalls).toEqual([]);
  });

  test("reports a failed import with the rendered file's path", async () => {
    const { ctx, reply } = scene();
    reply({ receipt: { contract: 3, status: "refused", summary: "Error: No project is open" }, images: [], isError: true });
    await expect(sendToZenvi.run(ctx)).rejects.toThrow(/^Zenvi could not add the render \(.+\.mp4\): No project is open$/);
  });

  test("an unsaved project still sends, with a reminder to save", async () => {
    const { ctx } = scene({ saved: false });
    expect(await sendToZenvi.run(ctx)).toBe('Sent "Promo" to Zenvi (4 s, h264); save the .aep so Zenvi can re-render it');
  });
});
