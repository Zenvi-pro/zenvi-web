// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BLOCKS } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { createContext } from "../../runtime/index.js";
import { build } from "./block.js";

const manifest = BLOCKS.find((b) => b.id === "data_table")!;

describe("data_table", () => {
  it("picks the highlighted row out only after the rows have landed", () => {
    document.body.innerHTML = "";
    const checked = checkParams(manifest, { highlight: 1 });
    if (!checked.ok) throw new Error(checked.error);
    const ctx = createContext(document, { block: "data_table", params: checked.params, width: 1080, height: 1920, fps: 30, seconds: 5, alpha: true, media: {}, draft: false });
    build(ctx);
    const marks = [...ctx.root.querySelectorAll(".dt-mark")];
    expect(marks).toHaveLength(4);
    expect(ctx.tl.valuesAt(marks[1]!, 1).get("opacity")).toBe(0);
    expect(ctx.tl.valuesAt(marks[1]!, 4).get("opacity")).toBe(1);
    // The other rows have no mark tween: they keep the stylesheet's opacity 0.
    expect(ctx.tl.valuesAt(marks[0]!, 4).has("opacity")).toBe(false);
  });
});
