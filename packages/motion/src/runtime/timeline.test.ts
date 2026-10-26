// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate.js";
import { composeTransform, Timeline } from "./timeline.js";

function box(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

describe("timeline", () => {
  it("is a pure function of t: any seek order gives the same frame", () => {
    const a = box();
    const b = box();
    const state = { v: 0 };
    const tl = new Timeline()
      .fromTo(a, { x: -40, opacity: 0 }, { x: 0, opacity: 1 }, { at: 0.2, duration: 0.6, ease: "out" })
      .to(a, { x: 100 }, { at: 1.5, duration: 0.5 })
      .to(b, { "--glow": 1, backgroundColor: "#ff0000" }, { at: 0, duration: 1 })
      .to(state, { v: 10 }, { at: 0, duration: 2, ease: "linear" })
      .track(() => {
        b.textContent = state.v.toFixed(2);
      });
    const snap = (t: number): string => {
      tl.seek(t);
      return `${a.getAttribute("style")}|${b.getAttribute("style")}|${b.textContent}`;
    };
    const times = [0, 0.1, 0.5, 0.8, 1.2, 1.7, 2.5];
    const forward = times.map(snap);
    const shuffled = [2.5, 0.5, 0, 1.7, 0.1, 1.2, 0.8].map((t) => [t, snap(t)] as const);
    for (const [t, s] of shuffled) expect(s).toBe(forward[times.indexOf(t)]);
    expect(snap(0.8)).toBe(snap(0.8));
  });

  it("holds the first tween's from value before it starts and chains tweens", () => {
    const el = box();
    const tl = new Timeline().fromTo(el, { opacity: 0 }, { opacity: 1 }, { at: 1, duration: 1, ease: "linear" }).to(el, { opacity: 0.2 }, { at: 3, duration: 1, ease: "linear" });
    tl.seek(0);
    expect(el.style.opacity).toBe("0");
    tl.seek(1.5);
    expect(Number(el.style.opacity)).toBeCloseTo(0.5);
    tl.seek(2.5);
    expect(el.style.opacity).toBe("1");
    tl.seek(3.5);
    expect(Number(el.style.opacity)).toBeCloseTo(0.6);
    expect(tl.duration).toBe(4);
  });

  it("staggers targets", () => {
    const els = [box(), box(), box()];
    const tl = new Timeline().fromTo(els, { y: 10 }, { y: 0 }, { at: 0, duration: 0.5, ease: "linear", stagger: 0.25 });
    tl.seek(0.5);
    expect(els.map((e) => e.style.transform)).toEqual(["none", "translate3d(0px, 5px, 0px)", "translate3d(0px, 10px, 0px)"]);
    const reversed = new Timeline().fromTo(els, { y: 10 }, { y: 0 }, { at: 0, duration: 0.5, ease: "linear", stagger: { each: 0.25, from: "end" } });
    reversed.seek(0.5);
    expect(els[0]!.style.transform).toBe("translate3d(0px, 10px, 0px)");
    expect(els[2]!.style.transform).toBe("none");
  });

  it("sets SVG attributes and filters", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    document.body.append(el);
    new Timeline().fromTo(el, { "attr:stroke-dashoffset": 1, blur: 10 }, { "attr:stroke-dashoffset": 0, blur: 0 }, { at: 0, duration: 1, ease: "linear" }).seek(0.25);
    expect(Number(el.getAttribute("stroke-dashoffset"))).toBeCloseTo(0.75);
    expect((el as unknown as HTMLElement).style.filter).toBe("blur(7.5px)");
  });

  it("composes transforms in a fixed order", () => {
    expect(composeTransform(new Map([["scale", 2], ["x", 10], ["xPercent", -50], ["rotate", 5]]))).toBe("translate(-50%, 0%) translate3d(10px, 0px, 0px) rotate(5deg) scale(2, 2)");
    expect(composeTransform(new Map())).toBe("none");
  });
});

describe("interpolate", () => {
  it("interpolates numbers, colours and matching strings", () => {
    expect(interpolate(0, 10, 0.25)).toBe(2.5);
    expect(interpolate("#000000", "#ffffff", 0.5)).toBe("rgba(128, 128, 128, 1)");
    expect(interpolate("rgba(0, 0, 0, 0)", "#ff000080", 1)).toBe("rgba(255, 0, 0, 0.502)");
    expect(interpolate("inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)", 0.5)).toBe("inset(0% 50% 0% 0%)");
    // Shapes that do not line up switch at the end.
    expect(interpolate("none", "blur(4px)", 0.5)).toBe("none");
    expect(interpolate("none", "blur(4px)", 1)).toBe("blur(4px)");
  });

  it("clamps colour channels when an ease overshoots", () => {
    expect(interpolate("#000000", "#ffffff", 1.1)).toBe("rgba(255, 255, 255, 1)");
  });
});
