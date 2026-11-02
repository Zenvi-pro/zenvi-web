/**
 * The director card in the MCP instructions: short enough to send every
 * session, and naming only tools that exist.
 */

import { STYLE_FILES } from "@zenvi/engine/styles";
import { DIRECTOR_CARD } from "@zenvi/engine/tools";
import { describe, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { SERVER_INSTRUCTIONS } from "./server.js";

describe("director card", () => {
  it("is in the server instructions and stays under its 400-token budget", () => {
    expect(SERVER_INSTRUCTIONS).toContain(DIRECTOR_CARD);
    // 926 characters measured 366 Sonnet 5.5 tokens (director-card.ts).
    expect(DIRECTOR_CARD.length).toBeLessThanOrEqual(1000);
  });

  it("sends whole videos to produce_video_tool, by hand to the style tools, and names only tools this server lists", () => {
    expect(DIRECTOR_CARD).toMatch(/produce_video_tool \{request: the person.s words, output\} does it in one call.*By hand: Before the first edit, read its style's recipe: get_style_tool \{"style": "<id>".*Styles: match-cut-montage.*find_style_tool .*get_technique_tool/);
    // Motion design with no footage goes to the scene family, which the styles library serves.
    expect(DIRECTOR_CARD).toContain("get_technique_tool zenvi-scenes");
    expect(STYLE_FILES.some((f) => f.id === "zenvi-scenes" && f.kind === "family")).toBe(true);
    // Every style the card names is one get_style_tool knows.
    const named = DIRECTOR_CARD.slice(DIRECTOR_CARD.indexOf("Styles: ") + 8, DIRECTOR_CARD.indexOf(";", DIRECTOR_CARD.indexOf("Styles: "))).split(", ");
    const styles = new Set(STYLE_FILES.filter((f) => f.kind === "style").map((f) => f.id));
    for (const id of named) expect(styles, id).toContain(id);
    const tools = new Set(engineRegistry().list("mcp", {}, { includeUnavailable: true }).map((t) => t.name));
    for (const name of DIRECTOR_CARD.match(/\b[a-z0-9]+(?:_[a-z0-9]+)*_tool\b/g) ?? []) expect(tools, name).toContain(name);
  });
});
