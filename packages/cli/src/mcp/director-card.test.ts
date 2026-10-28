/**
 * The director card in the MCP instructions: short enough to send every
 * session, and naming only recipes and tools that exist.
 */

import { DIRECTOR_CARD } from "@zenvi/engine/tools";
import { describe, expect, it } from "vitest";
import { engineRegistry } from "../engine/registry.js";
import { DIRECTOR_RECIPES } from "../hosts/director.gen.js";
import { SERVER_INSTRUCTIONS } from "./server.js";

describe("director card", () => {
  it("is in the server instructions and stays under its 400-token budget", () => {
    expect(SERVER_INSTRUCTIONS).toContain(DIRECTOR_CARD);
    // 926 characters measured 366 Sonnet 5.5 tokens (director-card.ts).
    expect(DIRECTOR_CARD.length).toBeLessThanOrEqual(1000);
  });

  it("names every recipe the director has, and only tools this server lists", () => {
    const recipes = DIRECTOR_CARD.slice(DIRECTOR_CARD.indexOf("Recipes:"), DIRECTOR_CARD.indexOf("\n"));
    for (const recipe of DIRECTOR_RECIPES) expect(recipes, recipe.genre).toMatch(new RegExp(`\\b${recipe.genre}\\b`));
    const tools = new Set(engineRegistry().list("mcp", {}, { includeUnavailable: true }).map((t) => t.name));
    for (const name of DIRECTOR_CARD.match(/\b[a-z0-9]+(?:_[a-z0-9]+)*_tool\b/g) ?? []) expect(tools, name).toContain(name);
  });
});
