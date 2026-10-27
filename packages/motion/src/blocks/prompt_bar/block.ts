import { caretBlink, typedCount, typewriter, type BlockContext } from "../../runtime/index.js";
import { icon, pointer } from "../ui.js";

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const prompt = String(p.prompt);
  const status = String(p.status ?? "");
  const S = ctx.seconds;

  const cardWidth = ctx.portrait ? W - safe.left - safe.right : Math.min(1240, W * 0.64);
  const size = ctx.portrait ? 54 : 50;
  const wrap = ctx.el("div", "pb-wrap");
  wrap.style.width = `${cardWidth}px`;
  wrap.style.setProperty("--pb-size", `${size}px`);

  const brand = p.brand ? ctx.el("div", "pb-brand", wrap) : null;
  if (brand) {
    icon(ctx, "sparkle", "", brand);
    ctx.el("span", "", brand, String(p.brand));
  }
  // Solid, not glass: over video (alpha) there is nothing in the page for a backdrop blur to see.
  const card = ctx.el("div", "pb-card card", wrap);
  const field = ctx.el("div", "pb-field", card);
  const placeholder = ctx.el("div", "pb-placeholder", field, String(p.placeholder ?? ""));
  const typed = ctx.el("span", "pb-typed", field);
  const caret = ctx.el("span", "pb-caret", field);
  const row = ctx.el("div", "pb-row", card);
  const tools = ctx.el("div", "pb-tools", row);
  icon(ctx, "plus", "", ctx.el("div", "pb-tool", tools));
  // No label of ours: the chip is the caller's, or absent.
  if (p.chip) {
    const chip = ctx.el("div", "pb-chip", tools);
    icon(ctx, "sparkle", "", chip);
    ctx.el("span", "", chip, String(p.chip));
  }
  const send = ctx.el("div", "pb-send", row);
  icon(ctx, "arrowUp", "", send);
  const pill = status ? ctx.el("div", "pb-status card", wrap) : null;
  let shimmer: HTMLElement | null = null;
  const dots: HTMLElement[] = [];
  if (pill) {
    icon(ctx, "sparkle", "", pill);
    ctx.el("span", "", pill, status);
    const dotRow = ctx.el("span", "pb-dots", pill);
    for (let i = 0; i < 3; i += 1) dots.push(ctx.el("i", "", dotRow));
    shimmer = ctx.el("span", "pb-shimmer", pill);
  }

  // Size the field for the whole prompt, then empty it.
  typed.textContent = prompt;
  const lines = Math.max(1, Math.round(typed.getBoundingClientRect().height / (size * 1.3)));
  field.style.setProperty("--pb-lines", String(lines));
  typed.textContent = "";

  const h = wrap.getBoundingClientRect().height;
  const top = p.position === "lower" ? H - safe.bottom - h : p.position === "upper" ? safe.top : (H - h) / 2;
  wrap.style.top = `${top}px`;

  // Entrance (TASTE: 0.6-0.8 s, expo-out, from 4 % below with a soft blur).
  tl.fromTo(wrap, { xPercent: -50, y: H * 0.04, scale: 0.96, opacity: 0, blur: 12 }, { xPercent: -50, y: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0, duration: 0.8, ease: "out" });
  ctx.cue(0, "pop", { weight: 0.4, at: { x: W / 2, y: top + h / 2 } });
  if (pill) tl.set(pill, { opacity: 0 }, 0);

  const startType = 0.9;
  const tail = (pill ? 1.4 : 0.6) + 0.5 + (p.exit === false ? 0 : 0.4);
  const chars = Array.from(prompt).length;
  const cps = Math.max(14, Math.min(34, chars / Math.max(0.6, S - startType - tail)));
  const typing = { at: startType, cps };
  const typedEnd = startType + chars / cps;
  tl.track(typewriter(typed, prompt, typing));
  if (chars > 0) ctx.cue(startType, "type", { weight: 0.2, at: field, until: typedEnd, rate: cps });
  tl.track((t) => {
    placeholder.style.opacity = typedCount(prompt, t, typing) > 0 ? "0" : "0.7";
  });
  tl.track(caretBlink(caret, (t) => t >= startType && t <= typedEnd + 0.1, 0.5));

  // The pointer (or just the button) sends.
  const sendAt = typedEnd + 0.35;
  if (p.cursor !== false) {
    const card0 = wrap.getBoundingClientRect();
    const b = send.getBoundingClientRect();
    // Measured with the wrap untransformed at left 50%: the -50 % shift comes from its tween.
    const bx = b.left + b.width / 2 - card0.width / 2;
    const by = b.top + b.height / 2;
    const ptr = pointer(ctx, { x: bx + 160, y: by + 220 }, Math.max(0.6, sendAt - 1.1));
    ptr.moveTo(bx, by, Math.max(0.8, sendAt - 0.85), 0.75);
    // The send button reports the press, with or without the pointer.
    ptr.click(sendAt, null);
    tl.to(ptr.el, { opacity: 0 }, { at: sendAt + 0.6, duration: 0.3, ease: "linear" });
  }
  tl.to(send, { scale: 0.88 }, { at: sendAt, duration: 0.08, ease: "out" });
  ctx.cue(sendAt, "click", { weight: 0.4, at: send });
  tl.to(send, { scale: 1 }, { at: sendAt + 0.08, duration: 0.3, ease: "back-out" });

  if (pill && shimmer) {
    const pillAt = sendAt + 0.3;
    tl.fromTo(pill, { y: 24, scale: 0.9, opacity: 0, blur: 6 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: pillAt, duration: 0.5, ease: "back-out" });
    ctx.cue(pillAt, "pop", { weight: 0.35, at: pill });
    const sh = shimmer;
    tl.track((t) => {
      const phase = ((t - pillAt) / 1.4) % 1;
      sh.style.transform = `translateX(${-100 + 200 * (phase < 0 ? 0 : phase)}%)`;
      dots.forEach((d, i) => {
        const a = Math.max(0, Math.sin((t - pillAt) * 7 - i * 0.7));
        d.style.transform = `translateY(${-7 * a}px)`;
        d.style.opacity = String(0.45 + 0.55 * a);
      });
    });
  }
}

