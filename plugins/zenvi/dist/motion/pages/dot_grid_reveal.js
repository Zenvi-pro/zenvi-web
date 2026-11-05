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
  function resolveEase(ease2) {
    if (ease2 === void 0) return EASES.smooth;
    if (typeof ease2 === "function") return ease2;
    const named = EASES[ease2];
    if (!named) throw new Error(`unknown easing ${String(ease2)}`);
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
  function staggerOffsets(count, stagger) {
    if (!stagger || count <= 1) return new Array(count).fill(0);
    const s = typeof stagger === "number" ? { each: stagger } : stagger;
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
      const ease2 = resolveEase(options.ease);
      const offsets = staggerOffsets(list.length, options.stagger);
      list.forEach((target, i) => {
        const at = options.at + offsets[i];
        let tweens = this.tweens.get(target);
        if (!tweens) {
          tweens = [];
          this.tweens.set(target, tweens);
        }
        for (const [prop, value] of Object.entries(to)) {
          tweens.push({ prop, from: from?.[prop], to: value, at, duration, ease: ease2, order: this.order++ });
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
      await Promise.all(FONT_FACES.map((f2) => document.fonts.load(`${f2.style} ${f2.weight.split(" ")[0]} 48px '${f2.family}'`)));
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

  // packages/motion/src/blocks/art.ts
  var ART_THEMES = [
    { sky: ["#2B1B4A", "#E8577A", "#FFB36B"], sun: "#FFE7B0", land: ["#9A3F6A", "#5E2257", "#331341", "#170A26"] },
    { sky: ["#6FB6F2", "#D6EEFF"], sun: "#FFF8DD", land: ["#B4DD7A", "#78B84D", "#438D3C", "#21582A"] },
    { sky: ["#0B2340", "#3E7CB1", "#BFE3F2"], sun: "#F4FBFF", land: ["#A9D2E6", "#6FA3C8", "#3B6E99", "#1C3F66"] },
    { sky: ["#F09A5B", "#F9D9A8"], sun: "#FFF4E0", land: ["#E3925A", "#C2683C", "#924329", "#55261A"] },
    { sky: ["#0A0630", "#3B0F70", "#FF3D81"], sun: "#FFD1E8", land: ["#6A1F99", "#41106E", "#24084B", "#110328"] },
    { sky: ["#BDEFE0", "#F0FFF9"], sun: "#FFFFFF", land: ["#86DBBC", "#43B597", "#1F8570", "#0E4F46"] },
    { sky: ["#FF7A5C", "#FFC9A3"], sun: "#FFF0D6", land: ["#F05A4F", "#B83147", "#7A1C3C", "#3D0D27"] },
    { sky: ["#1B1F3B", "#4C5FD7", "#9FD3FF"], sun: "#FFFFFF", land: ["#5A6FE0", "#3445B5", "#1E2A7D", "#0E1446"] }
  ];
  function artTheme(n) {
    const k = ART_THEMES.length;
    return ART_THEMES[(Math.trunc(n) % k + k) % k];
  }
  var f = (n) => n.toFixed(1);
  function ridge(w, h, base, amp, rnd, jag = false) {
    const waves = [0, 1, 2].map((k) => ({ freq: (1.2 + rnd() * 1.6) * (k + 1) * Math.PI / w, phase: rnd() * Math.PI * 2, amp: amp / (k + 1.3) }));
    const steps = jag ? 14 : 48;
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
      const x = w * i / steps;
      let y = base;
      for (const wv of waves) y += Math.sin(x * wv.freq + wv.phase) * wv.amp;
      if (jag) y += (rnd() - 0.5) * amp * 1.4;
      pts.push(`${i === 0 ? "M" : "L"}${f(x)},${f(y)}`);
    }
    return `${pts.join(" ")} L${f(w)},${f(h)} L0,${f(h)} Z`;
  }
  function skyGradient(id, sky) {
    const stops = sky.map((c, i) => `<stop offset="${sky.length === 1 ? 0 : i / (sky.length - 1)}" stop-color="${c}"/>`).join("");
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
  }
  function landscape(kind, w, h, theme, rnd) {
    const sunX = w * (0.25 + rnd() * 0.5);
    const sunY = h * (kind === "sea" ? 0.5 : 0.3 + rnd() * 0.12);
    const sunR = Math.min(w, h) * (0.09 + rnd() * 0.05);
    let body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
    body += `<circle cx="${f(sunX)}" cy="${f(sunY)}" r="${f(sunR * 2.6)}" fill="${theme.sun}" opacity="0.18"/>`;
    body += `<circle cx="${f(sunX)}" cy="${f(sunY)}" r="${f(sunR)}" fill="${theme.sun}"/>`;
    if (kind === "sea") {
      const horizon = h * 0.55;
      body += `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.land[1]}"/><stop offset="1" stop-color="${theme.land[3]}"/></linearGradient>`;
      body += `<rect y="${f(horizon)}" width="${w}" height="${f(h - horizon)}" fill="url(#sea)"/>`;
      for (let i = 0; i < 9; i += 1) {
        const y = horizon + (h - horizon) * ((i + 0.5) / 9) ** 1.6;
        const half = sunR * (0.4 + i * 0.22);
        body += `<rect x="${f(sunX - half)}" y="${f(y)}" width="${f(half * 2)}" height="${f(3 + i * 1.5)}" rx="2" fill="${theme.sun}" opacity="${f(0.75 - i * 0.07)}"/>`;
      }
      body += `<path d="${ridge(w, h, h * 0.86, h * 0.03, rnd)}" fill="${theme.land[3]}"/>`;
      return body;
    }
    const layers = theme.land.length;
    theme.land.forEach((color, i) => {
      const base = h * (0.5 + i / layers * 0.38);
      const amp = h * (kind === "peaks" ? 0.12 - i * 0.02 : kind === "dunes" ? 0.05 : 0.06 - i * 8e-3);
      body += `<path d="${ridge(w, h, base, amp, rnd, kind === "peaks" && i < 2)}" fill="${color}"/>`;
    });
    return body;
  }
  function orb(w, h, theme, rnd) {
    const r = Math.min(w, h) * (0.28 + rnd() * 0.06);
    const cx = w * (0.45 + rnd() * 0.1);
    const cy = h * (0.46 + rnd() * 0.06);
    return `<radialGradient id="orb" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${theme.sun}"/><stop offset="0.45" stop-color="${theme.sky[theme.sky.length - 1]}"/><stop offset="1" stop-color="${theme.land[1]}"/></radialGradient><rect width="${w}" height="${h}" fill="url(#sky)"/><ellipse cx="${f(cx + r * 0.15)}" cy="${f(cy + r * 1.08)}" rx="${f(r * 0.9)}" ry="${f(r * 0.14)}" fill="${theme.land[3]}" opacity="0.35"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#orb)"/>`;
  }
  function bloom(w, h, theme, rnd) {
    const cx = w / 2;
    const cy = h * 0.48;
    const R = Math.min(w, h) * 0.36;
    const petals = 7 + Math.floor(rnd() * 5);
    let body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
    for (let ring = 0; ring < 2; ring += 1) {
      for (let i = 0; i < petals; i += 1) {
        const a = i / petals * 360 + ring * (180 / petals);
        const len = R * (ring === 0 ? 1 : 0.62);
        body += `<ellipse cx="${f(cx)}" cy="${f(cy - len / 2)}" rx="${f(len * 0.22)}" ry="${f(len / 2)}" fill="${theme.land[ring]}" opacity="0.92" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})"/>`;
      }
    }
    body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.18)}" fill="${theme.sun}"/>`;
    return body;
  }
  function mascot(w, h, theme, rnd) {
    const cx = w / 2;
    const cy = h * 0.56;
    const R = Math.min(w, h) * 0.3;
    const body = theme.land[0];
    const shade = theme.land[2];
    const pts = [];
    const bumps = rnd() * Math.PI * 2;
    for (let i = 0; i <= 40; i += 1) {
      const a = i / 40 * Math.PI * 2;
      const rr = R * (1 + 0.035 * Math.sin(a * 3 + bumps));
      pts.push(`${i === 0 ? "M" : "L"}${f(cx + Math.cos(a) * rr * 1.05)},${f(cy + Math.sin(a) * rr * (a > 0 && a < Math.PI ? 0.88 : 1))}`);
    }
    const eye = (dx) => `<ellipse cx="${f(cx + dx)}" cy="${f(cy - R * 0.12)}" rx="${f(R * 0.15)}" ry="${f(R * 0.19)}" fill="#fff"/><circle cx="${f(cx + dx + R * 0.03)}" cy="${f(cy - R * 0.09)}" r="${f(R * 0.085)}" fill="#14101E"/><circle cx="${f(cx + dx + R * 0.06)}" cy="${f(cy - R * 0.14)}" r="${f(R * 0.03)}" fill="#fff"/>`;
    return `<radialGradient id="body" cx="0.38" cy="0.3" r="0.85"><stop offset="0" stop-color="${theme.sun}"/><stop offset="0.35" stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></radialGradient><rect width="${w}" height="${h}" fill="url(#sky)"/><ellipse cx="${f(cx)}" cy="${f(cy + R * 0.98)}" rx="${f(R * 0.85)}" ry="${f(R * 0.12)}" fill="${theme.land[3]}" opacity="0.3"/><path d="M${f(cx + R * 0.1)},${f(cy - R * 0.92)} Q${f(cx + R * 0.25)},${f(cy - R * 1.3)} ${f(cx + R * 0.42)},${f(cy - R * 1.42)}" stroke="${shade}" stroke-width="${f(R * 0.06)}" fill="none" stroke-linecap="round"/><circle cx="${f(cx + R * 0.44)}" cy="${f(cy - R * 1.46)}" r="${f(R * 0.12)}" fill="${theme.sun}"/><path d="${pts.join(" ")} Z" fill="url(#body)"/>` + eye(-R * 0.32) + eye(R * 0.32) + `<ellipse cx="${f(cx - R * 0.55)}" cy="${f(cy + R * 0.18)}" rx="${f(R * 0.12)}" ry="${f(R * 0.07)}" fill="${theme.sky[0]}" opacity="0.5"/><ellipse cx="${f(cx + R * 0.55)}" cy="${f(cy + R * 0.18)}" rx="${f(R * 0.12)}" ry="${f(R * 0.07)}" fill="${theme.sky[0]}" opacity="0.5"/><path d="M${f(cx - R * 0.14)},${f(cy + R * 0.2)} Q${f(cx)},${f(cy + R * 0.34)} ${f(cx + R * 0.14)},${f(cy + R * 0.2)}" stroke="#14101E" stroke-width="${f(R * 0.045)}" fill="none" stroke-linecap="round"/>`;
  }
  function artSvg(kind, theme, w, h, seed) {
    const rnd = mulberry32(seed);
    const scene = kind === "orb" ? orb(w, h, theme, rnd) : kind === "bloom" ? bloom(w, h, theme, rnd) : kind === "mascot" ? mascot(w, h, theme, rnd) : landscape(kind, w, h, theme, rnd);
    const grain = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 1e3}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.09 0"/></filter>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${skyGradient("sky", theme.sky)}${grain}</defs>${scene}<rect width="${w}" height="${h}" filter="url(#grain)"/></svg>`;
  }
  function artUrl(kind, theme, w, h, seed) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(kind, theme, Math.round(w), Math.round(h), seed))}`;
  }
  async function artImage(doc, kind, theme, w, h, seed) {
    const svg = artUrl(kind, theme, w, h, seed);
    const img = doc.createElement("img");
    img.src = svg;
    const canvas = doc.createElement("canvas");
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const g = canvas.getContext("2d");
    if (!g) return svg;
    try {
      await img.decode();
    } catch {
      return svg;
    }
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob2 = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob2 ? URL.createObjectURL(blob2) : svg;
  }

  // packages/motion/src/blocks/dot_grid_reveal/block.ts
  var ease = (u) => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
  var easeIn = (u) => Math.min(1, Math.max(0, u)) ** 2;
  async function sample(doc, url, cols, rows, W, H) {
    const img = doc.createElement("img");
    img.src = url;
    try {
      await img.decode();
    } catch {
      return null;
    }
    const canvas = doc.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g || !img.naturalWidth) return null;
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const sw = W / k;
    const sh = H / k;
    g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, cols, rows);
    return g.getImageData(0, 0, cols, rows).data;
  }
  function hexRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  async function build(ctx) {
    const { tl, params: p, width: W, height: H, palette } = ctx;
    const S = ctx.seconds;
    const cell = Number(p.cell);
    const cols = Math.ceil(W / cell) + 1;
    const rows = Math.ceil(H / cell) + 1;
    const offX = (W - (cols - 1) * cell) / 2;
    const offY = (H - (rows - 1) * cell) / 2;
    const cx = W / 2;
    const cy = H / 2;
    const stage = ctx.el("div", "dg-stage");
    const photo = ctx.el("img", "dg-photo", stage);
    photo.alt = "";
    const ref = ctx.media.media;
    let url;
    if (ref?.kind === "video") url = frameUrl(ref, 0);
    else if (ref?.kind === "image") url = ref.url;
    else url = await artImage(ctx.doc, String(p.scene), artTheme(ctx.seed - 1), W, H, ctx.seed);
    photo.src = url;
    const canvas = ctx.el("canvas", "dg-canvas", stage);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const pixels = await sample(ctx.doc, url, cols, rows, W, H);
    const accent = hexRgb(palette.accent);
    const mono = p.dots === "accent";
    const maxDist = Math.hypot(cx, cy);
    const rgbAt = (o) => pixels ? [pixels[o], pixels[o + 1], pixels[o + 2]] : [128, 128, 128];
    const lums = Array.from({ length: cols * rows }, (_, n) => {
      const [r, g, b] = rgbAt(n * 4);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });
    const sorted = [...lums].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.05)];
    const hi = Math.max(lo + 0.05, sorted[Math.floor(sorted.length * 0.95)]);
    const cells = [];
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const x = offX + i * cell;
        const y = offY + j * cell;
        const n = j * cols + i;
        const lum = Math.min(1, Math.max(0, (lums[n] - lo) / (hi - lo)));
        const ink = palette.dark ? lum : 1 - lum;
        cells.push({ x, y, dist: Math.hypot(x - cx, y - cy) / maxDist, rgb: mono ? accent : rgbAt(n * 4), tone: 0.08 + 0.5 * Math.sqrt(ink) });
      }
    }
    const land = 0.15;
    const multiply = 0.75;
    const tone = multiply + 0.6;
    const resolve = p.resolve !== false;
    const close = Math.max(tone + 0.8, S - 1.85);
    const seed0 = cell * 0.18;
    ctx.cue(land, "pop", { weight: 0.4, at: { x: cx, y: cy } });
    ctx.cue(multiply, "whoosh", { weight: 0.4, at: { x: cx, y: cy } });
    if (resolve) ctx.cue(close + 0.4, "reveal", { weight: 0.6 });
    tl.track((t) => {
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (t >= land && t < multiply + 0.4) {
        const pop = Math.min(1, (t - land) / 0.3);
        const back = 1 + 0.06 * Math.sin(Math.PI * pop) * (pop < 1 ? 1 : 0);
        const shrink = ease((t - multiply) / 0.4);
        const r = cell * 1.4 * ease(pop) * back * (1 - shrink) + seed0 * shrink;
        g.fillStyle = palette.accent;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      if (t < multiply) return;
      const closing = resolve ? easeIn((t - close) / 0.9) : 0;
      for (const c of cells) {
        const born = multiply + c.dist * 0.5;
        if (t < born) continue;
        const grow = ease((t - born) / 0.35);
        const toned = ease((t - tone - c.dist * 0.3) / 0.5);
        const radius = cell * ((0.18 * (1 - toned) + c.tone * toned) * (1 - closing) + 0.75 * closing) * grow;
        if (radius < 0.4) continue;
        const k = toned;
        g.fillStyle = `rgb(${Math.round(accent[0] + (c.rgb[0] - accent[0]) * k)},${Math.round(accent[1] + (c.rgb[1] - accent[1]) * k)},${Math.round(accent[2] + (c.rgb[2] - accent[2]) * k)})`;
        g.beginPath();
        g.arc(c.x, c.y, radius, 0, Math.PI * 2);
        g.fill();
      }
    });
    if (ref?.kind === "video") tl.track(videoTrack(photo, ref, ctx.pending, close + 0.4));
    tl.set(photo, { opacity: 0 }, 0);
    if (resolve) {
      tl.fromTo(photo, { opacity: 0 }, { opacity: 1 }, { at: close + 0.4, duration: 0.4, ease: "smooth" });
      tl.to(canvas, { opacity: 0 }, { at: close + 0.6, duration: 0.3, ease: "smooth" });
    }
    tl.fromTo(stage, { scale: 1.06 }, { scale: 1 }, { at: 0, duration: S, ease: "out" });
  }

  // packages/motion/src/blocks/dot_grid_reveal/dot_grid_reveal-entry.ts
  defineBlock(build);
})();
