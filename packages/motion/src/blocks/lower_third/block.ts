import type { BlockContext } from "../../runtime/index.js";
import { onColor } from "../ui.js";

export function build(ctx: BlockContext): void {
  const { tl, params: p, height: H, safe, palette } = ctx;
  const S = ctx.seconds;
  const bar = p.style === "bar";
  const right = p.align === "right";
  ctx.ownExit = p.exit !== false;

  const box = ctx.el("div", `lt${bar ? " is-bar" : ""}${right ? " is-right" : ""}`);
  const nameMask = ctx.el("div", "lt-mask", box);
  const name = ctx.el("span", "lt-name", nameMask, String(p.name));
  const rule = bar ? null : ctx.el("div", "lt-rule", box);
  const roleMask = p.role ? ctx.el("div", "lt-mask", box) : null;
  const role = roleMask ? ctx.el("span", "lt-role", roleMask, String(p.role)) : null;
  // Type scale: TASTE.md §4's lower third, the name in the display face a size up (it carries the piece).
  const nameSize = ctx.portrait ? 104 : 96;
  name.style.fontSize = `${ctx.display === "serif" ? nameSize : nameSize * 0.8}px`;
  if (ctx.display !== "serif") name.style.fontWeight = "650";
  if (role) role.style.fontSize = `${ctx.portrait ? 38 : 36}px`;

  const rect = box.getBoundingClientRect();
  const width = Math.max(name.getBoundingClientRect().width, role?.getBoundingClientRect().width ?? 0);
  if (rule) rule.style.width = `${width + 36}px`;
  // Baseline of the name at ~80 % of the frame (landscape), ~70 % (vertical): TASTE.md §3.
  const nameH = nameMask.getBoundingClientRect().height;
  const top = Math.min(H - safe.bottom - rect.height, H * (ctx.portrait ? 0.7 : 0.8) - nameH);
  Object.assign(box.style, { top: `${top}px`, ...(right ? { right: `${safe.right}px` } : { left: `${safe.left}px` }) });

  const enter = 0.1;
  const out = Math.max(1.6, S - 0.6);
  const sign = right ? -1 : 1;
  if (rule) {
    // The line draws from the safe edge, the name rises out of it and the role drops out under it.
    tl.set(rule, { transformOrigin: right ? "100% 50%" : "0 50%" }, 0);
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1 }, { at: enter, duration: 0.6, ease: "in-out" });
    tl.fromTo(name, { yPercent: 105 }, { yPercent: 0 }, { at: enter + 0.3, duration: 0.7, ease: "out" });
    if (role) tl.fromTo(role, { yPercent: -110 }, { yPercent: 0 }, { at: enter + 0.4, duration: 0.7, ease: "out" });
    if (ctx.ownExit) {
      // Out the way they came in: the line wipes on in its drawing direction, the name up, the role down.
      tl.to(rule, { scaleX: 0 }, { at: out + 0.05, duration: 0.45, ease: "in" });
      tl.set(rule, { transformOrigin: right ? "0 50%" : "100% 50%" }, out);
      tl.to(name, { yPercent: -105 }, { at: out, duration: 0.4, ease: "in" });
      if (role) tl.to(role, { yPercent: 110 }, { at: out, duration: 0.4, ease: "in" });
    }
  } else {
    // A solid bar wipes in behind the name; its edge uncovers the type as it passes.
    name.style.background = palette.accent;
    name.style.color = onColor(palette.accent);
    const wipe = (el: HTMLElement, at: number, duration: number): void => {
      tl.fromTo(el, { clipPath: right ? "inset(0% 0% 0% 100%)" : "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)" }, { at, duration, ease: "in-out" });
      if (ctx.ownExit) tl.to(el, { clipPath: right ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 0% 100%)" }, { at: out + (el === name ? 0 : 0.06), duration: 0.42, ease: "in" });
    };
    wipe(name, enter, 0.6);
    tl.fromTo(name, { x: -24 * sign }, { x: 0 }, { at: enter, duration: 0.8, ease: "out" });
    if (role) {
      wipe(role, enter + 0.18, 0.55);
      tl.fromTo(role, { x: -24 * sign }, { x: 0 }, { at: enter + 0.18, duration: 0.8, ease: "out" });
    }
  }
}
