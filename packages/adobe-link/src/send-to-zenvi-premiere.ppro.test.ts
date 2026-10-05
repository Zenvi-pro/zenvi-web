import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import type { HostReceipt } from "./receipt.js";
import { loadPremiere, standardEdit, type PremiereFixture } from "./testing/ppro-fixtures.js";

interface ToolResult {
  receipt: HostReceipt | Record<string, unknown> | null;
  text: string;
  images: unknown[];
  isError: boolean;
}

interface SendContext {
  desktop: { running: boolean; pid?: number; project?: string | null };
  callHostTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  callDesktopTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  progress?(text: string): void;
}

const hook = createRequire(import.meta.url)("../extension/panel/send-to-zenvi-premiere.js") as {
  label: string;
  run(ctx: SendContext): Promise<string>;
};

/** The panel's context, with this app's tools served by the host script on the mock DOM. */
function context(fx: PremiereFixture, desktop: (name: string, args: Record<string, unknown>) => ToolResult) {
  const desktopCalls: { name: string; args: Record<string, unknown> }[] = [];
  const steps: string[] = [];
  const ctx: SendContext = {
    desktop: { running: true, pid: 4242, project: "/x/trip.zvn" },
    callHostTool: async (name, args) => {
      const receipt = fx.call(name, args);
      return { receipt, text: JSON.stringify(receipt), images: [], isError: receipt.status === "error" || receipt.status === "refused" };
    },
    callDesktopTool: async (name, args) => {
      desktopCalls.push({ name, args });
      return desktop(name, args);
    },
    progress: (text) => steps.push(text),
  };
  return { ctx, desktopCalls, steps };
}

describe("Send to Zenvi (Premiere)", () => {
  test("exports the active sequence as FCP XML and imports it into Zenvi on new tracks", async () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const { ctx, desktopCalls, steps } = context(fx, () => ({
      receipt: { contract: 3, status: "applied", summary: "Imported 7 clips on 4 new tracks" },
      text: "",
      images: [],
      isError: false,
    }));
    expect(hook.label).toBe("Send to Zenvi");
    const line = await hook.run(ctx);
    expect(line).toBe('Sent "Main" to Zenvi on new tracks: Imported 7 clips on 4 new tracks');
    expect(desktopCalls).toHaveLength(1);
    const call = desktopCalls[0];
    expect(call?.name).toBe("import_timeline_xml_tool");
    expect(call?.args.placement).toBe("new_tracks");
    const xml = String(call?.args.path);
    expect(existsSync(xml)).toBe(true);
    expect(readFileSync(xml, "utf8")).toContain("<xmeml");
    expect(steps).toEqual(["Exporting the sequence as FCP XML…", 'Importing "Main" into Zenvi…']);
  });

  test("says so when the desktop app is not running, before exporting", async () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const { ctx, desktopCalls } = context(fx, () => ({ receipt: null, text: "", images: [], isError: false }));
    ctx.desktop = { running: false };
    await expect(hook.run(ctx)).rejects.toThrow("The Zenvi desktop app is not running");
    expect(desktopCalls).toEqual([]);
    expect(fx.mock.state.calls).toEqual([]);
  });

  test("Premiere's refusal (no active sequence) is the message; Zenvi is not called", async () => {
    const fx = loadPremiere();
    const { ctx, desktopCalls } = context(fx, () => ({ receipt: null, text: "", images: [], isError: false }));
    await expect(hook.run(ctx)).rejects.toThrow(/^No sequence is active/);
    expect(desktopCalls).toEqual([]);
  });

  test("a failed import names the sequence, the desktop's message and the XML file", async () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const { ctx } = context(fx, () => ({ receipt: null, text: "Error: no project is open in Zenvi", images: [], isError: true }));
    await expect(hook.run(ctx)).rejects.toThrow(/^Zenvi could not import "Main": no project is open in Zenvi \(XML: .*\.xml\)$/);
  });
});
