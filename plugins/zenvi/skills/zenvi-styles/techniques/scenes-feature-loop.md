---
id: scenes-feature-loop
kind: technique
summary: "A worked feature loop as one scene: the feature acts on the product's own UI and returns to frame 0, muted-first."
categories: [cinetic-feature-loop, cinetic-ui-walkthrough]
tools: [produce_video_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, review_render_tool, watch_render_tool]
pace: calm
mood: [calm, precise, seamless]
aspect: ["16:9", "1:1", "4:5", "9:16"]
pairs_with: [zenvi-scenes, cin-le-device-becomes-mark]
avoid_with: [kcut-strobe-cards, kcut-hit-fx]
needs: []
---

# Feature loop scene (worked example: Cadence "Find a time")

## What it is

A 10 s seamless loop written as one scene. Idea: one click finds the hour four people all have free.
Device: the accent slot; it is born in the button on the click, scans down the day (each busy block it
passes darkens: the reason it moves on), lands on 2:30 PM, collects four checks and one chip, then goes
back into the button so the last frame flows into the first. `produce_video_tool` drafts
`cinetic-feature-loop` and a `cinetic-ui-walkthrough` chapter from it; rebuild the UI as the product's own.

## Build it in Zenvi

1. Replace the calendar with the product's real screen (its labels, its data) and the slot with the
   feature's own object; keep the click -> act -> land -> answer -> reset arc.
2. Every moving value is a function of the cues and is back at its frame-0 value on the last frame (the
   cursor's rest spot, the camera's lean, the slot in the button): compare the sheet's first and last cells.
3. `update_scene_tool`, `render_scene_tool {"scene_id": "<id>", "motion_blur": 4}`; muted on a page: no music.

## Timing & taste

100 BPM at 60 fps (beat 36 f), 600 frames: click on beat 2, scan to beat 6, land, four checks a 16th
apart on beat 7, chip on beat 9, reset on beat 13. Three product strings, no headline. The window fills
the safe area less 4 % for the camera's lean.

## Sound

Muted first: the picture tells it. The cues keep their kinds (click, ticks, land, four pops, a reveal, a
swap), so `auto_sound_design_tool` makes a sound version from the same file.

## Common mistakes

A reset that jumps (a state not driven back to frame 0); a camera move that ends the loop off its start;
copy that explains what the UI already shows.

## The scene

