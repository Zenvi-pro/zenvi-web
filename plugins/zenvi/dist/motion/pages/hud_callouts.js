(() => {
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

  // packages/motion/src/runtime/effects.ts
  function strokeDrawable(shape) {
    shape.setAttribute("pathLength", "1");
    shape.setAttribute("stroke-dasharray", "1 1");
    shape.setAttribute("stroke-dashoffset", "1");
    return shape;
  }
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
  var clamp01 = (v) => Math.min(1, Math.max(0, v));
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
      weight: round(clamp01(options.weight ?? 0.5), 2),
      x: place ? round(clamp01(place.x), 3) : 0.5,
      y: place ? round(clamp01(place.y), 3) : 0.5,
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

  // packages/motion/src/runtime/text.ts
  var SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=<>/\\[]{}";
  function scrambledText(text, t, options) {
    const chars = Array.from(text);
    const glyphs = Array.from(options.glyphs ?? SCRAMBLE_GLYPHS);
    if (t < options.at) return options.before ?? "";
    const duration = options.duration ?? 1.2;
    const n = Math.max(1, chars.length);
    const life = duration * 0.4;
    const spread2 = duration - life;
    const tick = Math.floor(t * (options.rate ?? 20));
    return chars.map((c, i) => {
      if (/\s/.test(c)) return c;
      const start = options.at + spread2 * i / n;
      if (t < start) return "";
      if (t >= start + life) return c;
      return glyphs[Math.floor(random01(options.seed ?? 7, i, tick) * glyphs.length)];
    }).join("");
  }

  // packages/motion/src/blocks/hud_callouts/block.ts
  var SVG = "http://www.w3.org/2000/svg";
  function spread(n) {
    return Array.from({ length: n }, (_, i) => ({ x: i % 2 === 0 ? 0.4 : 0.6, y: 0.35 + 0.3 * (i + 0.5) / n }));
  }
  function build(ctx) {
    const { tl, params: p, width: W, height: H, safe } = ctx;
    const labels = p.labels;
    const values = p.values;
    const given = p.points;
    const points = labels.map((_, i) => given[i] ?? spread(labels.length)[i]);
    const bg = ctx.mediaImg("background", "hud-bg");
    if (bg) tl.fromTo(bg, { scale: 1.08 }, { scale: 1 }, { at: 0, duration: ctx.seconds, ease: "out" });
    const svg = ctx.doc.createElementNS(SVG, "svg");
    svg.setAttribute("class", "hud-svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    ctx.root.append(svg);
    const shape = (tag, attrs, cls) => {
      const el = ctx.doc.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      el.setAttribute("class", cls);
      svg.append(el);
      return el;
    };
    const draw = (el, at, duration) => {
      strokeDrawable(el);
      tl.fromTo(el, { "attr:stroke-dashoffset": 1 }, { "attr:stroke-dashoffset": 0 }, { at, duration, ease: "in-out" });
    };
    const m = Math.round(Math.min(W, H) * 0.05);
    if (p.grid !== "none") {
      const cx = W / 2;
      const cy = H / 2;
      draw(shape("line", { x1: cx, y1: m, x2: cx, y2: H - m }, "rule"), 0, 0.9);
      draw(shape("line", { x1: m, y1: cy, x2: W - m, y2: cy }, "rule"), 0.08, 0.9);
      const c = 36;
      for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
        draw(shape("polyline", { points: `${x},${y + dy * c} ${x},${y} ${x + dx * c},${y}` }, "tick"), 0.2, 0.4);
      }
      if (p.grid === "full") {
        const step = Math.min(W, H) / 6;
        let i = 0;
        for (let x = cx - step; x > m; x -= step) for (const xx of [x, W - x]) draw(shape("line", { x1: xx, y1: m, x2: xx, y2: H - m }, "rule"), 0.15 + 0.04 * i++, 0.8);
        for (let y = cy - step; y > m; y -= step) for (const yy of [y, H - y]) draw(shape("line", { x1: m, y1: yy, x2: W - m, y2: yy }, "rule"), 0.15 + 0.04 * i++, 0.8);
      }
      const coord = ctx.el("div", "hud-coord", ctx.root, `X ${W / 2} \xB7 Y ${H / 2}`);
      Object.assign(coord.style, { left: `${cx + 14}px`, top: `${cy + 10}px` });
      tl.fromTo(coord, { opacity: 0 }, { opacity: 1 }, { at: 0.6, duration: 0.3, ease: "linear" });
    }
    if (p.title) {
      const title = ctx.el("div", "hud-title", ctx.root);
      Object.assign(title.style, { left: `${safe.left}px`, top: `${safe.top - 60}px` });
      const text = String(p.title);
      const opts = { at: 0.1, duration: 0.8, seed: ctx.seed, rate: 24 };
      ctx.cue(opts.at, "swap", { weight: 0.25, at: title, until: opts.at + opts.duration, rate: opts.rate });
      tl.track((t) => {
        title.textContent = scrambledText(text, t, opts);
      });
    }
    const callouts = points.map((pt, i) => ({
      name: labels[i],
      value: values[i] ?? "",
      ax: pt.x * W,
      ay: pt.y * H,
      side: pt.x < 0.5 ? "left" : "right",
      ly: pt.y * H - Math.min(W, H) * 0.19
    }));
    const gap = 150;
    for (const side of ["left", "right"]) {
      const list = callouts.filter((c) => c.side === side).sort((a, b) => a.ly - b.ly);
      let floor = safe.top + 20;
      for (const c of list) {
        c.ly = Math.max(c.ly, floor);
        floor = c.ly + gap;
      }
      const ceiling = H - safe.bottom - 80;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const c = list[i];
        const limit = i === list.length - 1 ? ceiling : list[i + 1].ly - gap;
        c.ly = Math.min(c.ly, limit);
      }
    }
    callouts.forEach((c, i) => {
      const at = 0.45 + i * 0.35;
      const ring = shape("circle", { cx: c.ax, cy: c.ay, r: 18 }, "ring");
      const dot = shape("circle", { cx: c.ax, cy: c.ay, r: 6 }, "dot");
      for (const el of [ring, dot]) el.style.transformOrigin = `${c.ax}px ${c.ay}px`;
      tl.fromTo([ring, dot], { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, { at, duration: 0.45, ease: "back-out" });
      ctx.cue(at, "pop", { weight: 0.3, at: { x: c.ax, y: c.ay } });
      tl.track((t) => {
        if (t < at + 0.45) return;
        const k = (t - at - 0.45) % 1.6 / 1.6;
        ring.style.transform = `scale(${1 + 0.35 * k})`;
        ring.style.opacity = String(1 - 0.8 * k);
      });
      const edge = c.side === "left" ? safe.left : W - safe.right;
      const label = ctx.el("div", "hud-label");
      const name = ctx.el("div", "hud-name", label, c.name);
      const value = ctx.el("div", "hud-value", label, c.value || " ");
      label.style.top = `${c.ly}px`;
      const lineY = c.ly + label.offsetHeight + 16;
      const elbowX = c.ax + (edge > c.ax ? 1 : -1) * Math.min(Math.abs(lineY - c.ay), Math.abs(edge - c.ax) * 0.35);
      const lead = shape("polyline", { points: `${c.ax},${c.ay} ${elbowX},${lineY} ${edge},${lineY}` }, "lead");
      draw(lead, at + 0.25, 0.55);
      if (c.side === "left") {
        label.style.left = `${safe.left}px`;
      } else {
        label.style.right = `${safe.right}px`;
        label.style.alignItems = "flex-end";
      }
      const textAt = at + 0.6;
      const o1 = { at: textAt, duration: 0.6, seed: ctx.seed + i * 13, rate: 24 };
      const o2 = { at: textAt + 0.12, duration: 0.6, seed: ctx.seed + i * 29, rate: 24 };
      ctx.cue(o1.at, "swap", { weight: 0.2, at: label, until: o2.at + o2.duration, rate: o1.rate });
      tl.track((t) => {
        name.textContent = scrambledText(c.name, t, o1);
        value.textContent = scrambledText(c.value, t, o2);
      });
    });
  }

  // packages/motion/src/blocks/hud_callouts/hud_callouts-entry.ts
  defineBlock(build);
})();
