// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BLOCKS } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { createContext } from "../../runtime/index.js";
import { build } from "./block.js";

const manifest = BLOCKS.find((b) => b.id === "logo_build")!;

describe("logo_build", () => {
  // The page fades the root out over the last 0.4 s (runtime/page.ts EXIT_SECONDS).
  it.each(["n", "northfold", "x".repeat(24)])("lands the wordmark and tagline before the exit at the minimum duration (%s)", (name) => {
    document.body.innerHTML = "";
    const checked = checkParams(manifest, { name });
    if (!checked.ok) throw new Error(checked.error);
    const seconds = manifest.duration.min;
    const ctx = createContext(document, { block: "logo_build", params: checked.params, width: 1080, height: 1920, fps: 30, seconds, alpha: false, media: {}, draft: false });
    build(ctx);
    const held = seconds - 0.4 - 0.1;
    const last = [...ctx.root.querySelectorAll(".lbx-name .char")].at(-1)!;
    expect(Object.fromEntries(ctx.tl.valuesAt(last, held))).toEqual({ yPercent: 0, rotate: 0 });
    expect(Object.fromEntries(ctx.tl.valuesAt(ctx.root.querySelector(".lbx-tag")!, held))).toEqual({ opacity: 1, y: 0 });
  });
});