```ts
// Feature loop: "Find a time" in Cadence, an invented calendar app. The story device is the accent slot:
// it leaves the button, scans the day, lands on the first hour all four people have free, and goes back
// into the button, so the last frame flows into the first. 100 BPM at 60 fps: a beat is 36 frames.
// Muted on a landing page: the picture tells it; the cues still mark every event for a sound version.
export const title = "Feature loop";
export const fps = 60;
const BEAT = 36;
export const duration = 600;

export const params = {
  app: "Cadence",
  day: "Thursday",
  button: "Find a time",
  found: "2:30 PM · all 4 free",
  people: ["Ana", "Ben", "Chen", "Dara"],
  // Busy hours per person (24 h clock, 9:00-17:00 on screen); the first hour they all have free is `slot`.
  busy: [
    [[9, 10.5], [11, 12], [13, 14.5], [15.5, 17]],
    [[9.5, 11], [12, 13.5], [16, 17]],
    [[9, 9.5], [10, 12.5], [13.5, 14.5], [15.5, 16.5]],
    [[10.5, 12], [12.5, 14], [15.5, 17]],
  ],
  slot: 14.5,
  paper: "#EEF1F5",
  ink: "#12161C",
  accent: "#2F6BFF",
};

export const cues = {
  click: { at: 2 * BEAT, kind: "click", weight: 0.35, x: 0.78, y: 0.2 },
  scan: { at: 2 * BEAT + 6, kind: "tick", until: 6 * BEAT, rate: 6, weight: 0.15 },
  land: { at: 6 * BEAT, kind: "land", weight: 0.5, hit: 0.35, flash: 0 },
  check1: { at: 7 * BEAT, kind: "pop", weight: 0.2 },
  check2: { at: 7 * BEAT + 9, kind: "pop", weight: 0.2 },
  check3: { at: 7 * BEAT + 18, kind: "pop", weight: 0.2 },
  check4: { at: 7 * BEAT + 27, kind: "pop", weight: 0.2 },
  chip: { at: 9 * BEAT, kind: "reveal", weight: 0.3 },
  reset: { at: 13 * BEAT, kind: "swap", weight: 0.2 },
};

const START = 9;
const END = 17;

export function draw(ctx: CanvasRenderingContext2D, t: number, api) {
  const { W, H, p, safe } = api;
  const ink = String(p.ink);
  const accent = String(p.accent);
  const people = p.people as string[];
  const busy = p.busy as number[][][];
  const slot = Number(p.slot);
  const ui = api.portrait ? 34 : 26;
  const fine = api.portrait ? 32 : 22;
  ctx.fillStyle = String(p.paper);
  ctx.fillRect(0, 0, W, H);
  api.gradient({ stops: [[0, "rgba(255,255,255,0.7)"], [1, "rgba(255,255,255,0)"]], radial: { cy: 0.2, r: 0.9 } });
  api.hitFx({ look: "clean", bloom: 0 });

  // One breath per loop: the camera leans in while the slot lands and is back at rest when the loop wraps.
  const lean = api.prog(5 * BEAT, 2 * BEAT, "in-out") * (1 - api.prog("reset", 2 * BEAT, "in-out"));
  api.camera({ zoom: 1 + 0.035 * lean, y: 14 * lean });

  // The window fills the title-safe area with room for the camera's lean (4 %).
  const winW = Math.min(1440, (W - safe.left - safe.right) / 1.04);
  const winH = Math.min(820, (H - safe.top - safe.bottom) / 1.04);
  const wx = (W - winW) / 2;
  const wy = (H - winH) / 2;
  api.layer(1, () => {
    const win = api.ui.window({ x: wx, y: wy, w: winW, h: winH, title: String(p.app) });
    const header = { x: win.x + 40, y: win.y + 28 };
    api.text(String(p.day), { x: header.x, y: header.y + 30, size: 44, weight: 700, baseline: "middle", color: ink, ui: true, id: "day" });
    const btn = { w: 250, h: 64, x: win.x + win.w - 40 - 250, y: header.y };
    // The slot: born in the button on the click, scanning down the day, landing, and going home on reset.
    const gridTop = win.y + 170;
    const gridBottom = win.y + win.h - 32;
    const labelW = 96;
    const colX = win.x + 40 + labelW;
    const colW = (win.w - 80 - labelW) / people.length;
    const hourH = (gridBottom - gridTop) / (END - START);
    const yOf = (hour: number): number => gridTop + (hour - START) * hourH;
    // Hours and the columns' heads.
    for (let h = START; h <= END; h += 2) api.text(`${h > 12 ? h - 12 : h}${h >= 12 ? " PM" : " AM"}`, { x: win.x + 40, y: yOf(h), size: fine, font: "mono", baseline: "middle", color: ink, opacity: 0.45, ui: true, id: `h${h}` });
    for (let h = START; h <= END; h++) api.line(colX, yOf(h), colX + colW * people.length, yOf(h), { stroke: "rgba(18,22,28,0.07)", lineWidth: 2 });
    const scan = api.prog("scan", api.cue("land") - api.cue("scan"), "in-out");
    const landed = api.prog("land", 24, api.spring({ mass: 1, stiffness: 240, damping: 20 }));
    const home = api.prog("reset", BEAT * 1.5, "in");
    const born = api.prog("click", 18, "out");
    const slotY = api.lerp(yOf(START), yOf(slot), scan);
    people.forEach((name, i) => {
      const cx = colX + i * colW;
      api.circle(cx + 30, gridTop - 34, 18, { fill: "rgba(18,22,28,0.10)" });
      api.text(name.slice(0, 1), { x: cx + 30, y: gridTop - 34, size: fine, weight: 700, align: "center", baseline: "middle", color: ink, ui: true, id: `initial${i}` });
      api.text(name, { x: cx + 58, y: gridTop - 34, size: ui, weight: 600, baseline: "middle", color: ink, ui: true, id: `name${i}` });
      for (const [a, b] of busy[i] ?? []) {
        // A block the scanning slot passes over darkens for a moment: it is the reason the slot moves on.
        const touched = scan > 0 && scan < 1 && slotY < yOf(b!) && slotY + hourH > yOf(a!) ? 1 : 0;
        api.rect(cx + 8, yOf(a!) + 3, colW - 16, yOf(b!) - yOf(a!) - 6, { fill: touched ? "rgba(18,22,28,0.18)" : "rgba(18,22,28,0.07)", radius: 12 });
        api.rect(cx + 8, yOf(a!) + 3, 6, yOf(b!) - yOf(a!) - 6, { fill: "rgba(18,22,28,0.22)", radius: 3 });
      }
      // Each person's check, one after another once the slot lands; cleared together on reset.
      const check = api.prog(`check${i + 1}`, 14, api.spring({ mass: 1, stiffness: 300, damping: 18 })) * (1 - api.prog("reset", 12, "in"));
      if (check > 0) {
        const r = 15 * check;
        const ccx = cx + colW - 30;
        api.circle(ccx, gridTop - 34, r, { fill: accent });
        api.path([[ccx - r * 0.45, gridTop - 34], [ccx - r * 0.1, gridTop - 34 + r * 0.38], [ccx + r * 0.5, gridTop - 34 - r * 0.35]], { stroke: "#FFFFFF", lineWidth: 4, cap: "round" });
      }
    });
    // The slot itself: a band across all four columns.
    if (born > 0 && home < 1) {
      const bandX = api.lerp(btn.x, colX, born);
      const bandW = api.lerp(btn.w, colW * people.length, born);
      const bandY = api.lerp(btn.y, slotY, born);
      const bandH = api.lerp(btn.h, hourH, born);
      const k = home;
      const x = api.lerp(bandX, btn.x, k);
      const y = api.lerp(bandY, btn.y, k);
      const w = api.lerp(bandW, btn.w, k);
      const h = api.lerp(bandH, btn.h, k);
      // The landing gives the band one firm press (the spring) before it rests.
      const press = landed > 0 && landed < 1 ? (1 - landed) * 10 : 0;
      api.rect(x - press, y - press / 2, w + 2 * press, h + press, { fill: accent, opacity: api.lerp(0.14, 0.2, Math.min(1, landed)), radius: 16 });
      api.rect(x - press, y - press / 2, w + 2 * press, h + press, { stroke: accent, lineWidth: 3, radius: 16 });
    }
    // The button sits on top: the slot leaves from it and returns into it.
    api.ui.button({ ...btn, label: String(p.button), click: "click", fill: accent, size: ui + 2 });
    // The answer, once everyone is checked: one chip in the slot.
    const chip = api.prog("chip", 22, "out") * (1 - api.prog(api.cue("reset") - 18, 18, "in"));
    if (chip > 0) {
      const cw = Math.min(colW * people.length - 48, 520);
      const cxm = colX + (colW * people.length) / 2;
      const cy = yOf(slot) + hourH / 2;
      api.rect(cxm - cw / 2, cy - 30 + (1 - chip) * 12, cw, 60, { fill: "#FFFFFF", radius: 30, opacity: chip, shadow: { blur: 18, y: 6, color: "rgba(18,22,28,0.12)" } });
      api.text(String(p.found), { x: cxm, y: cy + (1 - chip) * 12, size: ui, weight: 650, align: "center", baseline: "middle", color: accent, opacity: chip, ui: true, id: "found" });
    }
    // The pointer: from its rest spot to the button, clicks, and back to the same spot by the last frame.
    const rest = { x: win.x + win.w * 0.62, y: win.y + win.h * 0.42 };
    const go = api.prog(0, api.cue("click") - 4, "in-out");
    const back = api.prog(api.cue("reset") + BEAT, duration - api.cue("reset") - BEAT, "in-out");
    const aim = { x: btn.x + btn.w * 0.6, y: btn.y + btn.h * 0.6 };
    const out = { x: aim.x - 40, y: aim.y + 120 };
    const leave = api.prog(api.cue("click") + 12, BEAT * 2, "in-out");
    const cx = t < api.cue("reset") + BEAT ? api.lerp(api.lerp(rest.x, aim.x, go), out.x, leave) : api.lerp(out.x, rest.x, back);
    const cy = t < api.cue("reset") + BEAT ? api.lerp(api.lerp(rest.y, aim.y, go), out.y, leave) : api.lerp(out.y, rest.y, back);
    api.ui.cursor({ x: cx, y: cy, click: "click" });
  });
}
```
