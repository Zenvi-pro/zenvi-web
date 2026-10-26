import { caretBlink, resolveEase, typedCount, typewriter, type BlockContext } from "../../runtime/index.js";
import { icon, onColor } from "../ui.js";
import { planChat, type Turn } from "./schedule.js";

interface Word {
  el: HTMLElement;
  em: boolean;
}

/** A reply's words as spans (spaces stay text so it wraps), `*starred*` runs marked for the sweep. */
function replyWords(ctx: BlockContext, host: HTMLElement, text: string): Word[] {
  const words: Word[] = [];
  text.split(/(\*[^*]+\*)/).forEach((part) => {
    if (!part) return;
    const em = part.length > 2 && part.startsWith("*") && part.endsWith("*");
    for (const token of (em ? part.slice(1, -1) : part).split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) host.append(ctx.doc.createTextNode(" "));
      else words.push({ el: ctx.el("span", em ? "word em" : "word", host, token), em });
    }
  });
  return words;
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const messages = p.messages as string[];
  const name = String(p.assistant);
  const S = ctx.seconds;

  const colW = ctx.portrait ? W - safe.left - safe.right : Math.min(1180, W * 0.62);
  const col = ctx.el("div", "chat-col");
  Object.assign(col.style, { left: `${(W - colW) / 2}px`, top: `${safe.top}px`, width: `${colW}px`, height: `${H - safe.top - safe.bottom}px` });

  // Composer, pinned to the column's foot; sized for the longest question.
  const composer = ctx.el("div", "chat-composer", col);
  const field = ctx.el("div", "chat-field", composer);
  const placeholder = ctx.el("div", "chat-placeholder", field, String(p.placeholder || `Ask ${name}…`));
  const typed = ctx.el("span", "chat-typed", field);
  const caret = ctx.el("span", "chat-caret", field);
  const send = ctx.el("div", "chat-send", composer);
  send.style.color = onColor(palette.accent);
  icon(ctx, "arrowUp", "", send);
  const questions = messages.filter((_, i) => i % 2 === 0);
  typed.textContent = questions.reduce((a, b) => (b.length > a.length ? b : a), "");
  const lines = Math.min(3, Math.max(1, Math.round(typed.getBoundingClientRect().height / (34 * 1.3))));
  field.style.setProperty("--lines", String(lines));
  typed.textContent = "";
  const composerH = composer.getBoundingClientRect().height;
  composer.style.top = `${H - safe.top - safe.bottom - composerH}px`;

  // The thread scrolls inside a view above the composer.
  const viewH = H - safe.top - safe.bottom - composerH - 40;
  const view = ctx.el("div", "chat-view", col);
  Object.assign(view.style, { left: "0", top: "0", width: `${colW}px`, height: `${viewH}px` });
  const thread = ctx.el("div", "chat-thread", view);

  const onAccent = onColor(palette.accent);
  const textSize = ctx.display === "serif" ? (ctx.portrait ? 70 : 62) : ctx.display === "display" ? 64 : ctx.portrait ? 52 : 46;
  const items = messages.map((text, i) => {
    if (i % 2 === 0) {
      const bubble = ctx.el("div", "chat-me", thread, text);
      bubble.style.color = onAccent;
      return { kind: "user" as const, el: bubble, text, words: [] as Word[], dots: null as HTMLElement | null };
    }
    const row = ctx.el("div", "chat-ai", thread);
    icon(ctx, "sparkle", "", ctx.el("div", "chat-mark", row));
    const body = ctx.el("div", "chat-body", row);
    ctx.el("div", "chat-name", body, name);
    const reply = ctx.el("div", "chat-text", body);
    reply.style.fontSize = `${textSize}px`;
    const words = replyWords(ctx, reply, text);
    const dots = ctx.el("div", "chat-dots", body);
    for (let d = 0; d < 3; d += 1) ctx.el("i", "", dots);
    return { kind: "assistant" as const, el: row, text, words, dots };
  });

  const marks = items.flatMap((it) => it.words.filter((w) => w.em));
  const tail = (marks.length > 0 ? 0.95 : 0) + 1.0 + (p.exit === false ? 0 : 0.4);
  const turns: Turn[] = items.map((it) => ({ role: it.kind, units: it.kind === "user" ? Array.from(it.text).length : it.words.length }));
  const plan = planChat(turns, S, tail);

  // Where things sit in the thread (measured untransformed), for the scroll.
  const threadTop = thread.getBoundingClientRect().top;
  const bottomOf = (el: Element): number => el.getBoundingClientRect().bottom - threadTop;
  /** Scroll so `bottom` (thread px) sits at the view's foot: the conversation grows up from the composer. */
  const scrollFor = (bottom: number): number => viewH - 20 - bottom;
  let scroll = scrollFor(bottomOf(items[0]!.el));
  tl.set(thread, { y: scroll }, 0);
  const scrollTo = (bottom: number, at: number): void => {
    const y = scrollFor(bottom);
    if (Math.abs(y - scroll) < 1) return;
    tl.to(thread, { y }, { at, duration: 0.45, ease: "out" });
    scroll = y;
  };

  items.forEach((it, i) => {
    const time = plan.turns[i]!;
    if (it.kind === "user") {
      // Typed into the composer, then sent up into the thread.
      const opts = { at: time.start, cps: plan.cps };
      const text = it.text;
      tl.track((t) => {
        if (t < time.start || t >= time.send) return;
        typewriter(typed, text, opts)(t);
      });
      tl.set(it.el, { opacity: 0 }, 0);
      tl.fromTo(it.el, { y: composerH + 60, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1 }, { at: time.send, duration: 0.55, ease: "out" });
      tl.to(send, { scale: 0.86 }, { at: time.send - 0.06, duration: 0.08, ease: "out" });
      tl.to(send, { scale: 1 }, { at: time.send + 0.02, duration: 0.3, ease: "out" });
      scrollTo(bottomOf(it.el), time.send);
      return;
    }
    // Dots, then the reply streams word by word, the thread following its lines.
    const dots = it.dots!;
    tl.set(it.el, { opacity: 0 }, 0);
    tl.fromTo(it.el, { y: 24, opacity: 0 }, { y: 0, opacity: 1 }, { at: time.start, duration: 0.4, ease: "out" });
    tl.fromTo(dots, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1 }, { at: time.start, duration: 0.3, ease: "out" });
    tl.to(dots, { opacity: 0, scale: 0.9 }, { at: time.send, duration: 0.15, ease: "exit" });
    const dotEls = Array.from(dots.children) as HTMLElement[];
    tl.track((t) => {
      if (t < time.start || t > time.send) return;
      dotEls.forEach((d, k) => {
        const a = Math.max(0, Math.sin((t - time.start) * 9 - k * 0.8));
        d.style.transform = `translateY(${-8 * a}px)`;
        d.style.opacity = String(0.4 + 0.6 * a);
      });
    });
    scrollTo(bottomOf(dots), time.start);
    const each = (time.end - time.send) / Math.max(1, it.words.length);
    let lineBottom = -1;
    it.words.forEach((w, k) => {
      const at = time.send + k * each;
      tl.fromTo(w.el, { opacity: 0, blur: 6 }, { opacity: 1, blur: 0 }, { at, duration: 0.3, ease: "out" });
      const b = bottomOf(w.el);
      if (b > lineBottom + 2) {
        lineBottom = b;
        scrollTo(b, at - 0.15);
      }
    });
  });

  // After the last word, a beat of stillness; then the marker sweeps the starred words.
  const lastEnd = plan.turns[plan.turns.length - 1]!.end;
  const markAt = lastEnd + 0.45;
  // One pen stroke across every starred word: one in-out ease over their summed width.
  const widths = marks.map((w) => Math.max(1, w.el.getBoundingClientRect().width));
  const totalW = widths.reduce((a, b) => a + b, 0);
  const strokeFor = Math.min(0.9, 0.35 + totalW / 2400);
  const pen = resolveEase("in-out");
  const sweeps = marks.map((w, k) => {
    const sweep = ctx.el("span", "chat-mark-sweep", w.el);
    // Bridge the space to the next starred word of the same run.
    if (marks[k + 1] && w.el.nextSibling?.nextSibling === marks[k + 1]!.el) sweep.style.right = "-0.34em";
    sweep.style.transform = "scaleX(0)";
    return sweep;
  });
  if (sweeps.length > 0) {
    tl.track((t) => {
      let x = pen(Math.min(1, Math.max(0, (t - markAt) / strokeFor))) * totalW;
      sweeps.forEach((sweep, k) => {
        const f = Math.min(1, Math.max(0, x / widths[k]!));
        sweep.style.transform = `scaleX(${f.toFixed(4)})`;
        x -= widths[k]!;
      });
    });
  }

  // Composer: placeholder when empty, caret while typing or idle.
  const userTimes = plan.turns.filter((t) => t.role === "user");
  const typingNow = (t: number): boolean => userTimes.some((u) => t >= u.start && t < u.send);
  tl.track((t) => {
    const active = userTimes.find((u) => t >= u.start && t < u.send);
    const shown = active ? typedCount(messages[plan.turns.indexOf(active)]!, t, { at: active.start, cps: plan.cps }) : 0;
    if (!active) typed.textContent = "";
    placeholder.style.opacity = shown > 0 ? "0" : "1";
  });
  tl.track(caretBlink(caret, typingNow, 0.3));
  tl.fromTo(col, { y: 40, opacity: 0 }, { y: 0, opacity: 1 }, { at: 0, duration: 0.6, ease: "out" });
}
