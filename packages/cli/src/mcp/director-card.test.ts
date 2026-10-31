/**
 * The director card in the MCP instructions: short enough to send every
 * session, and naming only tools that exist.
 */

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

  it("sends whole videos to the style tools, and names only tools this server lists", () => {
    expect(DIRECTOR_CARD).toMatch(/find_style_tool \{request\}.*get_style_tool \{style, length_seconds\}.*get_technique_tool/);
    const tools = new Set(engineRegistry().list("mcp", {}, { includeUnavailable: true }).map((t) => t.name));
    for (const name of DIRECTOR_CARD.match(/\b[a-z0-9]+(?:_[a-z0-9]+)*_tool\b/g) ?? []) expect(tools, name).toContain(name);
  });
});
