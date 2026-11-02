---
id: scenes-logo-sting
kind: technique
summary: "A logo sting as one scene: a line draws itself into the mark, one tuned hit fills it, the name slides out and holds."
categories: [cinetic-logo-sting]
tools: [produce_video_tool, create_scene_tool, update_scene_tool, render_scene_tool, scene_cues_tool, auto_sound_design_tool, master_audio_tool, review_render_tool, watch_render_tool]
pace: medium
mood: [calm, premium, payoff]
aspect: ["16:9", "1:1", "9:16"]
pairs_with: [zenvi-scenes, cin-le-device-becomes-mark]
avoid_with: [kcut-strobe-cards, kcut-hit-fx]
needs: []
---

# Logo sting scene (starter: a monogram that builds itself)

## What it is

A 6 s sting: a line is already drawing on frame 0, closes into a rounded square on the hit, which fills
in the accent with the initial knocked out (one 7 % pop, the only bounce); the mark slides left and the
name follows out of it; the lockup holds 3.5 s, drifting. `produce_video_tool` drafts
`cinetic-logo-sting` from it with the request's name.

## Build it in Zenvi

1. A designed mark beats the monogram: draw the product's own primitive (a letter's stem and a dot, a
   fold, a flame) with `api.path(..., {draw})` and keep the three beats.
2. Params `name`, `accent`, `ink`, `paper`, `tagline`.
3. Transparent version for editors: `update_scene_tool` params `{"background": false}`, then
   `render_scene_tool {"scene_id": "<id>", "placement": "over_video"}` (ProRes 4444); the opaque one is
   `full_frame`.

## Timing & taste

120 BPM at 60 fps: draw beats 0-3, hit on beat 3, name on beat 4, tagline on beat 6, hold to beat 12.

## Sound

A soft whoosh under the drawing line, one tuned impact on the fill, a reveal under the name; nothing on
top of the hold.

## Common mistakes

Hit FX on a light paper (their vignette greys the corners); an empty frame 0; a second bounce.

## The scene

```ts
// Logo sting: the mark builds from its own primitives (a line that draws itself into a rounded square,
// filled on one tuned hit with the initial knocked out), then the name slides out of it and holds.
// 120 BPM at 60 fps: a beat is 30 frames. With background: false it renders transparent over video.
export const title = "Logo sting";
export const fps = 60;
const BEAT = 30;
export const duration = 12 * BEAT;

export const params = {
  name: "Wren",
  tagline: "",
  background: true,
  paper: "#F3F5F4",
  ink: "#15201B",
  accent: "#1F8A70",
};

export const cues = {
  draw: { at: BEAT, kind: "whoosh", weight: 0.25 },
  hit: { at: 3 * BEAT, kind: "impact", weight: 0.8 },
  name: { at: 4 * BEAT, kind: "reveal", weight: 0.4 },
  tag: { at: 6 * BEAT, kind: "reveal", weight: 0.2 },
};

export function draw(ctx: CanvasRenderingContext2D, t: number, api) {
  const { W, H, p } = api;
  const ink = String(p.ink);
  const accent = String(p.accent);
  const name = String(p.name);
  if (p.background !== false) {
    ctx.fillStyle = String(p.paper);
    ctx.fillRect(0, 0, W, H);
  }
  // The lockup (mark, gap, name) fits 84 % of the title-safe width (room for the 4 % push): a long name shrinks it all.
  const fit = Math.min(1, (0.84 * (W - api.safe.left - api.safe.right)) / (Math.min(W, H) * 0.26 * 1.3 + api.measure(name, { size: Math.min(W, H) * 0.26 * 0.78, weight: 700 })));
  const s = Math.min(W, H) * 0.26 * fit;
  const nameSize = s * 0.78;
  const gap = s * 0.3;
  const nameW = api.measure(name, { size: nameSize, weight: 700 });
  // The mark starts centred and slides left as the name follows it out (the lockup is centred as a whole).
  const slide = api.prog("name", 36, "out");
  const home = W / 2 - (s + gap + nameW) / 2 + s / 2;
  const cx = api.lerp(W / 2, home, slide);
  const cy = H / 2;
  api.camera({ zoom: api.tween(0, duration, 1.04, 1, "smooth") });
  api.layer(1, () => {
    // 1. A line draws itself into the square, already under way on frame 0.
    const trace = api.prog(-8, api.cue("hit") + 8, "in-out");
    // The hit gives the mark one firm pop (scale about its centre), the only bounce of the film.
    const pop = 1 + 0.07 * Math.sin(Math.PI * api.prog("hit", 16, "linear"));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -cy);
    if (trace > 0) api.rect(cx - s / 2, cy - s / 2, s, s, { stroke: accent, lineWidth: s * 0.06, radius: s * 0.28, draw: trace });
    // 2. On the hit it fills; the initial rises inside it, knocked out of the accent.
    const fill = api.prog("hit", 10, "out");
    if (fill > 0) {
      api.rect(cx - s / 2, cy - s / 2, s, s, { fill: accent, radius: s * 0.28, opacity: fill });
      const rise = api.prog("hit", 24, api.spring({ mass: 1, stiffness: 260, damping: 22 }));
      api.text(name.slice(0, 1).toUpperCase(), { x: cx, y: cy + (1 - rise) * s * 0.12, size: s * 0.62, weight: 750, align: "center", color: String(p.paper), opacity: Math.min(1, rise * 1.4), clip: { x: cx - s / 2, y: cy - s / 2, w: s, h: s }, id: "initial" });
    }
    ctx.restore();
    // 3. The name comes out from behind the mark, then holds and drifts with the camera.
    if (slide > 0) {
      // It travels a gap's width into its place, never past where the lockup ends.
      api.text(name, { x: home + s / 2 + gap - (1 - slide) * gap, y: cy, size: nameSize, weight: 700, color: ink, opacity: slide, clip: { x: cx + s / 2 + 4, y: 0, w: W, h: H }, id: "name" });
    }
    if (String(p.tagline)) api.text(String(p.tagline), { x: W / 2, y: cy + s * 0.95, size: Math.max(32, s * 0.2), weight: 500, align: "center", color: ink, opacity: 0.65, reveal: { at: "tag", per: "word", stagger: 5, dur: 20 } });
  });
}
```
