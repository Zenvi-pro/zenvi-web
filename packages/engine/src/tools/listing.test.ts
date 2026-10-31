import { describe, expect, it } from "vitest";
import { argumentNotes, firstSentence, FULL_LISTING, leanListing } from "./listing.js";
import { allTools } from "./registry.js";

describe("the MCP listing diet", () => {
  it("lists in full only tools the catalog has", () => {
    const names = new Set(allTools.map((t) => t.name));
    for (const name of FULL_LISTING) expect(names, name).toContain(name);
  });

  it("keeps a tool's first sentence, or its first clause when that runs long", () => {
    expect(firstSentence("Cut the clip. Then more.", 100)).toBe("Cut the clip.");
    expect(firstSentence("Seconds of the start that are moshed (default 0.6, the usual).", 40)).toBe("Seconds of the start that are moshed…");
    expect(firstSentence("a ".repeat(60), 30).length).toBeLessThanOrEqual(31);
  });

  it("cuts every description and keeps names, types, enums, ranges and required", () => {
    const tool = allTools.find((t) => t.name === "datamosh_cut_tool")!;
    const lean = leanListing(tool);
    const strip = (node: unknown): unknown =>
      Array.isArray(node) ? node.map(strip) : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).filter(([k, v]) => !(k === "description" && typeof v === "string")).map(([k, v]) => [k, strip(v)])) : node;
    expect(strip(lean.inputSchema)).toEqual(strip(tool.inputSchema));
    expect(JSON.stringify(lean).length).toBeLessThan(JSON.stringify({ description: tool.description, inputSchema: tool.inputSchema }).length);
    expect(argumentNotes(tool.name, tool.inputSchema)).toContain("clip_id (required), string: ");
  });
});
