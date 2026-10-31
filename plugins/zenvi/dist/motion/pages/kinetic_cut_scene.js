(() => {
  // packages/motion/src/tokens.ts
  var PALETTES = {
    light: { paper: "#F7F7F5", ink: "#0B0B0F", surface: "#FFFFFF", muted: "#6E6E78", line: "rgba(11,11,15,0.10)", accent: "#FF5A36", secondary: "#2F6BFF", glass: "rgba(255,255,255,0.55)", dark: false },
    dark: { paper: "#0B0B0F", ink: "#F7F7F5", surface: "#17171D", muted: "#9696A2", line: "rgba(247,247,245,0.14)", accent: "#FF5A36", secondary: "#2F6BFF", glass: "rgba(23,23,29,0.55)", dark: true },
    cream: { paper: "#F2ECE1", ink: "#1C1915", surface: "#FBF8F2", muted: "#7A7166", line: "rgba(28,25,21,0.12)", accent: "#FF6A1A", secondary: "#2E5E4E", glass: "rgba(251,248,242,0.6)", dark: false },
    forest: { paper: "#0D2620", ink: "#ECF3EF", surface: "#143229", muted: "#8FB3A5", line: "rgba(236,243,239,0.14)", accent: "#6BE39B", secondary: "#F2C14E", glass: "rgba(20,50,41,0.5)", dark: true },
    mono: { paper: "#050506", ink: "#FFFFFF", surface: "#111114", muted: "#8A8A93", line: "rgba(255,255,255,0.22)", accent: "#D7FF3A", secondary: "#FFFFFF", glass: "rgba(17,17,20,0.6)", dark: true },
    sky: { paper: "#EAF1FB", ink: "#0E1726", surface: "#FFFFFF", muted: "#5D6B80", line: "rgba(14,23,38,0.10)", accent: "#3D7BFF", secondary: "#FF7AB6", glass: "rgba(255,255,255,0.45)", dark: false },
    ember: { paper: "#140D09", ink: "#FFF3E6", surface: "#22160F", muted: "#B39883", line: "rgba(255,243,230,0.14)", accent: "#FF8A1F", secondary: "#FFD25E", glass: "rgba(34,22,15,0.55)", dark: true },
    night: { paper: "#06061A", ink: "#EEF0FF", surface: "#12122E", muted: "#8E90B8", line: "rgba(238,240,255,0.14)", accent: "#6C5CFF", secondary: "#FFC23D", glass: "rgba(18,18,46,0.5)", dark: true },
    tide: { paper: "#0A2A33", ink: "#E8F6F5", surface: "#113A45", muted: "#86B5B4", line: "rgba(232,246,245,0.14)", accent: "#FF6A4D", secondary: "#7FE0D2", glass: "rgba(17,58,69,0.5)", dark: true },
    cherry: { paper: "#1A0507", ink: "#FFF1F0", surface: "#2A0A0E", muted: "#C79A9E", line: "rgba(255,241,240,0.16)", accent: "#F2364A", secondary: "#FFB4BC", glass: "rgba(42,10,14,0.5)", dark: true },
    porcelain: { paper: "#E7EBEF", ink: "#101820", surface: "#FFFFFF", muted: "#5F6B78", line: "rgba(16,24,32,0.10)", accent: "#E5484D", secondary: "#2F6BFF", glass: "rgba(255,255,255,0.5)", dark: false },
    lilac: { paper: "#ECE8F6", ink: "#17132A", surface: "#FFFFFF", muted: "#6B6585", line: "rgba(23,19,42,0.10)", accent: "#7A5CFF", secondary: "#FF8FB1", glass: "rgba(255,255,255,0.5)", dark: false },
    cobalt: { paper: "#1838D8", ink: "#F4F6FF", surface: "#2546E4", muted: "#AEBBF7", line: "rgba(244,246,255,0.2)", accent: "#FFD23F", secondary: "#FF8FB1", glass: "rgba(24,56,216,0.5)", dark: true },
    sage: { paper: "#D8E0D4", ink: "#14201A", surface: "#F3F6F0", muted: "#5B6B61", line: "rgba(20,32,26,0.14)", accent: "#E2502C", secondary: "#2C5BD8", glass: "rgba(243,246,240,0.55)", dark: false },
    graphite: { paper: "#26282C", ink: "#F1F0EC", surface: "#313338", muted: "#9A9CA3", line: "rgba(241,240,236,0.14)", accent: "#FF9F43", secondary: "#7FB2FF", glass: "rgba(38,40,44,0.6)", dark: true }
  };
  var PALETTE_NAMES = Object.keys(PALETTES);
  var FONT_STACKS = {
    sans: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    serif: "'Instrument Serif', Georgia, serif",
    mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
    display: "'Anton', 'Inter', Impact, sans-serif"
  };
  var FONT_ROLES = Object.keys(FONT_STACKS);
  var FONT_FACES = [
    { family: "Inter", file: "Inter-Variable.woff2", weight: "100 900", style: "normal" },
    { family: "Inter", file: "Inter-Variable-Italic.woff2", weight: "100 900", style: "italic" },
    { family: "Instrument Serif", file: "InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
    { family: "Instrument Serif", file: "InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
    { family: "JetBrains Mono", file: "JetBrainsMono-Variable.woff2", weight: "100 800", style: "normal" },
    { family: "Anton", file: "Anton-Regular.woff2", weight: "400", style: "normal" }
  ];
  function withAccent(palette, accent) {
    return accent ? { ...palette, accent } : palette;
  }

  // packages/motion/src/runtime/rng.ts
  function hashInts(...values) {
    let h = 2654435769;
    for (const v of values) {
      h = Math.imul(h ^ (v | 0), 2246822507);
      h ^= h >>> 13;
      h = Math.imul(h, 3266489909);
      h ^= h >>> 16;
    }
    return h >>> 0;
  }
  function random01(seed, ...values) {
    return hashInts(seed, ...values) / 4294967296;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // packages/motion/src/runtime/kinetic.ts
  var HIT_LOOKS = {
    clean: { punch: 0.035, chroma: 0, chromaHit: 6, flash: 0.15, vignette: 0.25 },
    punchy: { punch: 0.05, chroma: 1.6, chromaHit: 13, flash: 0.3, vignette: 0.34 },
    wild: { punch: 0.08, chroma: 3, chromaHit: 22, flash: 0.45, vignette: 0.4 }
  };
  var HIT_TAIL = 1.2;
  function hitEnvelope(hits, t, decay, weight = (h) => h.strength) {
    let v = 0;
    for (const h of hits) {
      const u = t - h.t;
      if (u >= 0 && u < HIT_TAIL) v += weight(h) * Math.exp(-decay * u);
    }
    return v;
  }
  var flashWeight = (h) => h.strength * (h.flash ?? 1);
  function hitCamera(hits, t, punch) {
    let x = 0;
    let y = 0;
    for (const h of hits) {
      const u = t - h.t;
      if (!h.shake || u < 0 || u >= 1) continue;
      const d = h.shake * Math.exp(-8 * u);
      x += d * Math.sin(u * 64 + h.t);
      y += d * Math.cos(u * 57 + h.t * 2);
    }
    return { zoom: 1 + punch * hitEnvelope(hits, t, 7), x, y };
  }
  function hitFinish(hits, t, look, bloom) {
    return {
      chroma: (look.chroma + look.chromaHit * hitEnvelope(hits, t, 9)) / 960,
      flash: Math.min(1, look.flash * hitEnvelope(hits, t, 24, flashWeight)),
      bloom: Math.min(1, bloom * 0.72 + 0.22 * hitEnvelope(hits, t, 10))
    };
  }
  function subframeTimes(t, samples, shutter, fps, from, to) {
    const n = Math.max(1, Math.round(samples));
    const out = [];
    for (let k = 0; k < n; k += 1) out.push(Math.min(to - 1e-4, Math.max(from, t + ((k + 0.5) / n - 0.5) * (shutter / fps))));
    return out;
  }
  var clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  var prog = (t, start, dur) => clamp01((t - start) / dur);
  var expoOut = (x) => x >= 1 ? 1 : x <= 0 ? 0 : 1 - 2 ** (-10 * x);
  var cubicIn = (x) => x * x * x;
  var cubicOut = (x) => 1 - (1 - x) ** 3;
  var cubicInOut = (x) => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  var springIn = (x, damp = 7, freq = 9) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-damp * x) * Math.cos(freq * x);
  var stamp = (u, d = 0.28, k = 1.2) => 1 + k * (1 - expoOut(prog(u, 0, d)));
  var stagger = (u, i, gap = 0.05, d = 0.4, ease = expoOut) => ease(prog(u, i * gap, d));
  function noise1(x, seed = 0) {
    const h = (n) => {
      const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const i = Math.floor(x);
    const f = x - i;
    const k = f * f * (3 - 2 * f);
    return (h(i) + (h(i + 1) - h(i)) * k) * 2 - 1;
  }
  function polylineTo(pts, p) {
    if (pts.length < 2 || p <= 0) return { pts: pts.slice(0, 1), head: pts[0] ?? [0, 0] };
    const lens = [0];
    for (let i = 1; i < pts.length; i += 1) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const end = lens[lens.length - 1] * clamp01(p);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i += 1) {
      if (lens[i] <= end) {
        out.push(pts[i]);
        continue;
      }
      const f = (end - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]);
      break;
    }
    return { pts: out, head: out[out.length - 1] };
  }
  function drawOn(g, pts, p, color, width = 3, alpha = 1) {
    const { pts: part, head } = polylineTo(pts, p);
    if (part.length < 2) return head;
    g.save();
    g.globalAlpha *= alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(part[0][0], part[0][1]);
    for (const q of part.slice(1)) g.lineTo(q[0], q[1]);
    g.stroke();
    g.restore();
    return head;
  }
  function shapeParticles(mask, side, count, seed) {
    const inside = [];
    for (let k = 0; k < side * side; k += 1) if (mask[k]) inside.push(k);
    const r = mulberry32(seed);
    const out = [];
    for (let i = 0; i < count && inside.length > 0; i += 1) {
      const k = inside[Math.floor(r() * inside.length)];
      const px = (k % side + r()) / side * 2 - 1;
      const py = (Math.floor(k / side) + r()) / side * 2 - 1;
      out.push({ angle: Math.atan2(py, px), radius: Math.hypot(px, py), startRadius: 4 + r() * 7, delay: r() * 0.42, pick: r(), size: 2 + r() * 3 });
    }
    return out;
  }
  function shapeMask(doc, draw, side = 180) {
    const c = doc.createElement("canvas");
    c.width = side;
    c.height = side;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.fillStyle = "#000";
    g.fillRect(0, 0, side, side);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    draw(g, side);
    const data = g.getImageData(0, 0, side, side).data;
    const out = [];
    for (let k = 0; k < side * side; k += 1) out.push(data[k * 4] > 127);
    return out;
  }
  function assembleAt(p, u, R, spin = 0) {
    const a = prog(u - p.delay, 0, 0.95);
    const e = expoOut(a);
    const rad = p.startRadius + (p.radius - p.startRadius) * e;
    const ang = p.angle + spin + (1 - e) * (2.4 + p.pick);
    return { x: Math.cos(ang) * rad * R, y: Math.sin(ang) * rad * R, settled: a, size: p.size * (1 + 2.5 * (1 - e)) };
  }
  function finishBuffers(doc, w, h, vignette) {
    const mk = (cw, ch) => Object.assign(doc.createElement("canvas"), { width: cw, height: ch });
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    const vig = mk(w, h);
    const g = vig.getContext("2d");
    if (g) {
      const d = Math.hypot(w, h) / 2;
      const gr = g.createRadialGradient(w / 2, h / 2, d * 0.45, w / 2, h / 2, d * 1.05);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, `rgba(0,0,0,${vignette})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
    return { small: [mk(bw, bh), mk(bw, bh), mk(bw, bh)], channels: [mk(w, h), mk(w, h), mk(w, h)], vignette: vig };
  }
  function applyFinish(out, src, buf, f) {
    const { width: W, height: H } = src;
    const [b1, b2, b3] = buf.small;
    const bw = b1.width;
    const bh = b1.height;
    const sg = src.getContext("2d");
    if (f.bloom > 0.01) {
      b1.getContext("2d").drawImage(src, 0, 0, bw, bh);
      const c2 = b2.getContext("2d");
      c2.globalCompositeOperation = "copy";
      c2.drawImage(b1, 0, 0);
      c2.globalCompositeOperation = "multiply";
      c2.drawImage(b1, 0, 0);
      const c3 = b3.getContext("2d");
      c3.globalCompositeOperation = "copy";
      c3.filter = "blur(8px)";
      c3.drawImage(b2, 0, 0);
      c3.filter = "none";
      sg.globalCompositeOperation = "screen";
      sg.globalAlpha = clamp01(f.bloom);
      sg.drawImage(b3, 0, 0, W, H);
      sg.globalAlpha = clamp01(f.bloom * 0.16);
      sg.drawImage(b3, -W * 0.6, H * 0.3, W * 2.2, H * 0.4);
      sg.globalCompositeOperation = "source-over";
      sg.globalAlpha = 1;
    }
    out.globalCompositeOperation = "source-over";
    out.globalAlpha = 1;
    const k = f.chroma;
    if (k > 0) {
      const tint = (cv, col) => {
        const c = cv.getContext("2d");
        c.globalCompositeOperation = "copy";
        c.drawImage(src, 0, 0);
        c.globalCompositeOperation = "multiply";
        c.fillStyle = col;
        c.fillRect(0, 0, W, H);
      };
      const [cr, cg, cb] = buf.channels;
      tint(cr, "#f00");
      tint(cg, "#0f0");
      tint(cb, "#00f");
      out.fillStyle = "#000";
      out.fillRect(0, 0, W, H);
      out.globalCompositeOperation = "lighter";
      out.drawImage(cr, -W * k, -H * k, W * (1 + 2 * k), H * (1 + 2 * k));
      out.drawImage(cg, -W * k / 2, -H * k / 2, W * (1 + k), H * (1 + k));
      out.drawImage(cb, 0, 0);
    } else out.drawImage(src, 0, 0);
    if (f.flash > 4e-3) {
      out.globalCompositeOperation = "lighter";
      out.globalAlpha = clamp01(f.flash);
      out.fillStyle = f.flashColor ?? "rgb(255,236,224)";
      out.fillRect(0, 0, W, H);
      out.globalAlpha = 1;
    }
    out.globalCompositeOperation = "source-over";
    out.globalAlpha = f.lightGround ? 0.4 : 1;
    out.drawImage(buf.vignette, 0, 0);
    out.globalAlpha = 1;
  }

  // packages/motion/src/blocks/kinetic_cut_scene/shots.ts
  var ENTRANCES = ["slam", "type", "assemble", "mask", "flip", "stretch", "drop", "count", "strobe", "none"];
  var LAYOUTS = ["center", "left", "right", "bleed", "top", "bottom", "diagonal", "space", "split"];
  var GROUNDS = ["dark", "light", "accent", "secondary"];
  var LAYERS = ["scope", "routes", "rings", "rays", "grid", "orbit", "bars", "tunnel", "blobs", "marquee", "dial", "collapse"];
  var has = (list, v) => list.includes(v);
  function parseShot(line) {
    const [head = "", ...rest] = line.split("|");
    const sub = rest.join("|").trim();
    const words = head.trim().split(/\s+/).filter(Boolean);
    const spec = { beats: 2, entrance: "slam", lines: [], sub: "", layout: "center", ground: "dark", layers: [], climax: false };
    const text = [];
    let i = 0;
    const beats = /^(\d+(?:\.\d+)?)b?$/i.exec(words[0] ?? "");
    if (beats) {
      spec.beats = Number(beats[1]);
      i = 1;
    }
    const entrance = (words[i] ?? "").toLowerCase();
    if (has(ENTRANCES, entrance)) {
      spec.entrance = entrance;
      i += 1;
    }
    const subWords = [];
    const tokens = [...words.slice(i).map((w) => ({ w, sub: false })), ...sub.split(/\s+/).filter(Boolean).map((w) => ({ w, sub: true }))];
    for (const { w, sub: inSub } of tokens) {
      const low = w.toLowerCase();
      if (w === "!") spec.climax = true;
      else if (low.startsWith("@") && w.length > 1) {
        if (!has(LAYOUTS, low.slice(1))) return `unknown layout ${w} (${LAYOUTS.map((l) => `@${l}`).join(", ")})`;
        spec.layout = low.slice(1);
      } else if (low.startsWith("#") && w.length > 1 && has(GROUNDS, low.slice(1))) spec.ground = low.slice(1);
      else if (low.startsWith("+") && w.length > 1) {
        if (!has(LAYERS, low.slice(1))) return `unknown layer ${w} (${LAYERS.map((l) => `+${l}`).join(", ")})`;
        if (!spec.layers.includes(low.slice(1))) spec.layers.push(low.slice(1));
      } else (inSub ? subWords : text).push(w);
    }
    spec.lines = text.join(" ").split(/\s+\/\s+/).map((l) => l.trim()).filter(Boolean);
    spec.sub = subWords.join(" ");
    if (!(spec.beats > 0 && spec.beats <= 32)) return `beats must be 0-32, got ${spec.beats}`;
    if (spec.lines.length === 0 && spec.entrance !== "none") return `shot "${line}" has no text (use the entrance none for a picture-only shot)`;
    return spec;
  }
  function scheduleShots(specs, bpm, seconds) {
    const beat = 60 / bpm;
    const out = [];
    let t = 0;
    for (const spec of specs) {
      if (t >= seconds - 0.05) break;
      const end = Math.min(seconds, t + spec.beats * beat);
      out.push({ ...spec, index: out.length, start: t, end });
      t = end;
    }
    const last = out[out.length - 1];
    if (last) last.end = seconds;
    return out;
  }
  function strobeStep(shot, bpm) {
    const words = shot.lines.join(" ").split(/\s+/).filter(Boolean).length;
    const half = 30 / bpm;
    return Math.max(half, Math.min(60 / bpm, (shot.end - shot.start) / Math.max(1, words)));
  }
  var FLASH_GAP = 1 / 3;
  function shotHits(shots, bpm, scale = 1) {
    const hits = [];
    for (const shot of shots) {
      hits.push(shot.climax ? { t: shot.start, strength: 1.35, shake: 20 * scale } : { t: shot.start, strength: 1, ...shot.entrance === "slam" ? { shake: 6 * scale } : {} });
      if (shot.entrance === "strobe") {
        const step = strobeStep(shot, bpm);
        for (let t = shot.start + step; t < shot.end - 0.05; t += step) hits.push({ t, strength: 0.55 });
      }
    }
    const flashes = [];
    for (const h of [...hits].sort((a, b) => b.strength - a.strength || a.t - b.t)) {
      if (flashes.some((t) => Math.abs(t - h.t) < FLASH_GAP - 1e-6)) h.flash = 0;
      else flashes.push(h.t);
    }
    return hits;
  }
  function typingSeconds(shot) {
    return Math.min((shot.end - shot.start) * 0.6, Math.max(0.25, shot.lines.join(" ").length / 22));
  }
  function shotCues(shots, bpm) {
    const cues = [];
    for (const shot of shots) {
      const u = shot.start;
      const len = shot.end - shot.start;
      const cut = shot.entrance === "stretch" || shot.entrance === "flip" || shot.layers.includes("rays") ? "whoosh" : "impact";
      cues.push({ t: u, kind: cut, weight: shot.climax ? 1 : shot.entrance === "slam" ? 0.8 : 0.6 });
      if (shot.entrance === "type") cues.push({ t: u + 0.05, kind: "type", weight: 0.25, until: u + 0.05 + typingSeconds(shot), rate: 18 });
      if (shot.entrance === "count") cues.push({ t: u + 0.06, kind: "tick", weight: 0.3, until: u + 0.06 + len * 0.7, rate: 14 });
      if (shot.entrance === "assemble" && len > 1.1) cues.push({ t: u + 1, kind: "reveal", weight: 0.7 });
      if (shot.entrance === "strobe") {
        const step = strobeStep(shot, bpm);
        for (let t = u + step; t < shot.end - 0.05; t += step) cues.push({ t, kind: "swap", weight: 0.45 });
      }
      if (shot.layers.includes("rings")) cues.push({ t: u + 0.02, kind: "burst", weight: 0.5 });
    }
    return cues.sort((a, b) => a.t - b.t);
  }

  // packages/motion/src/blocks/kinetic_cut_scene/draw.ts
  var TAU = Math.PI * 2;
  function groundBloom(ground) {
    return ground === "dark" ? 0.5 : ground === "light" ? 0.08 : 0.13;
  }
  function layoutBox(sc, shot) {
    const { W, H } = sc;
    const m = Math.min(W, H);
    const base = { cx: W / 2, cy: H / 2, maxW: W * 0.84, maxSize: m * 0.36, maxH: H * 0.62, align: "center", rot: 0, rx: W / 2, ry: H / 2, rr: m * 0.42 };
    let layout = shot.layout;
    if (sc.portrait && layout === "left") layout = "top";
    if (sc.portrait && layout === "right") layout = "bottom";
    switch (layout) {
      case "left":
        return { ...base, cx: W * 0.3, maxW: W * 0.46, rx: W * 0.73, rr: m * 0.34 };
      case "right":
        return { ...base, cx: W * 0.7, maxW: W * 0.46, rx: W * 0.27, rr: m * 0.34 };
      case "top":
        return { ...base, cy: H * 0.3, maxSize: m * 0.3, ry: H * 0.7, rr: m * 0.3 };
      case "bottom":
        return { ...base, cy: H * 0.72, maxSize: m * 0.3, ry: H * 0.32, rr: m * 0.3 };
      case "bleed":
        return { ...base, maxW: W * 1.32, maxSize: m * 0.82, maxH: H * 0.86 };
      case "diagonal":
        return { ...base, maxW: Math.hypot(W, H) * 0.62, rot: -0.21 };
      case "space":
        return { ...base, cx: W * 0.1, cy: H * 0.82, maxW: W * 0.5, maxSize: m * 0.075, align: "left", rx: W * 0.66, ry: H * 0.4, rr: m * 0.2 };
      default:
        return base;
    }
  }
  var fontOf = (sc, size) => `${sc.weight} ${size.toFixed(1)}px ${sc.font}`;
  function fitSize(g, sc, lines, maxW, maxSize, maxH = Infinity) {
    g.font = fontOf(sc, 100);
    const widest = Math.max(1, ...lines.map((l) => g.measureText(l).width));
    const byLines = maxSize * (lines.length > 1 ? 1.6 / (lines.length + 0.6) : 1);
    return Math.max(8, Math.min(byLines, maxH / (lines.length * 0.98), maxW / widest * 100));
  }
  function glyphs(g, line, align) {
    const gl = [];
    let x = 0;
    for (const ch of line) {
      const w = g.measureText(ch).width;
      gl.push({ ch, x, w });
      x += w;
    }
    const off = align === "left" ? 0 : align === "right" ? -x : -x / 2;
    for (const q of gl) q.x += off;
    return { gl, w: x };
  }
  function letters(g, line, x, base, align, color, fn, stroke = 0) {
    const { gl } = glyphs(g, line, align);
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    gl.forEach((q, j) => {
      const o = fn(j, gl.length);
      if (o.al !== void 0 && o.al <= 3e-3) return;
      g.save();
      g.translate(x + q.x + q.w / 2 + (o.dx ?? 0), base + (o.dy ?? 0));
      if (o.rot) g.rotate(o.rot);
      const s = o.s ?? 1;
      g.scale(Math.max(1e-3, (o.sx ?? 1) * s), Math.max(1e-3, (o.sy ?? 1) * s));
      g.globalAlpha *= o.al ?? 1;
      if (stroke > 0) {
        g.strokeStyle = o.color ?? color;
        g.lineWidth = stroke;
        g.lineJoin = "round";
        g.strokeText(q.ch, 0, 0);
      } else {
        g.fillStyle = o.color ?? color;
        g.fillText(q.ch, 0, 0);
      }
      g.restore();
    });
  }
  function baselines(n, size, cy) {
    const lh = size * 0.98;
    const top = cy - (n - 1) * lh / 2 + size * 0.36;
    return Array.from({ length: n }, (_, i) => top + i * lh);
  }
  function fill(g, sc, color) {
    g.fillStyle = color;
    g.fillRect(-sc.W * 0.25, -sc.H * 0.25, sc.W * 1.5, sc.H * 1.5);
  }
  function groundAt(sc, shot, u) {
    if (shot.entrance !== "strobe") return shot.ground;
    const step = strobeStep(shot, sc.bpm);
    if (step < 1 / 3) return shot.ground;
    const order = shot.ground === "light" ? ["light", "dark", "accent"] : shot.ground === "accent" ? ["accent", "dark", "light"] : ["dark", "light", "accent"];
    return order[Math.floor(u / step) % order.length];
  }
  function drawShot(g, sc, shot, u, uf = u) {
    const len = shot.end - shot.start;
    const ground = groundAt(sc, shot, uf);
    const box = layoutBox(sc, shot);
    const ink = sc.inks[ground];
    fill(g, sc, sc.colors[ground]);
    g.save();
    const dir = shot.index % 2 === 0 ? 1 : -1;
    const creep = 1 + 0.08 * (u / Math.max(0.5, len));
    g.translate(sc.W / 2 + dir * 36 * sc.s * (u / Math.max(0.5, len)), sc.H / 2);
    g.rotate(dir * 6e-3 * u);
    g.scale(creep, creep);
    g.translate(-sc.W / 2, -sc.H / 2);
    if (shot.layers.includes("collapse")) {
      const q = cubicIn(prog(u, len - 0.3, 0.28));
      if (q > 0) {
        g.translate(sc.W / 2, sc.H / 2);
        g.scale(1 - q * 0.15, Math.max(4e-3, 1 - q));
        g.translate(-sc.W / 2, -sc.H / 2);
      }
    }
    if (shot.layout === "split") drawSplit(g, sc, shot, u, uf, ground);
    for (const layer of shot.layers) drawLayer(g, sc, shot, u, layer, box, ground);
    if (shot.layout !== "split") drawSub(g, sc, shot, u, box, ink, drawText(g, sc, shot, u, uf, box, ink, ground));
    g.restore();
    if (shot.layers.includes("collapse")) {
      const q = cubicIn(prog(u, len - 0.3, 0.28));
      if (q > 0.6) {
        g.fillStyle = sc.inks[ground];
        g.globalAlpha = (q - 0.6) / 0.4;
        g.fillRect(-sc.W * 0.2, sc.H / 2 - 2 * sc.s, sc.W * 1.4, 4 * sc.s);
        g.globalAlpha = 1;
      }
    }
  }
  function drawSplit(g, sc, shot, u, uf, ground) {
    const other = ground === "light" ? "dark" : "light";
    const open = expoOut(prog(u, 0, 0.35));
    const box = layoutBox(sc, { ...shot, layout: "center" });
    g.save();
    g.beginPath();
    if (sc.portrait) g.rect(-sc.W, sc.H / 2 + (1 - open) * sc.H, sc.W * 3, sc.H * 2);
    else g.rect(sc.W / 2 + (1 - open) * sc.W, -sc.H, sc.W * 2, sc.H * 3);
    g.clip();
    fill(g, sc, sc.colors[other]);
    g.restore();
    for (const [side, inkOf] of [[0, ground], [1, other]]) {
      g.save();
      g.beginPath();
      if (sc.portrait) g.rect(-sc.W, side === 0 ? -sc.H : sc.H / 2 + (1 - open) * sc.H, sc.W * 3, side === 0 ? sc.H * 1.5 + (1 - open) * sc.H : sc.H * 2);
      else g.rect(side === 0 ? -sc.W : sc.W / 2 + (1 - open) * sc.W, -sc.H, side === 0 ? sc.W * 1.5 + (1 - open) * sc.W : sc.W * 2, sc.H * 3);
      g.clip();
      drawSub(g, sc, shot, u, box, sc.inks[inkOf], drawText(g, sc, shot, u, uf, box, sc.inks[inkOf], inkOf));
      g.restore();
    }
  }
  function drawText(g, sc, shot, u, uf, box, ink, ground) {
    if (shot.entrance === "none" || shot.lines.length === 0) return { top: box.cy, bottom: box.cy };
    const len = shot.end - shot.start;
    g.save();
    g.translate(box.cx, box.cy);
    if (box.rot) g.rotate(box.rot);
    g.translate(-box.cx, -box.cy);
    const lines = shot.entrance === "strobe" ? [strobeWord(sc, shot, uf)] : shot.entrance === "count" ? [countText(shot.lines.join(" "), uf, len)] : shot.lines;
    const sizing = shot.entrance === "count" ? [shot.lines.join(" ")] : lines;
    const size = fitSize(g, sc, sizing, box.maxW, box.maxSize, box.maxH);
    g.font = fontOf(sc, size);
    const bases = baselines(lines.length, size, box.cy);
    const lineAt = (i) => bases[i];
    const accent = ground === "accent" ? ink : sc.accent;
    switch (shot.entrance) {
      case "slam": {
        const echo = 1 - expoOut(prog(u, 0.05, 0.55));
        lines.forEach((line, i) => {
          const off = i * 0.12;
          if (echo > 0.01)
            for (let k = 1; k <= 3; k += 1) {
              g.save();
              g.globalAlpha = echo * (0.5 - k * 0.12);
              g.translate(box.cx, lineAt(i) - size * 0.36);
              const e = 1 + k * 0.09 * (1 - echo * 0.5);
              g.scale(e, e);
              g.translate(-box.cx, -(lineAt(i) - size * 0.36));
              letters(g, line, box.cx, lineAt(i), box.align, accent, () => ({}), Math.max(2, size * 0.012));
              g.restore();
            }
          letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => ({ s: stamp(u - off - j * 0.05, 0.3, 1.1), al: u >= off + j * 0.05 ? 1 : 0 }));
        });
        break;
      }
      case "type": {
        const dur = typingSeconds(shot);
        const total = lines.reduce((n, l) => n + [...l].length, 0);
        let left = Math.floor(clamp01((uf - 0.05) / dur) * total + 0.01);
        let caret = null;
        lines.forEach((line, i) => {
          const chars = [...line];
          const shown = chars.slice(0, Math.max(0, Math.min(chars.length, left))).join("");
          left -= chars.length;
          if (!shown && caret) return;
          const { w } = glyphs(g, line, box.align);
          const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - w : box.cx - w / 2;
          g.textAlign = "left";
          g.fillStyle = ink;
          g.fillText(shown, x0, lineAt(i));
          caret = [x0 + g.measureText(shown).width, lineAt(i)];
        });
        const c = caret;
        if (c && (uf < 0.05 + dur || Math.floor(uf * 4) % 2 === 0)) {
          g.fillStyle = accent;
          g.fillRect(c[0] + size * 0.05, c[1] - size * 0.74, size * 0.09, size * 0.86);
        }
        break;
      }
      case "assemble": {
        const pts = sc.particles.get(shot.index) ?? [];
        const solid = cubicOut(prog(u, 0.95, 0.6));
        const R = Math.min(box.maxW, sc.W) / 2;
        g.fillStyle = ink;
        for (const p of pts) {
          const at = assembleAt(p, u, R, 0);
          g.globalAlpha = (1 - solid * 0.75) * (at.settled > 0 ? 0.9 : 0);
          g.fillStyle = p.pick < 0.22 ? accent : ink;
          const px = at.size * 1.6 * sc.s;
          g.fillRect(box.cx + at.x - px / 2, box.cy + at.y - px / 2, px, px);
        }
        g.globalAlpha = solid;
        lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({})));
        g.globalAlpha = 1;
        break;
      }
      case "mask": {
        const e = expoOut(prog(u, 0.04, 0.5));
        const widest = Math.max(...lines.map((l) => glyphs(g, l, box.align).w));
        const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - widest : box.cx - widest / 2;
        const top = lineAt(0) - size * 0.9;
        const h = lineAt(lines.length - 1) - top + size * 0.25;
        g.save();
        g.beginPath();
        g.rect(x0 - size * 0.1, top, (widest + size * 0.2) * e, h);
        g.clip();
        lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({ dy: (1 - e) * size * 0.4 })));
        g.restore();
        const bar = 1 - cubicIn(prog(u, 0.4, 0.3));
        if (bar > 0) {
          g.fillStyle = accent;
          g.fillRect(x0 - size * 0.1 + (widest + size * 0.2) * e - size * 0.12, top, size * 0.12 * bar, h);
        }
        break;
      }
      case "flip":
        lines.forEach(
          (line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => {
            const e = stagger(u - i * 0.1, j, 0.035, 0.5, (x) => springIn(x, 6, 10));
            return { sy: e, dy: -(1 - e) * size * 0.35, al: e > 0 ? 1 : 0 };
          })
        );
        break;
      case "stretch": {
        const e = expoOut(prog(u, 0, 0.42));
        const d = shot.index % 2 === 0 ? 1 : -1;
        if (e < 0.98) speedLines(g, sc, u, 1 - e, ink, d);
        lines.forEach((line, i) => {
          g.save();
          g.translate(box.cx + d * (1 - e) * sc.W * 0.7, lineAt(i));
          g.transform(1, 0, -0.55 * (1 - e) * d, 1, 0, 0);
          g.scale(1 + 1.6 * (1 - e), 1 - 0.25 * (1 - e));
          g.translate(-box.cx, -lineAt(i));
          letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({}));
          g.restore();
        });
        break;
      }
      case "drop":
        lines.forEach(
          (line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, (j) => {
            const e = stagger(u - i * 0.12, j, 0.045, 0.55, (x) => springIn(x, 5, 9));
            return { dy: -(1 - e) * sc.H * 0.6, rot: (1 - e) * (j % 2 ? 0.4 : -0.4), al: e > 0 ? 1 : 0 };
          })
        );
        break;
      case "count":
      case "strobe":
        lines.forEach((line, i) => letters(g, line, box.cx, lineAt(i), box.align, ink, () => ({ s: shot.entrance === "strobe" ? 1.28 - 0.28 * expoOut(prog(u % strobeStep(shot, sc.bpm), 0, 0.18)) : stamp(u, 0.3, 0.25) })));
        break;
      default:
        break;
    }
    if (len >= 0.9 && shot.layout !== "space" && shot.layout !== "bleed" && shot.entrance !== "strobe") {
      const p = cubicInOut(prog(u, len * 0.55, Math.min(0.45, len * 0.3)));
      if (p > 0) {
        const widest = Math.min(box.maxW, Math.max(...lines.map((l) => glyphs(g, l, box.align).w)));
        const x0 = box.align === "left" ? box.cx : box.align === "right" ? box.cx - widest : box.cx - widest / 2;
        const y = lineAt(lines.length - 1) + size * 0.16;
        drawOn(g, [[x0, y], [x0 + widest * 0.32, y]], p, accent, Math.max(4, size * 0.035));
      }
    }
    g.restore();
    return { top: lineAt(0) - size * 0.88, bottom: lineAt(lines.length - 1) + size * 0.2 };
  }
  function strobeWord(sc, shot, u) {
    const words = shot.lines.join(" ").split(/\s+/).filter(Boolean);
    return words[Math.min(words.length - 1, Math.floor(u / strobeStep(shot, sc.bpm)))] ?? "";
  }
  function countText(text, u, len) {
    const m = /(\d[\d,]*(?:\.\d+)?)/.exec(text);
    if (!m) return text;
    const raw = m[1];
    const value = Number(raw.replace(/,/g, ""));
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const v = value * cubicOut(prog(u, 0.06, Math.max(0.3, len * 0.7)));
    let shown = v.toFixed(decimals);
    if (raw.includes(",")) shown = Number(shown).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return text.slice(0, m.index) + shown + text.slice(m.index + raw.length);
  }
  function drawSub(g, sc, shot, u, box, ink, extent) {
    if (!shot.sub) return;
    const e = expoOut(prog(u, 0.22, 0.5));
    if (e <= 0) return;
    const size = Math.max(40 * sc.s, Math.min(64 * sc.s, box.maxSize * 0.2));
    g.save();
    g.font = `500 ${size.toFixed(1)}px ${sc.mono}`;
    g.textAlign = box.align === "left" ? "left" : "center";
    g.textBaseline = "middle";
    g.globalAlpha = e;
    g.fillStyle = ink;
    const room = Math.min(box.maxW, sc.W * 0.9);
    const wide = g.measureText(shot.sub.toUpperCase()).width * 1.25;
    if (wide > room) g.font = `500 ${(size * room / wide).toFixed(1)}px ${sc.mono}`;
    const under = extent.bottom + size * 1.1;
    const y = (under + size > sc.H * 0.94 ? extent.top - size * 0.9 : under) + (1 - e) * size * 0.6;
    g.letterSpacing = `${((0.25 + 0.35 * (1 - e)) * size * 0.3).toFixed(1)}px`;
    g.fillText(shot.sub.toUpperCase(), box.cx, y);
    g.restore();
  }
  function speedLines(g, sc, u, amount, color, dir) {
    const r = mulberry32(sc.seed + 31);
    g.save();
    g.strokeStyle = color;
    for (let i = 0; i < 46; i += 1) {
      const y = r() * sc.H;
      const l = (200 + r() * 900) * sc.s;
      const v = 0.5 + r();
      const w = 1 + r() * 5;
      const x0 = r() * sc.W;
      const x = ((x0 - dir * u * v * 3600 * sc.s) % (sc.W + l) + sc.W + l) % (sc.W + l) - l;
      g.globalAlpha = amount * (0.25 + 0.5 * r());
      g.lineWidth = w * sc.s;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + l, y);
      g.stroke();
    }
    g.restore();
  }
  function drawLayer(g, sc, shot, u, layer, box, ground) {
    const ink = sc.inks[ground];
    const accent = ground === "accent" ? ink : sc.accent;
    const { s } = sc;
    const r = mulberry32(sc.seed * 7919 + shot.index * 104729 + layer.length);
    g.save();
    switch (layer) {
      case "blobs": {
        g.globalCompositeOperation = ground === "light" ? "multiply" : "screen";
        const kick = 1 + 1.4 * Math.exp(-4 * u);
        for (let i = 0; i < 4; i += 1) {
          const x = box.rx + noise1(u * 0.35 + i * 7, sc.seed + i) * sc.W * 0.32;
          const y = box.ry + noise1(u * 0.3 + i * 13, sc.seed + i + 9) * sc.H * 0.3;
          const rad = (0.42 + 0.12 * i) * Math.min(sc.W, sc.H) * (0.85 + 0.15 * kick);
          const gr = g.createRadialGradient(x, y, 0, x, y, rad);
          gr.addColorStop(0, i % 2 ? sc.colors.secondary : accent);
          gr.addColorStop(1, "rgba(0,0,0,0)");
          g.globalAlpha = 0.42;
          g.fillStyle = gr;
          g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        break;
      }
      case "tunnel": {
        g.translate(box.rx, box.ry);
        for (let k = 0; k < 14; k += 1) {
          const z = ((k / 14 + u * 0.45) % 1 + 1) % 1;
          const sz = z ** 2.6 * 3.4 + 0.02;
          g.save();
          g.rotate((1 - z) * 1.6 + u * 0.25);
          g.strokeStyle = k % 3 ? ink : accent;
          g.globalAlpha = Math.min(1, z * 2.2) * (1 - prog(z, 0.85, 0.15)) * (k % 3 ? 0.45 : 0.9);
          g.lineWidth = (1.5 + 14 * z * z * z) * s;
          g.beginPath();
          g.roundRect(-sc.W * sz / 2, -sc.H * sz / 2, sc.W * sz, sc.H * sz, sc.H * sz * 0.18);
          g.stroke();
          g.restore();
        }
        break;
      }
      case "grid": {
        const gap = 54 * s;
        for (let y = gap / 2; y < sc.H; y += gap)
          for (let x = gap / 2; x < sc.W; x += gap) {
            const d = Math.hypot(x - box.rx, y - box.ry);
            const lit = prog(u - d / (1500 * s), 0, 0.3);
            const breathe = 0.5 + 0.5 * Math.sin(u * 3 - d / (160 * s));
            g.fillStyle = lit > 0.98 && breathe > 0.93 ? accent : ink;
            g.globalAlpha = 0.12 + 0.5 * lit * (0.4 + 0.6 * breathe);
            const rad = (2 + 3.5 * lit * breathe) * s;
            g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
          }
        break;
      }
      case "scope": {
        const x0 = box.rx - box.rr * 1.5;
        const x1 = box.rx + box.rr * 1.5;
        const hh = box.rr * 0.7;
        g.strokeStyle = ink;
        g.globalAlpha = 0.12;
        g.lineWidth = 1.2 * s;
        for (let i = 0; i <= 10; i += 1) {
          const x = x0 + (x1 - x0) * i / 10;
          g.beginPath();
          g.moveTo(x, box.ry - hh);
          g.lineTo(x, box.ry + hh);
          g.stroke();
        }
        for (let i = -3; i <= 3; i += 1) {
          g.beginPath();
          g.moveTo(x0, box.ry + i * hh / 3);
          g.lineTo(x1, box.ry + i * hh / 3);
          g.stroke();
        }
        g.globalAlpha = 1;
        const amp = hh * 0.85 * expoOut(prog(u, 0.3, 0.6));
        const pts = [];
        for (let k = 0; k <= 300; k += 1) {
          const f = k / 300;
          const env = Math.exp(-(((f - 0.5) * 2.2) ** 2));
          pts.push([x0 + (x1 - x0) * f, box.ry + amp * env * (Math.sin(f * 40 + u * 18) * 0.7 + noise1(f * 30 + u * 6, sc.seed) * 0.3)]);
        }
        const draw = expoOut(prog(u, 0, 0.4));
        for (const [lw, al] of [[14, 0.12], [6, 0.3], [2.5, 1]]) drawOn(g, pts, draw, accent, lw * s, al);
        break;
      }
      case "routes": {
        for (let i = 0; i < 24; i += 1) {
          const d = i % 2 ? 1 : -1;
          const sx = d < 0 ? -40 * s : sc.W + 40 * s;
          const sy = 80 * s + r() * (sc.H - 160 * s);
          const tx = box.rx + d * (box.rr * 0.35 + r() * box.rr * 0.3);
          const ty = box.ry - box.rr * 0.35 + r() * box.rr * 0.7;
          const dy = Math.abs(ty - sy);
          const mx = tx + d * (dy + 40 * s + r() * 160 * s);
          const pts = [[sx, sy], [mx, sy], [mx - d * dy, ty], [tx, ty]];
          const p = stagger(u, i, 0.025, 0.7, cubicInOut);
          const head = drawOn(g, pts, p, i % 4 === 0 ? accent : ink, 3 * s, i % 4 === 0 ? 0.95 : 0.55);
          if (p >= 1) {
            const a = stagger(u - 0.7, i, 0.025, 0.3, (x) => springIn(x));
            g.fillStyle = accent;
            g.beginPath();
            g.arc(head[0], head[1], Math.max(0, 9 * s * a), 0, TAU);
            g.fill();
          }
        }
        break;
      }
      case "rings": {
        for (let i = 0; i < 4; i += 1) {
          const p = prog(u, i * 0.09, 0.95);
          if (p <= 0 || p >= 1) continue;
          g.strokeStyle = i ? accent : ink;
          g.globalAlpha = (1 - p) * 0.8;
          g.lineWidth = (14 * (1 - p) + 1) * s;
          g.beginPath();
          g.arc(box.rx, box.ry, (180 + 1500 * (1 - (1 - p) ** 5)) * s, 0, TAU);
          g.stroke();
        }
        for (let i = 0; i < 140; i += 1) {
          const a = r() * TAU;
          const v = 700 + r() * 4400;
          const w = 1.5 + r() * 4;
          const rad = (150 + v * (1 - Math.exp(-4.2 * u)) / 4.2) * s;
          const l = (v * Math.exp(-4.2 * u) * 0.035 + 2) * s;
          const al = (1 - prog(u, 0.7, 0.8)) * 0.7;
          if (al <= 0) continue;
          g.strokeStyle = i % 3 ? ink : accent;
          g.globalAlpha = al;
          g.lineWidth = w * s;
          g.beginPath();
          g.moveTo(box.rx + Math.cos(a) * rad, box.ry + Math.sin(a) * rad);
          g.lineTo(box.rx + Math.cos(a) * (rad + l), box.ry + Math.sin(a) * (rad + l));
          g.stroke();
        }
        break;
      }
      case "rays":
        speedLines(g, sc, u, 0.8, ink, shot.index % 2 === 0 ? 1 : -1);
        break;
      case "orbit": {
        const tilt = 0.32;
        for (let k = 0; k < 3; k += 1) {
          const R = box.rr * (0.75 + k * 0.32) * expoOut(prog(u, k * 0.08, 0.6));
          g.save();
          g.translate(box.rx, box.ry);
          g.rotate(-0.35 + k * 0.5);
          g.strokeStyle = ink;
          g.globalAlpha = 0.28;
          g.lineWidth = 1.5 * s;
          g.beginPath();
          g.ellipse(0, 0, R, R * tilt, 0, 0, TAU);
          g.stroke();
          const a = u * (1.1 - k * 0.25) * (k % 2 ? -1 : 1) + k * 2;
          g.globalAlpha = 1;
          g.fillStyle = k === 0 ? accent : ink;
          g.beginPath();
          g.arc(Math.cos(a) * R, Math.sin(a) * R * tilt, (10 - k * 2) * s, 0, TAU);
          g.fill();
          g.restore();
        }
        break;
      }
      case "bars": {
        const n = 9;
        const span = box.rr * 2.4;
        const bw = span / n * 0.62;
        const baseY = box.ry + box.rr * 0.9;
        const hi = 2 + Math.floor(r() * (n - 4));
        const pop = ground === "accent" ? ink === sc.colors.dark ? sc.colors.light : sc.colors.dark : accent;
        for (let i = 0; i < n; i += 1) {
          const target = (0.25 + 0.75 * r()) * box.rr * 1.6 * (i === hi ? 1.25 : 1);
          const grow = springIn(prog(u - i * 0.05, 0, 0.6), 5, 7);
          const h = Math.max(0, target * grow * (1 + 0.05 * Math.sin(u * 4 + i)));
          g.fillStyle = i === hi ? pop : ink;
          g.globalAlpha = i === hi ? 1 : 0.35;
          g.fillRect(box.rx - span / 2 + i * span / n, baseY - h, bw, h);
        }
        g.globalAlpha = 0.5;
        g.fillStyle = ink;
        g.fillRect(box.rx - span / 2 - 10 * s, baseY, span + 20 * s, 2 * s);
        break;
      }
      case "marquee": {
        const unit = `${(shot.lines[0] ?? shot.sub) || "\u2022"}  `;
        const size = 150 * s;
        g.translate(sc.W / 2, sc.H / 2);
        g.rotate(-0.12);
        g.font = fontOf(sc, size);
        g.textBaseline = "middle";
        const uw = Math.max(1, g.measureText(unit).width);
        const D = Math.hypot(sc.W, sc.H) / 2;
        for (let k = -4; k <= 4; k += 1) {
          const d = k % 2 ? 1 : -1;
          const off = d * u * 420 * s + k * 137 * s;
          const y = k * size * 1.05;
          for (let x = (off % uw + uw) % uw - uw - D; x < D; x += uw) {
            g.globalAlpha = k === 0 ? 0.9 : 0.28;
            if (k === 0) {
              g.fillStyle = accent;
              g.fillText(unit, x, y);
            } else {
              g.strokeStyle = ink;
              g.lineWidth = 2.5 * s;
              g.strokeText(unit, x, y);
            }
          }
        }
        break;
      }
      case "dial": {
        g.translate(box.rx, box.ry);
        const R = box.rr * 1.05 * expoOut(prog(u, 0, 0.5));
        g.rotate(u * 0.35);
        g.strokeStyle = ink;
        g.globalAlpha = 0.6;
        g.lineWidth = 2 * s;
        g.beginPath();
        for (let i = 0; i < 120; i += 1) {
          const a = i / 120 * TAU;
          const l = (i % 5 ? 9 : 22) * s;
          g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
          g.lineTo(Math.cos(a) * (R + l), Math.sin(a) * (R + l));
        }
        g.stroke();
        g.strokeStyle = accent;
        g.globalAlpha = 0.9;
        g.lineWidth = 3 * s;
        g.beginPath();
        g.arc(0, 0, R * 0.9, -0.4, -0.4 + TAU * 0.28 * cubicInOut(prog(u, 0.2, 0.8)));
        g.stroke();
        break;
      }
      default:
        break;
    }
    g.restore();
  }

  // packages/motion/src/blocks/kinetic_cut_scene/block.ts
  var SHUTTER = 0.6;
  var WEIGHTS = { sans: 900, serif: 400, mono: 800, display: 400 };
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})/i.exec(hex);
    if (!m) return 0.5;
    const n = Number.parseInt(m[1], 16);
    const lin = (c) => c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
  }
  function build(ctx) {
    const { tl, params: p, width: W, height: H, palette } = ctx;
    const bpm = Number(p.bpm);
    const look = HIT_LOOKS[p.look ?? "punchy"] ?? HIT_LOOKS.punchy;
    const samples = ctx.draft ? 1 : Number(p.shutter_samples);
    const specs = [];
    for (const line of p.shots.filter((l) => l.trim())) {
      const spec = parseShot(line);
      if (typeof spec === "string") throw new Error(`shots: ${spec}`);
      specs.push(spec);
    }
    const shots = scheduleShots(specs, bpm, ctx.seconds);
    const s = Math.min(W, H) / 1080;
    const hits = shotHits(shots, bpm, s);
    for (const c of shotCues(shots, bpm)) ctx.cue(c.t, c.kind, { weight: c.weight, ...c.until !== void 0 ? { until: c.until } : {}, ...c.rate !== void 0 ? { rate: c.rate } : {} });
    ctx.ownExit = true;
    const dark = palette.dark ? palette.paper : palette.ink;
    const light = palette.dark ? palette.ink : palette.paper;
    const colors = { dark, light, accent: palette.accent, secondary: palette.secondary };
    const contrast = (a, c) => (Math.max(luminance(a), luminance(c)) + 0.05) / (Math.min(luminance(a), luminance(c)) + 0.05);
    const on = (bg) => contrast(bg, dark) >= contrast(bg, light) ? dark : light;
    const scene = {
      W,
      H,
      s,
      portrait: ctx.portrait,
      font: FONT_STACKS[ctx.display],
      weight: WEIGHTS[ctx.display] ?? 900,
      mono: FONT_STACKS.mono,
      colors,
      inks: { dark: light, light: dark, accent: on(palette.accent), secondary: on(palette.secondary) },
      accent: palette.accent,
      bpm,
      seed: ctx.seed,
      particles: /* @__PURE__ */ new Map()
    };
    for (const shot of shots) {
      if (shot.entrance !== "assemble") continue;
      const box = layoutBox(scene, shot);
      const R = Math.min(box.maxW, W) / 2;
      const mask = shapeMask(ctx.doc, (g, side) => {
        const k = side / (2 * R);
        const size = fitSize(g, scene, shot.lines, box.maxW, box.maxSize, box.maxH);
        g.font = `${scene.weight} ${(size * k).toFixed(1)}px ${scene.font}`;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        baselines(shot.lines.length, size, box.cy).forEach((y, i) => g.fillText(shot.lines[i], side / 2, side / 2 + (y - box.cy) * k));
      });
      if (mask) scene.particles.set(shot.index, shapeParticles(mask, 180, Math.round(900 * Math.max(0.6, s)), ctx.seed * 31 + shot.index));
    }
    const canvas = ctx.el("canvas", "kc-canvas");
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: `${W}px`, height: `${H}px` });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(W * dpr);
    const chh = Math.round(H * dpr);
    canvas.width = cw;
    canvas.height = chh;
    const mk = () => Object.assign(ctx.doc.createElement("canvas"), { width: cw, height: chh });
    const sub = mk();
    const acc = mk();
    const out = canvas.getContext("2d", { alpha: false });
    const sg = sub.getContext("2d", { alpha: false });
    const ag = acc.getContext("2d", { alpha: false });
    if (!out || !sg || !ag) return;
    const buffers = finishBuffers(ctx.doc, cw, chh, look.vignette);
    tl.track((t) => {
      const shot = shots.find((sh) => t >= sh.start && t < sh.end) ?? shots[shots.length - 1];
      if (!shot) return;
      const times = subframeTimes(t, samples, SHUTTER, ctx.fps, shot.start, shot.end);
      times.forEach((ts, k) => {
        const cam = hitCamera(hits, ts, look.punch);
        sg.setTransform(1, 0, 0, 1, 0, 0);
        sg.globalAlpha = 1;
        sg.globalCompositeOperation = "source-over";
        sg.fillStyle = "#000";
        sg.fillRect(0, 0, cw, chh);
        sg.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (W / 2 * (1 - cam.zoom) + cam.x), dpr * (H / 2 * (1 - cam.zoom) + cam.y));
        drawShot(sg, scene, shot, ts - shot.start, t - shot.start);
        ag.globalAlpha = 1 / (k + 1);
        ag.drawImage(sub, 0, 0);
      });
      ag.globalAlpha = 1;
      const f = hitFinish(hits, t, look, groundBloom(shot.ground));
      applyFinish(out, acc, buffers, { ...f, lightGround: shot.ground === "light" });
    });
  }

  // packages/motion/src/runtime/easing.ts
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const sampleX = (s) => ((ax * s + bx) * s + cx) * s;
    const sampleY = (s) => ((ay * s + by) * s + cy) * s;
    const slopeX = (s) => (3 * ax * s + 2 * bx) * s + cx;
    const solve = (x) => {
      let s = x;
      for (let i = 0; i < 8; i += 1) {
        const err = sampleX(s) - x;
        if (Math.abs(err) < 1e-7) return s;
        const d = slopeX(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
      }
      let lo = 0;
      let hi = 1;
      s = x;
      for (let i = 0; i < 40; i += 1) {
        const v = sampleX(s);
        if (Math.abs(v - x) < 1e-7) return s;
        if (v < x) lo = s;
        else hi = s;
        s = (lo + hi) / 2;
      }
      return s;
    };
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return sampleY(solve(t));
    };
  }
  function spring(options = {}) {
    const k = options.stiffness ?? 170;
    const c = options.damping ?? 18;
    const m = options.mass ?? 1;
    const w0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));
    const raw = (tau) => {
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + zeta * w0 / wd * Math.sin(wd * tau));
      }
      return 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
    };
    const settle = Math.log(1e3) / (Math.min(zeta, 1) * w0);
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return raw(t * settle);
    };
  }
  var backOut = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c1 = 1.3;
    const u = t - 1;
    return 1 + (c1 + 1) * u * u * u + c1 * u * u;
  };
  var EASES = {
    smooth: cubicBezier(0.33, 0, 0.2, 1),
    out: cubicBezier(0.16, 1, 0.3, 1),
    entrance: cubicBezier(0.16, 1, 0.3, 1),
    in: cubicBezier(0.7, 0, 0.84, 0),
    exit: cubicBezier(0.7, 0, 0.84, 0),
    "in-out": cubicBezier(0.65, 0, 0.35, 1),
    snap: cubicBezier(0.2, 0, 0, 1),
    linear: (t) => Math.min(1, Math.max(0, t)),
    hold: (t) => t >= 1 ? 1 : 0,
    "back-out": backOut,
    spring: spring()
  };
  function resolveEase(ease) {
    if (ease === void 0) return EASES.smooth;
    if (typeof ease === "function") return ease;
    const named = EASES[ease];
    if (!named) throw new Error(`unknown easing ${String(ease)}`);
    return named;
  }

  // packages/motion/src/runtime/effects.ts
  function frameUrl(video, n) {
    const i = Math.max(0, Math.min(video.frames - 1, n));
    return video.pattern.replace("{n}", String(i + 1).padStart(5, "0"));
  }
  function videoTrack(img, video, pending, start = 0) {
    return (t) => {
      const url = frameUrl(video, Math.floor(Math.max(0, t - start) * video.fps + 1e-6));
      if (img.getAttribute("src") === url) return;
      img.setAttribute("src", url);
      if (typeof img.decode === "function") {
        const p = img.decode().catch(() => void 0);
        pending.add(p);
        void p.finally(() => pending.delete(p));
      }
    };
  }

  // packages/motion/src/runtime/interpolate.ts
  var NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
  var HEX = /#([0-9a-f]{3,8})\b/gi;
  function hexToRgba(hex) {
    let h = hex.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    const a = h.length === 8 ? n(6) / 255 : 1;
    return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${a})`;
  }
  function normalizeColors(text) {
    return text.replace(HEX, (m) => [4, 5, 7, 9].includes(m.length) ? hexToRgba(m) : m).replace(/\brgb\(([^)]*)\)/g, "rgba($1, 1)");
  }
  function parse(text) {
    const parts = [];
    const numbers = [];
    let last = 0;
    for (const m of text.matchAll(NUMBER)) {
      parts.push(text.slice(last, m.index));
      numbers.push(Number(m[0]));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return { parts, numbers };
  }
  function format(n) {
    return String(Math.round(n * 1e4) / 1e4);
  }
  function interpolate(a, b, p) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
    const sa = normalizeColors(String(a));
    const sb = normalizeColors(String(b));
    const pa = parse(sa);
    const pb = parse(sb);
    const same = pa.numbers.length === pb.numbers.length && pa.parts.every((part, i) => part.replace(/\s+/g, "") === pb.parts[i].replace(/\s+/g, ""));
    if (!same) return p >= 1 ? b : a;
    let out = pb.parts[0];
    for (let i = 0; i < pa.numbers.length; i += 1) {
      let v = pa.numbers[i] + (pb.numbers[i] - pa.numbers[i]) * p;
      const inColor = /rgba\($|rgba\([^)]*$/.test(out);
      if (inColor) {
        const channel = (out.slice(out.lastIndexOf("rgba(")).match(/,/g) ?? []).length;
        v = channel < 3 ? Math.round(Math.min(255, Math.max(0, v))) : Math.min(1, Math.max(0, v));
      }
      out += format(v) + pb.parts[i + 1];
    }
    return out;
  }

  // packages/motion/src/runtime/timeline.ts
  var TRANSFORM_PROPS = ["xPercent", "yPercent", "x", "y", "z", "rotateX", "rotateY", "rotate", "skewX", "skewY", "scale", "scaleX", "scaleY"];
  var TRANSFORM_SET = new Set(TRANSFORM_PROPS);
  var IDENTITY = { scale: 1, scaleX: 1, scaleY: 1, opacity: 1 };
  var PX = /* @__PURE__ */ new Set(["width", "height", "left", "top", "right", "bottom", "borderRadius", "fontSize", "letterSpacing", "padding", "margin", "gap", "strokeWidth", "outlineWidth"]);
  function toList(targets) {
    if (!targets) return [];
    if (Array.isArray(targets)) return [...targets];
    if (typeof targets.forEach === "function" && typeof targets.length === "number" && !(targets instanceof Element)) {
      return Array.from(targets);
    }
    return [targets];
  }
  function staggerOffsets(count, stagger2) {
    if (!stagger2 || count <= 1) return new Array(count).fill(0);
    const s = typeof stagger2 === "number" ? { each: stagger2 } : stagger2;
    const from = s.from ?? "start";
    const order = [...Array(count).keys()];
    if (from === "random") {
      const keys = order.map((i) => random01(s.seed ?? 1, i));
      const ranked = [...order].sort((a, b) => keys[a] - keys[b]);
      const out = new Array(count);
      ranked.forEach((i, rank) => out[i] = rank * s.each);
      return out;
    }
    return order.map((i) => {
      if (from === "end") return (count - 1 - i) * s.each;
      if (from === "center") return Math.abs(i - (count - 1) / 2) * s.each;
      return i * s.each;
    });
  }
  function isElement(target) {
    return typeof target.setAttribute === "function" && typeof target.tagName === "string";
  }
  function cssValue(prop, value) {
    return typeof value === "number" && PX.has(prop) ? `${value}px` : String(value);
  }
  function kebab(prop) {
    return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  }
  var Timeline = class {
    tweens = /* @__PURE__ */ new Map();
    tracks = [];
    events = [];
    order = 0;
    end = 0;
    /** Seconds the timeline runs: the end of its last tween, or longer when `extend` asked for it. */
    get duration() {
      return this.end;
    }
    /** Make the timeline at least `seconds` long (a hold after the last tween). */
    extend(seconds) {
      this.end = Math.max(this.end, seconds);
      return this;
    }
    /** Animate from each property's value at `at` (its previous tween's end, else its rest value) to `props`. */
    to(targets, props, options) {
      return this.add(targets, void 0, props, options);
    }
    fromTo(targets, from, to, options) {
      return this.add(targets, from, to, options);
    }
    /** Jump to `props` at `at` (a zero-length tween). */
    set(targets, props, at) {
      return this.add(targets, void 0, props, { at, duration: 0, ease: "hold" });
    }
    /** Run `track(t)` on every seek, after the tweens (typing, counters, particles). */
    track(track, until = 0) {
      this.tracks.push(track);
      this.end = Math.max(this.end, until);
      return this;
    }
    /** Record a picture event: something on screen the ear expects to hear (not drawn; the sound design reads it). */
    cue(at, kind, options = {}) {
      const event = { t: at, kind, weight: options.weight ?? 0.5, x: options.x ?? 0.5, y: options.y ?? 0.5 };
      if (options.until !== void 0 && options.until > at) event.until = options.until;
      if (options.rate !== void 0 && options.rate > 0) event.rate = options.rate;
      this.events.push(event);
      return this;
    }
    /** The picture events, by time (ties keep the order they were cued in). */
    get cues() {
      return this.events.map((e) => ({ ...e })).sort((a, b) => a.t - b.t);
    }
    add(targets, from, to, options) {
      const list = toList(targets);
      const duration = Math.max(0, options.duration ?? 0.6);
      const ease = resolveEase(options.ease);
      const offsets = staggerOffsets(list.length, options.stagger);
      list.forEach((target, i) => {
        const at = options.at + offsets[i];
        let tweens = this.tweens.get(target);
        if (!tweens) {
          tweens = [];
          this.tweens.set(target, tweens);
        }
        for (const [prop, value] of Object.entries(to)) {
          tweens.push({ prop, from: from?.[prop], to: value, at, duration, ease, order: this.order++ });
        }
        this.end = Math.max(this.end, at + duration);
      });
      return this;
    }
    /** Every animated property of `target` at time `t`. */
    valuesAt(target, t) {
      const out = /* @__PURE__ */ new Map();
      const byProp = /* @__PURE__ */ new Map();
      for (const tween of this.tweens.get(target) ?? []) {
        let list = byProp.get(tween.prop);
        if (!list) {
          list = [];
          byProp.set(tween.prop, list);
        }
        list.push(tween);
      }
      for (const [prop, list] of byProp) {
        list.sort((a, b) => a.at - b.at || a.order - b.order);
        const rest = list[0].from ?? IDENTITY[prop] ?? (TRANSFORM_SET.has(prop) || prop === "blur" ? 0 : void 0);
        let value = rest;
        for (const tween of list) {
          if (tween.at > t) break;
          const from = tween.from ?? value ?? tween.to;
          const p = tween.duration <= 0 ? 1 : Math.min(1, (t - tween.at) / tween.duration);
          value = interpolate(from, tween.to, tween.ease(p));
        }
        if (value !== void 0) out.set(prop, value);
      }
      return out;
    }
    /** Put every target in its state at time `t` (seconds), then run the tracks. */
    seek(t) {
      for (const target of this.tweens.keys()) apply(target, this.valuesAt(target, t));
      for (const track of this.tracks) track(t);
    }
  };
  function apply(target, values) {
    if (!isElement(target)) {
      for (const [prop, value] of values) target[prop] = value;
      return;
    }
    const el = target;
    let transform = false;
    for (const [prop, value] of values) {
      if (TRANSFORM_SET.has(prop)) transform = true;
      else if (prop === "opacity") el.style.opacity = String(value);
      else if (prop === "blur") el.style.filter = Number(value) > 0.01 ? `blur(${value}px)` : "";
      else if (prop.startsWith("--")) el.style.setProperty(prop, String(value));
      else if (prop.startsWith("attr:")) el.setAttribute(prop.slice(5), String(value));
      else el.style.setProperty(kebab(prop), cssValue(prop, value));
    }
    if (transform) el.style.transform = composeTransform(values);
  }
  function composeTransform(values) {
    const n = (prop, fallback) => {
      const v = values.get(prop);
      return v === void 0 ? fallback : Number(v);
    };
    const parts = [];
    const xp = n("xPercent", 0);
    const yp = n("yPercent", 0);
    if (xp !== 0 || yp !== 0) parts.push(`translate(${xp}%, ${yp}%)`);
    const x = n("x", 0);
    const y = n("y", 0);
    const z = n("z", 0);
    if (x !== 0 || y !== 0 || z !== 0) parts.push(`translate3d(${x}px, ${y}px, ${z}px)`);
    for (const [prop, fn] of [["rotateX", "rotateX"], ["rotateY", "rotateY"], ["rotate", "rotate"], ["skewX", "skewX"], ["skewY", "skewY"]]) {
      const v = n(prop, 0);
      if (v !== 0) parts.push(`${fn}(${v}deg)`);
    }
    const s = n("scale", 1);
    const sx = n("scaleX", 1) * s;
    const sy = n("scaleY", 1) * s;
    if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
    return parts.join(" ") || "none";
  }

  // packages/motion/src/runtime/page.ts
  function safeArea(width, height) {
    if (height > width * 1.2) return { top: Math.round(height * 0.12), bottom: Math.round(height * 0.2), left: Math.round(width * 0.1), right: Math.round(width * 0.1) };
    return { top: Math.round(height * 0.1), bottom: Math.round(height * 0.1), left: Math.round(width * 0.1), right: Math.round(width * 0.1) };
  }
  var EXIT_SECONDS = 0.4;
  var placedCues = /* @__PURE__ */ new WeakMap();
  var clamp012 = (v) => Math.min(1, Math.max(0, v));
  var round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
  function isElement2(place) {
    return typeof place.getBoundingClientRect === "function";
  }
  function createContext(doc, config) {
    const p = config.params;
    const base = withAccent(PALETTES[p.palette ?? "light"] ?? PALETTES.light, typeof p.accent === "string" ? p.accent : void 0);
    const palette = { ...base, ...typeof p.paper === "string" ? { paper: p.paper } : {}, ...typeof p.ink === "string" ? { ink: p.ink } : {} };
    const root = doc.createElement("div");
    root.id = "block";
    root.className = `block block-${config.block}${palette.dark ? " is-dark" : ""}${config.height > config.width * 1.2 ? " is-portrait" : ""}${config.alpha ? " is-alpha" : ""}`;
    const display = p.display_font ?? "sans";
    const radius = typeof p.radius === "number" ? p.radius : 28;
    const vars = {
      "--paper": palette.paper,
      "--ink": palette.ink,
      "--surface": palette.surface,
      "--muted": palette.muted,
      "--line": palette.line,
      "--accent": palette.accent,
      "--secondary": palette.secondary,
      "--glass": palette.glass,
      "--radius": `${radius}px`,
      "--font-sans": FONT_STACKS.sans,
      "--font-serif": FONT_STACKS.serif,
      "--font-mono": FONT_STACKS.mono,
      "--font-display": FONT_STACKS[display],
      "--w": `${config.width}px`,
      "--h": `${config.height}px`
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    Object.assign(root.style, { position: "absolute", left: "0", top: "0", width: `${config.width}px`, height: `${config.height}px`, overflow: "hidden" });
    if (!config.alpha) root.style.background = palette.paper;
    doc.body.append(root);
    const tl = new Timeline().extend(config.seconds);
    const pending = /* @__PURE__ */ new Set();
    const ctx = {
      ...config,
      doc,
      root,
      tl,
      palette,
      display,
      radius,
      seed: typeof p.seed === "number" ? p.seed : 1,
      safe: safeArea(config.width, config.height),
      portrait: config.height > config.width * 1.2,
      ownExit: false,
      pending,
      el(tag, className, parent, text) {
        const e = doc.createElement(tag);
        if (className) e.className = className;
        if (text !== void 0) e.textContent = text;
        (parent === void 0 ? root : parent)?.append(e);
        return e;
      },
      mediaImg(name, className, parent) {
        const ref = config.media[name];
        if (!ref) return null;
        const img = ctx.el("img", className, parent ?? root);
        img.alt = "";
        if (ref.kind === "image") img.src = ref.url;
        else tl.track(videoTrack(img, ref, pending));
        return img;
      },
      cue(at, kind, options = {}) {
        if (!(at >= 0 && at < config.seconds)) return;
        const opts = options.until === void 0 ? options : { ...options, until: Math.min(options.until, config.seconds) };
        if (opts.at && isElement2(opts.at)) {
          placedCues.get(ctx)?.push({ at, kind, el: opts.at, options: opts });
          return;
        }
        cueOn(tl, at, kind, opts, opts.at ? { x: opts.at.x / config.width, y: opts.at.y / config.height } : void 0);
      }
    };
    placedCues.set(ctx, []);
    return ctx;
  }
  function cueOn(tl, at, kind, options, place) {
    tl.cue(round(at, 3), kind, {
      weight: round(clamp012(options.weight ?? 0.5), 2),
      x: place ? round(clamp012(place.x), 3) : 0.5,
      y: place ? round(clamp012(place.y), 3) : 0.5,
      ...options.until !== void 0 ? { until: round(options.until, 3) } : {},
      // The contract's ceiling (sfx/events.ts readPictureEvents): past 30/s a run is a texture, not strikes.
      ...options.rate !== void 0 ? { rate: round(Math.min(30, options.rate), 2) } : {}
    });
  }
  function pictureEvents(ctx) {
    const placed = placedCues.get(ctx)?.splice(0) ?? [];
    placed.sort((a, b) => a.at - b.at);
    let seeked;
    for (const cue of placed) {
      if (seeked !== cue.at) ctx.tl.seek(cue.at);
      seeked = cue.at;
      const frame = ctx.root.getBoundingClientRect();
      const r = cue.el.getBoundingClientRect();
      const place = frame.width > 0 && frame.height > 0 ? { x: (r.left + r.width / 2 - frame.left) / frame.width, y: (r.top + r.height / 2 - frame.top) / frame.height } : void 0;
      cueOn(ctx.tl, cue.at, cue.kind, cue.options, place);
    }
    return ctx.tl.cues.filter((e) => e.t < ctx.seconds);
  }
  function waitImages(doc) {
    return Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => void 0)));
  }
  function defineBlock(build2) {
    const config = window.__ZENVI_BLOCK__;
    if (!config) throw new Error("no __ZENVI_BLOCK__ config on the page");
    let resolveReady;
    let rejectReady;
    const ready = new Promise((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    const api = {
      ready,
      duration: config.seconds,
      async seek() {
        await ready;
      }
    };
    window.__zenvi = api;
    void (async () => {
      await Promise.all(FONT_FACES.map((f) => document.fonts.load(`${f.style} ${f.weight.split(" ")[0]} 48px '${f.family}'`)));
      const ctx = createContext(document, config);
      await build2(ctx);
      await document.fonts.ready;
      api.events = pictureEvents(ctx);
      if (config.params.exit !== false && !ctx.ownExit) {
        ctx.tl.to(ctx.root, { opacity: 0, y: -24, blur: 8 }, { at: Math.max(0, config.seconds - EXIT_SECONDS), duration: EXIT_SECONDS, ease: "exit" });
      }
      const seek = async (t) => {
        ctx.tl.seek(Math.min(t, config.seconds));
        await waitImages(document);
        while (ctx.pending.size > 0) await Promise.all([...ctx.pending]);
      };
      await seek(0);
      api.seek = seek;
      window.__hf = { duration: config.seconds, seek: (t) => void seek(t) };
      resolveReady();
    })().catch((error) => {
      api.error = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
      rejectReady(error);
    });
  }

  // packages/motion/src/blocks/kinetic_cut_scene/kinetic_cut_scene-entry.ts
  defineBlock(build);
})();
