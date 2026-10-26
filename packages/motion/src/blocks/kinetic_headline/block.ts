import type { BlockContext } from "../../runtime/index.js";
import { fitWidth, parseRich } from "../ui.js";

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const style = String(p.style);
  const lines = parseRich(String(p.text));
  const box = ctx.el("div", `kh kh-${p.emphasis} kh-${style}`);
  box.style.alignItems = p.align === "left" ? "flex-start" : "center";
  box.style.textAlign = p.align === "left" ? "left" : "center";
  if (p.kicker) ctx.el("div", "kh-kicker", box, String(p.kicker));
  const text = ctx.el("div", "kh-text", box);
  const inners: HTMLElement[] = [];
  const words: HTMLElement[][] = [];
  const chars: HTMLElement[][] = [];
  for (const runs of lines) {
    const line = ctx.el("span", "kh-line", text);
    const inner = ctx.el("span", "kh-inner", line);
    inners.push(inner);
    const lineWords: HTMLElement[] = [];
    const lineChars: HTMLElement[] = [];
    for (const run of runs) {
      for (const token of run.text.split(/(\s+)/)) {
        if (!token) continue;
        if (/^\s+$/.test(token)) {
          inner.append(ctx.doc.createTextNode(" "));
          continue;
        }
        const word = ctx.el("span", run.em ? "word em" : "word", inner);
        if (style === "pop") for (const c of Array.from(token)) lineChars.push(ctx.el("span", "char", word, c));
        else word.textContent = token;
        if (style === "pop") for (const c of word.children) (c as HTMLElement).style.display = "inline-block";
        lineWords.push(word);
      }
    }
    words.push(lineWords);
    chars.push(lineChars);
  }

  const maxWidth = W - safe.left - safe.right;
  fitWidth(text, inners, maxWidth, Number(p.max_size));
  const rect = box.getBoundingClientRect();
  const left = p.align === "left" ? safe.left : (W - rect.width) / 2;
  const usable = H - safe.top - safe.bottom;
  const top = p.position === "upper" ? safe.top : p.position === "lower" ? H - safe.bottom - rect.height : safe.top + (usable - rect.height) / 2;
  Object.assign(box.style, { left: `${left}px`, top: `${top}px` });

  const kicker = box.querySelector<HTMLElement>(".kh-kicker");
  if (kicker) tl.fromTo(kicker, { y: 16, opacity: 0 }, { y: 0, opacity: 1 }, { at: 0, duration: 0.5, ease: "out" });
  const start = kicker ? 0.15 : 0;
  // TASTE.md: 0.06 s per word, 0.12 s per line.
  let at = start;
  lines.forEach((_, i) => {
    const lw = words[i]!;
    switch (style) {
      case "blur":
        tl.fromTo(lw, { opacity: 0, blur: 22, scale: 1.12, y: 10 }, { opacity: 1, blur: 0, scale: 1, y: 0 }, { at, duration: 0.8, ease: "out", stagger: 0.07 });
        break;
      case "pop":
        tl.fromTo(chars[i]!, { opacity: 0, scale: 0.3, y: 30 }, { opacity: 1, scale: 1, y: 0 }, { at, duration: 0.45, ease: "back-out", stagger: 0.025 });
        break;
      case "wipe":
        tl.fromTo(inners[i]!, { clipPath: "inset(0% 100% 0% 0%)", x: -30 }, { clipPath: "inset(0% 0% 0% 0%)", x: 0 }, { at, duration: 0.8, ease: "in-out" });
        break;
      default:
        tl.fromTo(lw, { yPercent: 110, rotate: 4 }, { yPercent: 0, rotate: 0 }, { at, duration: 0.75, ease: "out", stagger: 0.06 });
    }
    const perLine = style === "pop" ? chars[i]!.length * 0.025 : style === "wipe" ? 0.25 : lw.length * 0.06;
    at += 0.12 + perLine;
  });
  // A slow push on the hold (TASTE.md §3: 100 → 104 %).
  tl.fromTo(text, { scale: 1 }, { scale: 1.03 }, { at: 0, duration: ctx.seconds, ease: "in-out" });
}
