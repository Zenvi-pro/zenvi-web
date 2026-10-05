import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PREMIERE_TOOLS } from "./catalog/premiere.js";
import { toCatalogJson } from "./catalog/types.js";
import { loadPremiere, standardEdit } from "./testing/ppro-fixtures.js";
import { serverModule, type LinkServer } from "./testing/link-server.js";

const servers: LinkServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

/** The real Zenvi Link server over the Premiere host script on the mock DOM. */
async function premiereServer() {
  const fx = loadPremiere();
  const edit = standardEdit(fx);
  const server = serverModule.createLinkServer({
    host: "premiere",
    catalog: toCatalogJson("premiere", PREMIERE_TOOLS),
    bridge: { evalScript: async (script) => String(fx.host.evaluate(script)) },
    tempDir: path.join(fx.dir, "tmp"),
  });
  servers.push(server);
  await server.start();
  return { fx, edit, server };
}

describe("Premiere tools through the Zenvi Link server", () => {
  test("schema defaults reach the host script (0.5 s Cross Dissolve at the end)", async () => {
    const { edit, server } = await premiereServer();
    const { receipt } = await server.callTool("premiere_add_transition", { clip: edit.v.a.nodeId });
    expect(receipt).toMatchObject({ status: "applied", data: { transition: "Cross Dissolve", requested_duration: 0.5 } });
  });

  test("a frame capture comes back as a PNG image block and the temp file is removed", async () => {
    const { fx, server } = await premiereServer();
    const { receipt, images } = await server.callTool("premiere_capture_frame", { time: 1 });
    expect(receipt.status).toBe("ok");
    expect(receipt.data).not.toHaveProperty("image_path");
    expect(images).toEqual([expect.objectContaining({ type: "image", mimeType: "image/png" })]);
    expect(Buffer.from(images[0]?.data ?? "", "base64").subarray(1, 4).toString("latin1")).toBe("PNG");
    const folder = path.join(fx.dir, "tmp", "zenvi-link");
    expect(existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".png")) : []).toEqual([]);
  });

  test("unions, nested objects and enums validate as the catalog says", async () => {
    const { edit, server } = await premiereServer();
    const animated = await server.callTool("premiere_animate", {
      clip: edit.v.b.nodeId,
      property: "scale",
      easing: { x1: 0.2, y1: 0, x2: 0, y2: 1 },
      keyframes: [
        { time: 0, value: 92 },
        { time: 0.6, value: 100, easing: "hold" },
      ],
    });
    expect(animated.receipt.status).toBe("applied");
    const unknown = await server.callTool("premiere_place_clip", { item: "x", tracks: [] });
    expect(unknown.receipt).toMatchObject({ status: "refused", error: { code: "INVALID_ARGUMENT" } });
    expect(unknown.receipt.summary).toContain("`tracks` is not a known argument");
    const badEnum = await server.callTool("premiere_export", { preset: "h265" });
    expect(badEnum.receipt.error?.code).toBe("INVALID_ARGUMENT");
    const relative = await server.callTool("premiere_import_files", { paths: ["clip.mov"] });
    expect(relative.receipt.summary).toContain("must match");
  });

  test("a refusal from the host script travels back as a refused receipt", async () => {
    const { server } = await premiereServer();
    const { receipt } = await server.callTool("premiere_add_text", { text: "Hello" });
    expect(receipt).toMatchObject({ status: "refused", host: "premiere", error: { code: "UNSUPPORTED" }, undoSteps: 0 });
  });
});
