---
id: scenes-launch-teaser
kind: technique
summary: "A worked launch teaser as one scene: the problem piles up, one row becomes the mark, proof in the product, lockup."
categories: [cinetic-teaser, cinetic-launch-film]
tools: [produce_video_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, review_render_tool, watch_render_tool]
pace: fast
mood: [crisp, premium, launch]
aspect: ["16:9", "9:16", "1:1"]
pairs_with: [zenvi-scenes, cin-le-device-becomes-mark]
avoid_with: [kcut-strobe-cards, kcut-hit-fx]
needs: []
---

# Launch teaser scene (worked example: "sift")

## What it is

A 15-45 s launch teaser written as one scene (the `zenvi-scenes` family). Idea: an inbox that sorts
itself before you look. Story device: one row of the inbox; it lights in the accent inside the pile,
everything else drains, and it becomes the bottom bar of the mark (three bars narrowing like a sieve).
`produce_video_tool` drafts `cinetic-teaser` and `cinetic-launch-film` from this module (`SECONDS` set to
the asked length, the request's name as params); the inbox stays until you rewrite it for the product.

## Build it in Zenvi

1. Keep the grid and the acts; replace the objects with the product's own. A build cache: the rows are
   build targets, the counter is the build clock (14:32 -> 0:09), the lit row is the one target that
   changed. A bill splitter: the rows are line items, the lit one is the dish only one person had.
2. Copy and colours are `params`; strings left empty are not drawn (a row without a label is a bar).
3. `update_scene_tool {"scene_id": "<id>", "code": "<module>"}` (or `create_scene_tool` in an empty
   project), read the contact sheet, then `render_scene_tool {"scene_id": "<id>", "motion_blur": 4}` and
   `auto_sound_design_tool {"genre": "saas_ui", "intensity": "normal"}`.

## Timing & taste

120 BPM at 60 fps (beat 30 f). Acts are shares of the length snapped to beats: hook 0-15 %, pile-up to
40 %, turn (hard cut on the hit) 40-50 %, proof 50-80 %, lockup 80-100 %. 12 words in five fragments of
1-4 words, one on screen at a time. Frame 0 is already moving (three rows in the feed).

## Sound

16 cues, each caused by something on screen: a reveal per fragment, a tick run while rows pile, a glint
when the row lights, a whoosh as the rest drains, impacts on the turn and the lockup, lands on the mark's
bars and the window, a swap when the rows sort, ticks under the counter.

## Common mistakes

Text in rows that the camera's push carries outside the safe zone (here they become bars); a fragment
arriving before the previous one has left (overlap); `toLocaleString` (refused: it depends on the
machine; `commas` formats); a lockup cut that shows an empty frame (the accent bar is there on the cut).

## The scene

```ts
// Launch teaser: "sift", an invented inbox app. The story device is one row of the inbox: it lights in
// the accent inside the pile, everything else drains away, and it becomes the bottom bar of the mark.
// One grid: 120 BPM at 60 fps, a beat is 30 frames; every act and cue sits on a beat.
export const title = "Launch teaser";
export const fps = 60;
const SECONDS = 20;
const BEAT = 30;
export const duration = SECONDS * fps;
// Acts as shares of the film, snapped to the beat: hook, pile-up, turn, proof, lockup.
const at = (share: number): number => Math.round((duration * share) / BEAT) * BEAT;
const ACT = { pile: at(0.15), one: at(0.4) - 2 * BEAT, turn: at(0.4), proof: at(0.5), lock: at(0.8) };

export const params = {
  name: "sift",
  tagline: "Only what matters.",
  hook: ["Every morning.", "Everything is urgent."],
  proof: ["Sorted before you look.", "The rest can wait."],
  app: "Inbox",
  view: "Today",
  items: ["Invoice 2231 is overdue", "Lunch on Thursday?", "Your build failed", "Re: Q3 numbers", "Weekly digest", "Flight check-in open", "New login from Safari", "Team offsite photos"],
  // The items that matter (indexes into items), shown first once sorted.
  keep: [0, 2, 3],
  count: 1284,
  unit: "unread",
  paper: "#0E1116",
  ink: "#F2F4F7",
  accent: "#2FCB8E",
};

export const cues = {
  hook1: { at: 6, kind: "reveal", weight: 0.4 },
  hook2: { at: 3 * BEAT, kind: "reveal", weight: 0.4 },
  pile: { at: ACT.pile, kind: "tick", until: ACT.one - BEAT / 2, rate: 8, weight: 0.2, y: 0.6 },
  one: { at: ACT.one, kind: "glint", weight: 0.5 },
  drain: { at: ACT.turn - BEAT, kind: "whoosh", weight: 0.6 },
  turn: { at: ACT.turn, kind: "impact", weight: 0.9, hit: 1, shake: 6, flash: 0, cut: true },
  bar2: { at: ACT.turn + BEAT / 2, kind: "land", weight: 0.35 },
  bar3: { at: ACT.turn + BEAT, kind: "land", weight: 0.35 },
  land: { at: ACT.proof, kind: "land", weight: 0.6, hit: 0.4, flash: 0, cut: true },
  sort: { at: ACT.proof + BEAT, kind: "swap", weight: 0.4 },
  count: { at: ACT.proof + 2 * BEAT, kind: "tick", until: ACT.proof + 5 * BEAT, rate: 14, weight: 0.25, x: 0.7, y: 0.3 },
  proof1: { at: at(0.65), kind: "reveal", weight: 0.4 },
  proof2: { at: at(0.72), kind: "reveal", weight: 0.4 },
  lock: { at: ACT.lock, kind: "impact", weight: 1, hit: 1.2, shake: 8, flash: 0, cut: true },
  name: { at: ACT.lock + BEAT, kind: "reveal", weight: 0.5 },
  tag: { at: ACT.lock + 3 * BEAT, kind: "reveal", weight: 0.3 },
};

// Thousands with commas (toLocaleString depends on the machine: not allowed in a scene).
const commas = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// The mark: three stacked bars narrowing like a sieve; the accent one is the row that mattered.
function mark(api, cx: number, cy: number, s: number, land: readonly number[], ink: string, accent: string): void {
  const widths = [1, 0.72, 0.44];
  const h = s * 0.17;
  const gap = s * 0.11;
  const top = cy - (3 * h + 2 * gap) / 2;
  widths.forEach((w, i) => {
    const p = land[i] ?? 1;
    if (p <= 0) return;
    const y = top + i * (h + gap) - (1 - p) * s * 0.35;
    api.rect(cx - (w * s) / 2, y, w * s, h, { fill: i === 2 ? accent : ink, radius: h / 2, opacity: Math.min(1, p * 1.5) });
  });
}

export function draw(ctx: CanvasRenderingContext2D, t: number, api) {
  const { W, H, p, safe } = api;
  const paper = String(p.paper);
  const ink = String(p.ink);
  const accent = String(p.accent);
  const items = (p.items as string[]).length > 0 ? (p.items as string[]) : [""];
  // Every string on screen is a param; an empty one is not drawn (the row becomes a bar).
  const say = (str: unknown, o): void => {
    if (typeof str === "string" && str) api.text(str, o);
  };
  const keep = p.keep as number[];
  const hero = Math.min(112, W * 0.075);
  // UI text sizes: the readable minimum is 22 px at 16:9 and 32 px at 9:16 (the layout audit).
  const ui = api.portrait ? 34 : 30;
  const fine = api.portrait ? 32 : 24;
  const innerW = W - safe.left - safe.right;
  api.hitFx({ look: "clean", bloom: 0 });
  api.grain(0.04);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  api.gradient({ stops: [[0, "rgba(255,255,255,0.05)"], [1, "rgba(255,255,255,0)"]], radial: { cy: 0.3, r: 0.8 } });

  if (t < api.cue("turn")) {
    // Acts 1-2: the inbox piles up. New rows arrive at the top, faster and faster, then the rows compress
    // into a wall; on "one" the arrivals stop and one row lights in the accent.
    const arrived = t < ACT.pile ? 3 + t / BEAT : 9 + Math.pow(api.prog(ACT.pile, ACT.one - ACT.pile, "in"), 1.4) * 70;
    const rowH = api.tween(ACT.pile, ACT.one - ACT.pile, 92, 30, "in-out");
    const feedW = Math.min(1100, innerW / 1.18);
    const fx = (W - feedW) / 2;
    const fy = H * (api.portrait ? 0.4 : 0.36);
    const star = Math.floor(api.lerp(0, 76, api.prog(ACT.pile, ACT.one - ACT.pile, "in"))) - 9;
    const zoom = api.tween(0, ACT.one, 1, 1.18, "smooth");
    const camY = api.tween(ACT.pile + BEAT, ACT.one - ACT.pile - BEAT, 0, H * 0.12, "smooth");
    api.camera({ zoom, y: camY });
    // Rows that would sit outside the title-safe zone on screen show bars, not words.
    const readable = (y: number): boolean => H / 2 + (y - H / 2 - camY) * zoom < H - safe.bottom && feedW * zoom <= innerW + 2;
    api.layer(1, () => {
      const dim = api.prog("one", 20, "smooth");
      const drain = api.prog("drain", BEAT, "in");
      // The counter pill rides on top of the feed.
      const shown = Math.round(api.lerp(12, Number(p.count), api.prog(0, ACT.one, "in")));
      api.ui.card({ x: fx, y: fy - 96, w: feedW, h: 72, radius: 18, fill: "rgba(255,255,255,0.05)", stroke: "rgba(255,255,255,0.08)", opacity: 1 - drain });
      say(p.app, { x: fx + 32, y: fy - 60, size: ui, weight: 600, color: ink, opacity: 1 - drain, ui: true, id: "inbox" });
      say(p.unit && `${commas(shown)} ${p.unit}`, { x: fx + feedW - 32, y: fy - 60, size: ui, font: "mono", weight: 500, align: "right", color: ink, opacity: (1 - drain) * 0.8, ui: true, id: "count" });
      const newest = Math.floor(arrived);
      const slide = arrived - newest;
      for (let k = newest; k > newest - 64 && k >= 0; k--) {
        const y = fy + (newest - k + slide - 1) * rowH;
        if (y > H / 0.85 + rowH) break;
        const isStar = k === star && t >= api.cue("one");
        const enter = k === newest ? slide : 1;
        const fall = isStar ? 0 : drain * drain * (500 + api.rng(k) * 400);
        const alpha = enter * (isStar ? 1 : 1 - dim * 0.75) * (isStar ? 1 : 1 - drain);
        if (alpha <= 0.01) continue;
        const h = rowH * 0.78;
        api.rect(fx, y + fall, feedW, h, { fill: isStar ? accent : "rgba(255,255,255,0.06)", radius: Math.min(16, h / 2), opacity: alpha });
        api.circle(fx + h * 0.55, y + fall + h / 2, h * 0.24, { fill: isStar ? paper : "rgba(255,255,255,0.22)", opacity: alpha });
        if (rowH >= 64 && readable(y + h) && items[k % items.length]) {
          say(items[k % items.length], { x: fx + h * 1.1, y: y + h / 2, size: 34, weight: 500, color: ink, opacity: alpha * 0.85, ui: true, id: `row${k}` });
          api.text(`7:${String(59 - (k % 60)).padStart(2, "0")}`, { x: fx + feedW - 28, y: y + h / 2, size: fine, font: "mono", align: "right", color: ink, opacity: alpha * 0.5, ui: true, id: `time${k}` });
        } else {
          api.rect(fx + h * 1.1, y + fall + h * 0.38, feedW * (0.3 + api.rng(k, 1) * 0.35), h * 0.24, { fill: isStar ? paper : "rgba(255,255,255,0.16)", radius: h * 0.12, opacity: alpha });
        }
      }
    });
    // The hook, two fragments over the feed's head; both leave before the wall fills the frame.
    api.layer(0.1, () => {
      const hy = api.portrait ? H * 0.24 : H * 0.17;
      say((p.hook as string[])[0], { x: W / 2, y: hy, size: hero, weight: 650, align: "center", color: ink, reveal: { at: "hook1", per: "word", stagger: 6, dur: 24, out: "hook2" } });
      say((p.hook as string[])[1], { x: W / 2, y: hy, size: hero, weight: 650, align: "center", color: ink, maxWidth: innerW, reveal: { at: api.cue("hook2") + 30, per: "word", stagger: 6, dur: 24, out: ACT.pile + BEAT / 2 } });
    });
    return;
  }

  if (t < api.cue("land")) {
    // The turn: a hard cut on the hit; the accent row is alone, centred, and the mark lands bar by bar on the beat.
    const s = Math.min(W, H) * 0.34;
    const relay = api.prog(ACT.proof - 24, 24, "in");
    const cx = api.lerp(W / 2, W / 2 - Math.min(1200, innerW) / 2 + 92, relay);
    const cy = api.lerp(H / 2, H * 0.46 - Math.min(640, H * 0.6) / 2 + 92, relay);
    api.camera({ zoom: api.tween("turn", ACT.proof - ACT.turn, 1, 1.04, "smooth") });
    api.layer(1, () => {
      const spring = api.spring({ mass: 1, stiffness: 260, damping: 22 });
      mark(api, cx, cy, s * api.lerp(1, 0.16, relay), [api.prog("bar2", 18, spring), api.prog("bar3", 18, spring), 1], ink, accent);
    });
    return;
  }

  if (t < api.cue("lock")) {
    // Proof: the inbox again, sorted. The rows that matter rise to the top, the rest fold into one line,
    // and the counter rolls down to the few.
    const winW = Math.min(1200, innerW);
    const winH = Math.min(640, H * 0.6);
    const wx = (W - winW) / 2;
    const wy = H * 0.46 - winH / 2;
    const land = api.prog("land", 26, api.spring({ mass: 1, stiffness: 200, damping: 22 }));
    api.camera({ zoom: api.tween("land", ACT.lock - ACT.proof, 1.0, 1.05, "smooth"), y: api.tween("land", ACT.lock - ACT.proof, 0, 20, "smooth") });
    api.layer(1, () => {
      api.ui.card({ x: wx, y: wy + (1 - land) * 60, w: winW, h: winH, radius: 28, fill: "rgba(255,255,255,0.045)", stroke: "rgba(255,255,255,0.10)", opacity: Math.min(1, land * 2) });
      mark(api, wx + 92, wy + 92, Math.min(1, land) * 0 + 54, [1, 1, 1], ink, accent);
      say(p.view, { x: wx + 150, y: wy + 92, size: 40, weight: 650, color: ink, ui: true, id: "today" });
      const left = keep.length;
      const n = Math.round(api.lerp(Number(p.count), left, api.prog("count", api.cue("proof1") - api.cue("count") - BEAT, "smooth")));
      say(p.unit && `${commas(n)} ${p.unit}`, { x: wx + winW - 56, y: wy + 92, size: 40, font: "mono", weight: 600, align: "right", color: t >= api.cue("count") ? accent : ink, ui: true, id: "left" });
      const order = [0, 1, 2, 3, 4, 5].map((i) => i % items.length);
      const sort = api.prog("sort", 30, "out");
      const rowH = (winH - 200) / 6;
      order.forEach((item, i) => {
        const rank = keep.indexOf(item);
        const from = wy + 170 + i * rowH;
        const to = rank >= 0 ? wy + 170 + rank * rowH : wy + 170 + (left + 0.4) * rowH;
        const y = api.lerp(from, to, sort) + (1 - land) * 60;
        const fade = rank >= 0 ? 1 : 1 - api.prog(api.cue("sort") - 10, 12, "in");
        if (fade <= 0.01) return;
        api.rect(wx + 40, y, winW - 80, rowH - 14, { fill: rank >= 0 && sort > 0.5 ? "rgba(47,203,142,0.10)" : "rgba(255,255,255,0.05)", radius: 14, opacity: fade });
        api.circle(wx + 76, y + (rowH - 14) / 2, 9, { fill: rank >= 0 && sort > 0.5 ? accent : "rgba(255,255,255,0.3)", opacity: fade });
        if (!items[item]) api.rect(wx + 104, y + (rowH - 14) * 0.4, (winW - 200) * (0.35 + api.rng(item, 2) * 0.3), (rowH - 14) * 0.2, { fill: "rgba(255,255,255,0.16)", radius: 6, opacity: fade });
        say(items[item], { x: wx + 104, y: y + (rowH - 14) / 2, size: ui, weight: 550, color: ink, opacity: fade, ui: true, id: `sorted${i}` });
      });
      const fold = api.prog(api.cue("sort") + 20, 20, "out");
      if (fold > 0) {
        const y = wy + 170 + left * rowH;
        api.rect(wx + 40, y, 260, rowH - 14, { fill: "rgba(255,255,255,0.05)", radius: (rowH - 14) / 2, opacity: fold });
        say(p.unit && `${commas(Number(p.count) - left)} later`, { x: wx + 170, y: y + (rowH - 14) / 2, size: fine, weight: 500, align: "center", color: ink, opacity: fold * 0.6, ui: true, id: "later" });
      }
    });
    api.layer(0.6, () => {
      const ty = Math.min(H - safe.bottom - 48, wy + winH + (api.portrait ? 160 : 110));
      const proof = p.proof as string[];
      say(proof[0], { x: W / 2, y: ty, size: Math.min(80, W * 0.06), weight: 650, align: "center", color: ink, maxWidth: innerW, reveal: { at: "proof1", per: "word", stagger: 6, dur: 22, out: api.cue("proof2") - 42 } });
      say(proof[1], { x: W / 2, y: ty, size: Math.min(80, W * 0.06), weight: 650, align: "center", color: ink, maxWidth: innerW, reveal: { at: "proof2", per: "word", stagger: 6, dur: 22, out: ACT.lock - 14 } });
    });
    return;
  }

  // Lockup: a hard cut on the heaviest hit; the mark lands, slides left and the name follows out of it.
  const s = Math.min(W, H) * (api.portrait ? 0.22 : 0.2);
  const nameSize = Math.min(170, W * 0.12);
  const nameW = api.measure(String(p.name), { size: nameSize, weight: 700 });
  const gap = s * 0.35;
  const slide = api.prog("name", 30, "out");
  const total = s + gap + nameW;
  const cx = api.lerp(W / 2, W / 2 - total / 2 + s / 2, slide);
  api.camera({ zoom: api.tween("lock", duration - ACT.lock, 1, 1.03, "smooth") });
  api.layer(1, () => {
    const spring = api.spring({ mass: 1, stiffness: 240, damping: 20 });
    mark(api, cx, H * 0.46, s, [api.prog(api.cue("lock") - 20, 20, spring), api.prog(api.cue("lock") - 14, 20, spring), 1], ink, accent);
    const nx = cx + s / 2 + gap;
    api.text(String(p.name), { x: nx, y: H * 0.46, size: nameSize, weight: 700, color: ink, opacity: slide, clip: { x: cx + s / 2 + gap * 0.5, y: 0, w: W, h: H }, id: "name" });
    say(p.tagline, { x: W / 2, y: H * 0.46 + s * 0.95, size: Math.min(48, W * 0.04), weight: 500, align: "center", color: ink, opacity: 0.7, reveal: { at: "tag", per: "word", stagger: 5, dur: 20 } });
  });
}
```
