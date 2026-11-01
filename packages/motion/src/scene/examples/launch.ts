/**
 * A demo scene: a prompt typed into an app window, a click, a result card
 * landing with its chart and a counter, then a hard cut to the line. One
 * grid (60 fps, 120 BPM: a beat is 30 frames) drives the picture and the
 * cues the sound design hits. Agents write scenes like this one for
 * create_scene_tool; the tests and scripts/scene.ts render it.
 */

import type { SceneApi } from "../kit.js";

export const title = "Launch film";
export const fps = 60;
const BEAT = 30;
const b = (bar: number, beat = 0, sub = 0): number => Math.round(((bar - 1) * 4 + beat) * BEAT + (sub * BEAT) / 4);

export const duration = b(4);

export const params = {
  prompt: "Cut a launch film from my product clips",
  result: "Launch film · 0:24",
  headline: "Edits with taste.",
  brand: "Zenvi",
};

export const cues = {
  type: { at: b(1, 1), kind: "type", until: b(1, 3, 2), rate: 30, weight: 0.2, x: 0.45, y: 0.42 },
  click: { at: b(2, 0, 2), kind: "click", weight: 0.35, x: 0.71, y: 0.42 },
  land: { at: b(2, 1), kind: "land", weight: 0.6, hit: 0.6, x: 0.5, y: 0.62 },
  count: { at: b(2, 2), kind: "tick", until: b(2, 3, 2), rate: 12, weight: 0.25, x: 0.62, y: 0.62 },
  cut: { at: b(3), kind: "impact", weight: 0.9, hit: 1, shake: 10, flash: 0.3, cut: true },
  line: { at: b(3, 0, 2), kind: "reveal", weight: 0.7 },
  brand: { at: b(3, 2), kind: "pop", weight: 0.4, y: 0.66 },
};

export function draw(ctx: CanvasRenderingContext2D, t: number, api: SceneApi): void {
  const { W, H, p, palette } = api;
  api.hitFx({ look: "clean", bloom: 0.15 });
  api.grain(0.05);
  if (t < api.cue("cut")) {
    api.gradient({ stops: [[0, "#F3F1EC"], [1, "#E4E1DA"]], radial: { cy: 0.35, r: 0.9 } });
    // A slow push the whole first act; the background moves less than the window (parallax).
    api.camera({ zoom: api.tween(0, api.cue("cut"), 1, 1.07, "smooth"), y: api.tween(0, api.cue("cut"), 0, -18, "smooth") });
    api.layer(0.35, () => {
      api.circle(W * 0.18, H * 0.2, 260, { fill: "rgba(255,90,54,0.10)" });
      api.circle(W * 0.86, H * 0.82, 340, { fill: "rgba(47,107,255,0.08)" });
    });
    api.layer(1, () => {
      const enter = api.prog(0, 24, "out");
      ctx.globalAlpha = enter;
      const win = api.ui.window({ x: W / 2 - 560, y: H * 0.2 + (1 - enter) * 60, w: 1120, h: 660, title: "Zenvi" });
      const field = { x: win.x + 48, y: win.y + 48, w: win.w - 96 - 180, h: 96 };
      api.ui.field({ ...field, text: api.typed(String(p.prompt), "type", { until: cues.type.until }), placeholder: "Describe the edit", caret: t < api.cue("click") });
      api.ui.button({ x: field.x + field.w + 20, y: field.y + 8, w: 160, h: 80, label: "Make", click: "click", fill: palette.accent });
      // The result lands on the beat after the click.
      const land = api.prog("land", 22, api.spring({ mass: 1, stiffness: 220, damping: 20 }));
      if (land > 0) {
        const card = api.ui.card({ x: win.x + 48, y: win.y + 200 + (1 - land) * 80, w: win.w - 96, h: 330, opacity: Math.min(1, land * 2) });
        api.text(String(p.result), { x: card.x + 40, y: card.y + 58, size: 40, weight: 650, id: "result", ui: true });
        api.ui.chart({ x: card.x + 40, y: card.y + 110, w: 520, h: 180, values: [0.35, 0.5, 0.42, 0.66, 0.58, 0.82, 0.95], grow: api.prog("land", 40) });
        api.ui.counter({ x: card.x + card.w - 48, y: card.y + 190, size: 120, weight: 700, align: "right", from: 0, to: 38, prefix: "+", suffix: "%", progress: api.prog("count", api.cue("cut") - api.cue("count") - 30, "smooth"), color: palette.accent });
        api.text("watch time", { x: card.x + card.w - 48, y: card.y + 270, size: 30, weight: 500, align: "right", color: palette.muted, id: "watch", ui: true });
      }
      // The pointer travels to the button and clicks on the cue.
      const travel = api.prog(api.cue("click") - 40, 36, "in-out");
      api.ui.cursor({ x: api.lerp(win.x + 700, field.x + field.w + 100, travel), y: api.lerp(win.y + 560, field.y + 52, travel), click: "click", opacity: api.prog(24, 12) });
    });
    return;
  }
  // Act 2: a hard cut to the line, words on the beat.
  ctx.fillStyle = "#0B0B0F";
  ctx.fillRect(0, 0, W, H);
  api.layer(1, () => {
    api.gradient({ stops: [[0, "rgba(255,90,54,0.22)"], [1, "rgba(255,90,54,0)"]], radial: { cy: 0.55, r: 0.6 } });
    api.text(String(p.headline), { x: W / 2, y: H * 0.46, size: 150, weight: 700, align: "center", color: "#F7F7F5", reveal: { at: "line", per: "word", stagger: 8, dur: 18 } });
    api.text(String(p.brand), { x: W / 2, y: H * 0.66, size: 48, weight: 600, align: "center", color: palette.accent, reveal: { at: "brand", dur: 16 } });
  });
}
