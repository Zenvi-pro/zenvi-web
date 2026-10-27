import { counterValue, formatNumber, odometer, type BlockContext, type Track } from "../../runtime/index.js";

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const values = (p.values as string[]).map((v) => Number(String(v).replace(/[^0-9.+-]/g, "")) || 0);
  if (values.length === 1) values.unshift(0);
  const decimals = Number(p.decimals);
  const box = ctx.el("div", "ct");
  box.style.alignItems = p.align === "left" ? "flex-start" : "center";
  const number = ctx.el("div", "ct-number", box);
  number.style.fontWeight = String(p.weight);
  if (p.prefix) ctx.el("span", "ct-affix", number, String(p.prefix));
  const digitsHost = ctx.el("span", "ct-digits", number);
  if (p.suffix) ctx.el("span", "ct-affix", number, String(p.suffix));
  const label = p.label ? ctx.el("div", "ct-label", box, String(p.label)) : null;

  const enter = 0.6;
  const exit = p.exit === false ? 0 : 0.4;
  const segments = values.length - 1;
  const seg = Math.max(0.6, (ctx.seconds - enter - exit - 0.5) / segments);
  const count = Math.min(1.6, seg * 0.8);
  const steps = values.slice(1).map((to, i) => ({ from: values[i]!, to, at: enter * 0.5 + i * seg, duration: count }));
  const valueAt = (t: number): number => {
    let v = values[0]!;
    for (const s of steps) if (t >= s.at) v = counterValue(t, { ...s, ease: "out" });
    return v;
  };

  const biggest = Math.max(...values.map(Math.abs));
  const intDigits = Math.max(1, String(Math.floor(biggest)).length);
  let track: Track;
  if (p.style === "count" || decimals > 0) {
    const fmt = { decimals, separator: "," };
    digitsHost.textContent = formatNumber(biggest, fmt);
    track = (t) => {
      digitsHost.textContent = formatNumber(valueAt(t), fmt);
    };
  } else {
    const odo = odometer(ctx.doc, intDigits, valueAt);
    digitsHost.append(odo.el);
    track = odo.track;
  }

  // Fit: the widest number spans at most the safe width (and 42 % of the height).
  number.style.fontSize = "100px";
  const w100 = number.getBoundingClientRect().width;
  const size = Math.min(((W - safe.left - safe.right) * 100) / w100, (H - safe.top - safe.bottom) * 0.42, ctx.portrait ? 380 : 420);
  number.style.fontSize = `${size}px`;
  const rect = box.getBoundingClientRect();
  // Centred: anchored at the middle, so the line stays centred as leading digits appear.
  const centred = p.align !== "left";
  Object.assign(box.style, { left: `${centred ? W / 2 : safe.left}px`, top: `${safe.top + (H - safe.top - safe.bottom - rect.height) / 2}px` });
  if (centred) tl.set(box, { xPercent: -50 }, 0);

  tl.track(track);
  // A tick per value change (the last digit's), over each count, and a land as it settles.
  for (const s of steps) {
    const changes = Math.abs(s.to - s.from) * 10 ** decimals;
    if (changes < 1) continue;
    ctx.cue(s.at, "tick", { weight: 0.3, at: number, until: s.at + s.duration, rate: Math.min(20, changes / s.duration) });
    ctx.cue(s.at + s.duration, "land", { weight: 0.5, at: number });
  }
  tl.fromTo(number, { y: size * 0.18, opacity: 0, blur: 14 }, { y: 0, opacity: 1, blur: 0 }, { at: 0, duration: enter, ease: "out" });
  if (label) tl.fromTo(label, { y: 14, opacity: 0 }, { y: 0, opacity: 1 }, { at: 0.2, duration: 0.5, ease: "out" });
}
