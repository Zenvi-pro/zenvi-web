/**
 * premiere_add_text without `image` or `mogrt`, end to end: FakeCep boots the
 * Zenvi Link service for Premiere Pro with a page document (fake canvas), and
 * the MCP SDK client calls the tool. The server renders the title PNG and the
 * host script places it as a still.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { HostClient } from "./client.js";
import { discoverHosts } from "./discovery.js";
import { PACKAGE_ROOT } from "./host-bundle.js";
import { fakeDocument } from "./testing/fake-canvas.js";
import { FakeCep, evalInHostScript } from "./testing/fake-cep.js";
import { bootModule, type BootedLink } from "./testing/link-server.js";
import { loadPremiere, standardEdit } from "./testing/ppro-fixtures.js";

const booted: BootedLink[] = [];
const clients: HostClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(booted.splice(0).map((link) => link.stop()));
});

async function service(options: { saved?: boolean; page?: boolean } = {}) {
  const fx = loadPremiere();
  const edit = standardEdit(fx);
  if (options.saved !== false) fx.mock.project.path = path.join(fx.dir, "Trip", "trip.prproj");
  const document = fakeDocument();
  const cep = new FakeCep({ appName: "PPRO", appVersion: "26.0.0", extensionDir: path.join(PACKAGE_ROOT, "extension"), evalScript: evalInHostScript(fx.host) });
  const window = options.page === false ? { addEventListener: () => undefined } : { document, addEventListener: () => undefined };
  const home = path.join(fx.dir, "home");
  const link = await bootModule.boot({ cep, window, home, tempDir: path.join(fx.dir, "tmp"), pollMs: 60_000, log: () => undefined });
  booted.push(link);
  const [endpoint] = await discoverHosts(path.join(home, ".openshot_qt"));
  const client = new HostClient(endpoint!);
  clients.push(client);
  return { fx, edit, link, client, document };
}

const pngSize = (file: string) => {
  const bytes = readFileSync(file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};

describe("premiere_add_text renders its own title", () => {
  test("a title without image or mogrt is rendered at the sequence size, saved next to the project and placed on V2", async () => {
    const { fx, link, client } = await service();
    expect(link.status().title_renderer).toBe(true);
    const { receipt, isError } = await client.callTool("premiere_add_text", { text: "Launch day", time: 1 });
    expect(isError).toBe(false);
    const rendered = receipt?.data.rendered as { path: string; width: number; height: number; lines: string[]; font_size: number };
    expect(receipt).toMatchObject({ status: "applied", data: { source: "rendered", style: "title", clip: { track: { kind: "video", index: 1 } } } });
    expect(rendered).toMatchObject({ width: 1920, height: 1080, lines: ["Launch day"], font_size: 72 });
    expect(path.dirname(rendered.path)).toBe(path.join(fx.dir, "Trip", "Zenvi Titles"));
    expect(pngSize(rendered.path)).toEqual([1920, 1080]);
    // A frame-sized image fills the frame: no scale or position change.
    expect(receipt?.data.layout).toEqual({ scale: 100, position: [960, 540] });
    expect(fx.mock.project.findByMediaPath(rendered.path)).toBeDefined();
  });

  test("the same title again reuses the file and the project item", async () => {
    const { fx, client } = await service();
    const first = await client.callTool("premiere_add_text", { text: "Again", time: 0, duration: 3 });
    const second = await client.callTool("premiere_add_text", { text: "Again", time: 5, duration: 3 });
    const file = (first.receipt?.data.rendered as { path: string }).path;
    expect((second.receipt?.data.rendered as { path: string }).path).toBe(file);
    expect(second.receipt?.data.imported).toBe(false);
    expect(readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
    expect(fx.mock.project.findByMediaPath(file)).toBeDefined();
  });

  test("style, colour, stroke, box and line breaks reach the drawing", async () => {
    const { client, document } = await service();
    const { receipt } = await client.callTool("premiere_add_text", {
      text: "Ada Lovelace\nMathematician",
      style: "lower-third",
      color: "#FF5A36",
      stroke: { color: "#000000", width: 2 },
      box: { opacity: 0.5 },
      time: 2,
    });
    expect(receipt?.status).toBe("applied");
    const drawn = document.canvases.flatMap((canvas) => canvas.ops);
    expect(drawn.filter((op) => op.op === "fillText").map((op) => [op.text, op.x, op.textAlign, op.fillStyle])).toEqual([
      ["Ada Lovelace", 192 + Math.round(0.4 * 54), "left", "rgba(255, 90, 54, 1)"],
      ["Mathematician", 192 + Math.round(0.4 * 54), "left", "rgba(255, 90, 54, 1)"],
    ]);
    expect(drawn.find((op) => op.op === "fillRect")).toMatchObject({ x: 192, fillStyle: "rgba(11, 11, 15, 0.5)" });
    expect(drawn.filter((op) => op.op === "strokeText")).toHaveLength(2);
  });

  test("an unsaved project renders into Zenvi Link's temp folder, with a warning", async () => {
    const { fx, client } = await service({ saved: false });
    const { receipt } = await client.callTool("premiere_add_text", { text: "Draft", time: 1 });
    expect(receipt?.status).toBe("applied");
    expect(path.dirname((receipt?.data.rendered as { path: string }).path)).toBe(path.join(fx.dir, "tmp", "zenvi-link", "titles"));
    expect(receipt?.warnings.join(" ")).toContain("The project is not saved yet");
  });

  test("an image or a mogrt is used as given; without a page canvas the call refuses with guidance", async () => {
    const { fx, client, document } = await service();
    const own = fx.file("own.png", readFileSync(path.join(PACKAGE_ROOT, "extension", "icons", "icon-normal.png")));
    const withImage = await client.callTool("premiere_add_text", { text: "Mine", image: own, time: 1 });
    expect(withImage.receipt?.data).toMatchObject({ source: "image" });
    expect(document.canvases).toHaveLength(0);
    const bare = await service({ page: false });
    expect(bare.link.status().title_renderer).toBe(false);
    const refused = await bare.client.callTool("premiere_add_text", { text: "Hello" });
    expect(refused.receipt).toMatchObject({ status: "refused", error: { code: "UNSUPPORTED" } });
  });

  test("no active sequence: the host script's refusal comes back, nothing is rendered", async () => {
    const { fx, client, document } = await service();
    fx.mock.project.activeSequence = null;
    const { receipt } = await client.callTool("premiere_add_text", { text: "Nowhere" });
    expect(receipt).toMatchObject({ status: "refused", error: { code: "NO_ACTIVE_SEQUENCE" } });
    expect(document.canvases).toHaveLength(0);
  });
});
