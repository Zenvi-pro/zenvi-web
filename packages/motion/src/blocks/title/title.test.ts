// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getBlock } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { createContext } from "../../runtime/index.js";
import { build } from "./block.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

function title(params: Record<string, unknown>, seconds: number) {
  const checked = checkParams(getBlock("title")!, params);
  if (!checked.ok) throw new Error(checked.error);
  const ctx = createContext(document, { block: "title", params: checked.params, width: 1920, height: 1080, fps: 30, seconds, alpha: true, media: {}, draft: false });
  build(ctx);
  return ctx;
}

describe("title block", () => {
  it("plays a short lower third's entrance before its exit starts", () => {
    const ctx = title({ style: "lower_third", title: "Jane Doe", subtitle: "Founder" }, 1);
    ctx.tl.seek(0.79); // the exit starts at 0.8 s (the last 20 %)
    // The plate has wiped all the way in (at full length it ends at 0.85 s).
    expect(ctx.root.querySelector<HTMLElement>(".tt-plate")!.style.clipPath).toBe("inset(0% 0% 0% 0%)");
  });

  it("cuts a long lower-third name on its plate instead of running off the frame", () => {
    const ctx = title({ style: "lower_third", title: "A".repeat(200) }, 5);
    const name = ctx.root.querySelector<HTMLElement>(".tt-n")!;
    expect([name.style.overflow, name.style.textOverflow]).toEqual(["hidden", "ellipsis"]);
  });
});
