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
  function splitText(el, options = {}) {
    const doc = el.ownerDocument;
    const text = el.textContent ?? "";
    el.textContent = "";
    const words = [];
    const chars = [];
    const tokens = text.split(/(\s+)/).filter((s) => s.length > 0);
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        el.append(doc.createTextNode(" "));
        continue;
      }
      const word = doc.createElement("span");
      word.className = "word";
      word.style.display = "inline-block";
      word.style.whiteSpace = "nowrap";
      if (options.chars) {
        for (const c of Array.from(token)) {
          const ch = doc.createElement("span");
          ch.className = "char";
          ch.style.display = "inline-block";
          ch.textContent = c;
          word.append(ch);
          chars.push(ch);
        }
      } else {
        word.textContent = token;
      }
      el.append(word);
      words.push(word);
    }
    const out = { words, chars, lines: [], lineInners: [] };
    if (options.lines) groupLines(el, out);
    return out;
  }
  function groupLines(el, split) {
    const doc = el.ownerDocument;
    const rows = [];
    let lastTop;
    for (const word of split.words) {
      const top = Math.round(word.offsetTop);
      if (lastTop === void 0 || Math.abs(top - lastTop) > 2) rows.push([]);
      rows[rows.length - 1].push(word);
      lastTop = top;
    }
    el.textContent = "";
    for (const row of rows) {
      const line2 = doc.createElement("span");
      line2.className = "line";
      line2.style.display = "block";
      line2.style.overflow = "hidden";
      const inner = doc.createElement("span");
      inner.className = "line-inner";
      inner.style.display = "inline-block";
      row.forEach((word, i) => {
        if (i > 0) inner.append(doc.createTextNode(" "));
        inner.append(word);
      });
      line2.append(inner);
      el.append(line2);
      split.lines.push(line2);
      split.lineInners.push(inner);
    }
  }
  function formatNumber(value, format2 = {}) {
    const decimals = format2.decimals ?? 0;
    const sep = format2.separator ?? ",";
    const fixed = Math.abs(value).toFixed(decimals);
    const [whole, frac] = fixed.split(".");
    const grouped = sep ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : whole;
    const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
    return `${format2.prefix ?? ""}${sign}${grouped}${frac ? `.${frac}` : ""}${format2.suffix ?? ""}`;
  }
  function counterValue(t, options) {
    const ease = resolveEase(options.ease ?? "out");
    const p = Math.min(1, Math.max(0, (t - options.at) / (options.duration ?? 1.2)));
    return options.from + (options.to - options.from) * ease(p);
  }
  function counter(el, options) {
    return (t) => {
      const shown = formatNumber(counterValue(t, options), options);
      if (el.textContent !== shown) el.textContent = shown;
    };
  }

  // packages/motion/src/blocks/ui.ts
  function fitWidth(el, lines, maxWidth, maxSize, minSize = 24) {
    const probe = 100;
    el.style.fontSize = `${probe}px`;
    const widest = Math.max(1, ...lines.map((l) => l.scrollWidth || l.getBoundingClientRect().width));
    const size = Math.max(minSize, Math.min(maxSize, probe * maxWidth / widest));
    el.style.fontSize = `${size}px`;
    return size;
  }
  function onColor(bg) {
    const m = /^#?([0-9a-f]{6})/i.exec(bg.trim());
    if (!m) return "#FFFFFF";
    const lin = (i) => {
      const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#0B0B0F";
  }

  // packages/motion/src/blocks/chart_build/scale.ts
  function parseValue(text) {
    const n = Number(String(text).replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  function niceMax(max) {
    if (!(max > 0)) return 1;
    const unit = 10 ** Math.floor(Math.log10(max));
    for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * unit >= max - 1e-9) return step * unit;
    return 10 * unit;
  }
  function highlightIndex(values, asked, last) {
    if (asked >= 0 && asked < values.length) return asked;
    if (last) return values.length - 1;
    let best = 0;
    values.forEach((v, i) => {
      if (v > values[best]) best = i;
    });
    return best;
  }
  function percentChange(from, to) {
    if (from === 0) return "";
    const pct = Math.round((to - from) / Math.abs(from) * 100);
    return `${pct > 0 ? "+" : pct < 0 ? "\u2212" : "\xB1"}${Math.abs(pct)}%`;
  }

  // packages/motion/src/blocks/chart_build/block.ts
  var SVG = "http://www.w3.org/2000/svg";
  function easeInverse(ease, y) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i += 1) {
      const mid = (lo + hi) / 2;
      if (ease(mid) < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function build(ctx) {
    const { tl, params: p, width: W, height: H, safe, palette } = ctx;
    const kind = String(p.kind);
    const values = p.values.slice(0, kind === "donut" ? 6 : 8).map((v) => Math.max(0, parseValue(v)));
    const labels = p.labels;
    const hi = highlightIndex(values, Number(p.highlight), kind === "line");
    const fmt = { prefix: String(p.prefix ?? ""), suffix: String(p.suffix ?? ""), decimals: Number(p.decimals) };
    const rest = typeof p.rest === "string" ? p.rest : palette.ink;
    const accent = palette.accent;
    const k = Math.min(1, ctx.seconds / 5);
    const growAt = 0.5 * k;
    const growFor = 0.9 * k;
    const climax = 2.2 * k;
    const side = W > H * 1.3;
    const contentW = W - safe.left - safe.right;
    const plateKind = String(p.plate ?? "auto");
    if (plateKind === "glass" || plateKind === "solid" || plateKind === "auto" && ctx.alpha) {
      const pad = Math.min(48, safe.left * 0.8, safe.top * 0.8);
      const plate = ctx.el("div", `cb-plate${plateKind === "solid" ? " is-solid" : ""}`);
      Object.assign(plate.style, { left: `${safe.left - pad}px`, top: `${safe.top - pad}px`, width: `${contentW + 2 * pad}px`, height: `${H - safe.top - safe.bottom + 2 * pad}px` });
      tl.fromTo(plate, { y: H * 0.03, scale: 0.98, opacity: 0, blur: 10 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: 0, duration: 0.6, ease: "out" });
    }
    const head = ctx.el("div", "cb-head");
    Object.assign(head.style, { left: `${safe.left}px`, top: `${safe.top}px`, width: `${side ? contentW * 0.38 : contentW}px` });
    if (side) Object.assign(head.style, { height: `${H - safe.top - safe.bottom - 40}px`, justifyContent: "space-between" });
    const title = p.title ? ctx.el("div", "cb-title", head, String(p.title)) : null;
    const bigHost = kind === "donut" ? null : ctx.el("div", "cb-big", head);
    const big = bigHost ? numberParts(ctx, bigHost, fmt) : null;
    if (big && bigHost) {
      big.num.textContent = formatNumber(values[hi], { decimals: fmt.decimals });
      fitWidth(bigHost, [bigHost], side ? contentW * 0.38 : contentW, side ? 330 : 280, 80);
      bigHost.style.fontWeight = ctx.display === "sans" ? "300" : "400";
      tl.track(counter(big.num, { from: 0, to: values[hi], at: growAt, duration: growFor + 0.5 * k, ease: "out", decimals: fmt.decimals }));
      cueCount(ctx, big.num, values[hi], fmt.decimals, growAt, growFor + 0.5 * k);
      tl.fromTo(bigHost, { y: 40, opacity: 0, blur: 10 }, { y: 0, opacity: 1, blur: 0 }, { at: 0.15, duration: 0.7, ease: "out" });
    }
    if (title) {
      const split = splitText(title, { lines: true });
      tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: 0, duration: 0.7, ease: "out", stagger: 0.12 });
    }
    const headBottom = safe.top + (side ? 0 : head.getBoundingClientRect().height);
    const region = side ? { x: safe.left + contentW * 0.45, y: safe.top, w: contentW * 0.55, h: H - safe.top - safe.bottom } : { x: safe.left, y: headBottom + 70, w: contentW, h: H - safe.bottom - headBottom - 70 };
    const badgeText = String(p.caption ?? "") || (kind === "donut" || hi === 0 ? "" : [percentChange(values[0], values[hi]), labels[0] ? `vs ${labels[0]}` : ""].filter(Boolean).join(" "));
    const badge = badgeText ? ctx.el("div", "cb-badge", ctx.root, badgeText) : null;
    if (badge) badge.style.color = onColor(accent);
    const at = { growAt, growFor, climax };
    if (kind === "bar") bars(ctx, region, values, labels, hi, fmt, rest, badge, at);
    else if (kind === "line") line(ctx, region, values, labels, hi, fmt, rest, badge, at);
    else donut(ctx, region, side, values, labels, hi, fmt, rest, badge, at, headBottom);
  }
  function numberParts(ctx, host, fmt) {
    if (fmt.prefix) ctx.el("span", "cb-affix", host, fmt.prefix);
    const num = ctx.el("span", "cb-num", host);
    if (fmt.suffix) ctx.el("span", "cb-affix", host, fmt.suffix);
    return { num };
  }
  function cueCount(ctx, el, to, decimals, at, duration) {
    const changes = to * 10 ** decimals;
    if (changes >= 1 && duration > 0) ctx.cue(at, "tick", { weight: 0.25, at: el, until: at + duration, rate: Math.min(20, changes / duration) });
  }
  function landBadge(ctx, badge, x, y, region, at) {
    if (!badge) return;
    const w = badge.getBoundingClientRect().width;
    const h = badge.getBoundingClientRect().height;
    const left = Math.max(region.x, Math.min(region.x + region.w - w, x - w / 2));
    Object.assign(badge.style, { left: `${left}px`, top: `${y - h - 18}px` });
    badge.style.setProperty("--notch", `${x - left}px`);
    ctx.tl.fromTo(badge, { y: 18, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1 }, { at, duration: 0.5, ease: "out" });
    ctx.cue(at, "pop", { weight: 0.4, at: badge });
  }
  function valueSize(values, fmt, room) {
    const longest = Math.max(...values.map((v) => formatNumber(v, fmt).length));
    return Math.max(18, Math.min(34, room * 1.7 / Math.max(1, longest)));
  }
  function bars(ctx, region, values, labels, hi, fmt, rest, badge, at) {
    const { tl, palette } = ctx;
    const n = values.length;
    const badgeRoom = badge ? 90 : 0;
    const valueRoom = 52;
    const labelRoom = 58;
    const plotH = Math.max(1, region.h - badgeRoom - valueRoom - labelRoom);
    const top = niceMax(Math.max(...values));
    const gap = 0.38;
    const bw = Math.min(region.w / (n + (n - 1) * gap), region.w * 0.24);
    const groupW = bw * (n + (n - 1) * gap);
    const x0 = region.x + (region.w - groupW) / 2;
    const baseY = region.y + badgeRoom + valueRoom + plotH;
    const size = valueSize(values, fmt, bw);
    const base = ctx.el("div", "cb-base");
    Object.assign(base.style, { left: `${x0 - 12}px`, top: `${baseY}px`, width: `${groupW + 24}px` });
    tl.fromTo(base, { scaleX: 0 }, { scaleX: 1 }, { at: 0.25, duration: 0.6, ease: "in-out" });
    const each = n > 1 ? Math.min(0.08, 0.45 / (n - 1)) : 0;
    const barEls = [];
    values.forEach((v, i) => {
      const x = x0 + i * bw * (1 + gap);
      const h = Math.max(4, v / top * plotH);
      const bar = ctx.el("div", "cb-bar");
      Object.assign(bar.style, { left: `${x}px`, top: `${baseY - h}px`, width: `${bw}px`, height: `${h}px`, background: rest });
      barEls.push(bar);
      const val = ctx.el("div", "cb-val");
      Object.assign(val.style, { left: `${x - bw}px`, width: `${bw * 3}px`, top: `${baseY - h - valueRoom + 4}px`, fontSize: `${size}px` });
      const start = at.growAt + i * each;
      tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1 }, { at: start, duration: at.growFor, ease: "out" });
      ctx.cue(start, "pop", { weight: 0.3, at: { x: x + bw / 2, y: baseY - h / 2 } });
      tl.fromTo(val, { y: h, opacity: 0 }, { y: 0, opacity: 1 }, { at: start, duration: at.growFor, ease: "out" });
      tl.track(counter(val, { from: 0, to: v, at: start, duration: at.growFor, ease: "out", ...fmt }));
      if (labels[i]) {
        const cat = ctx.el("div", "cb-cat", ctx.root, labels[i]);
        Object.assign(cat.style, { left: `${x - bw}px`, width: `${bw * 3}px`, top: `${baseY + 16}px` });
        tl.fromTo(cat, { y: -10, opacity: 0 }, { y: 0, opacity: 1 }, { at: start + 0.1, duration: 0.5, ease: "out" });
      }
      if (i === hi) {
        tl.fromTo(val, { color: palette.ink }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
        landBadge(ctx, badge, x + bw / 2, baseY - h - valueRoom + 6, region, at.climax + 0.12);
      }
    });
    tl.fromTo(barEls[hi], { backgroundColor: rest }, { backgroundColor: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
    ctx.cue(at.climax, "land", { weight: 0.5, at: barEls[hi] });
    tl.to(barEls.filter((_, i) => i !== hi), { opacity: 0.32 }, { at: at.climax, duration: 0.45, ease: "smooth" });
  }
  function svgIn(ctx) {
    const svg = ctx.doc.createElementNS(SVG, "svg");
    svg.setAttribute("class", "cb-svg");
    svg.setAttribute("viewBox", `0 0 ${ctx.width} ${ctx.height}`);
    svg.setAttribute("width", String(ctx.width));
    svg.setAttribute("height", String(ctx.height));
    ctx.root.append(svg);
    return svg;
  }
  function node(ctx, parent, tag, attrs) {
    const el = ctx.doc.createElementNS(SVG, tag);
    for (const [key, v] of Object.entries(attrs)) el.setAttribute(key, String(v));
    parent.append(el);
    return el;
  }
  function line(ctx, region, values, labels, hi, fmt, rest, badge, at) {
    const { tl, palette } = ctx;
    const n = values.length;
    const badgeRoom = badge ? 150 : 70;
    const labelRoom = 58;
    const pad = 24;
    const top = niceMax(Math.max(...values));
    const y0 = region.y + badgeRoom;
    const baseY = region.y + region.h - labelRoom;
    const plotH = Math.max(1, baseY - y0);
    const xs = values.map((_, i) => region.x + pad + (region.w - pad * 2) * i / Math.max(1, n - 1));
    const ys = values.map((v) => baseY - v / top * plotH);
    const svg = svgIn(ctx);
    [0, 0.5, 1].forEach((f, i) => {
      const y = baseY - f * plotH;
      const rule = node(ctx, svg, "line", { x1: region.x, y1: y, x2: region.x + region.w, y2: y, class: f === 0 ? "cb-axis" : "cb-rule" });
      rule.style.transformOrigin = `${region.x}px ${y}px`;
      tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1 }, { at: 0.2 + i * 0.06, duration: 0.7, ease: "in-out" });
      if (f > 0) {
        const tick = ctx.el("div", "cb-tick", ctx.root, formatNumber(top * f, { ...fmt, decimals: top * f < 10 ? fmt.decimals : 0 }));
        Object.assign(tick.style, { left: `${region.x}px`, width: "200px", top: `${y - 36}px` });
        tl.fromTo(tick, { opacity: 0 }, { opacity: 1 }, { at: 0.5 + i * 0.06, duration: 0.4, ease: "linear" });
      }
    });
    const draw = node(ctx, svg, "g", {});
    const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
    const area = node(ctx, draw, "polygon", { points: `${xs[0]},${baseY} ${pts} ${xs[n - 1]},${baseY}`, class: "cb-area" });
    area.style.fill = rest;
    const stroke = node(ctx, draw, "polyline", { points: pts, class: "cb-line" });
    stroke.style.stroke = rest;
    const ease = resolveEase("in-out");
    const span = xs[n - 1] - xs[0];
    const drawFor = at.growFor + 0.4;
    const clipAt = (t) => ease(Math.min(1, Math.max(0, (t - at.growAt) / drawFor)));
    const pen = node(ctx, svg, "circle", { r: 11, class: "cb-pen" });
    pen.style.fill = rest;
    tl.track((t) => {
      const q = clipAt(t);
      draw.style.clipPath = q >= 1 ? "" : `inset(-20px ${(1 - q) * (span + 12) - 6}px -20px -20px)`;
      const x = xs[0] + q * span;
      let j = 0;
      while (j < n - 2 && xs[j + 1] < x) j += 1;
      const f = (x - xs[j]) / Math.max(1, xs[j + 1] - xs[j]);
      pen.setAttribute("cx", String(x));
      pen.setAttribute("cy", String(ys[j] + (ys[j + 1] - ys[j]) * Math.min(1, Math.max(0, f))));
      pen.style.opacity = t < at.growAt || q >= 1 ? "0" : "1";
    });
    const dots = xs.map((x, i) => {
      const dot = node(ctx, svg, "circle", { cx: x, cy: ys[i], r: 9, class: "cb-dot" });
      dot.style.fill = palette.paper;
      dot.style.stroke = rest;
      dot.style.transformOrigin = `${x}px ${ys[i]}px`;
      const when = at.growAt + drawFor * easeInverse(ease, (x - xs[0]) / Math.max(1, span));
      tl.fromTo(dot, { scale: 0 }, { scale: 1 }, { at: when, duration: 0.3, ease: "out" });
      ctx.cue(when, "pop", { weight: 0.3, at: { x, y: ys[i] } });
      return dot;
    });
    labels.slice(0, n).forEach((label, i) => {
      if (!label) return;
      const cat = ctx.el("div", "cb-cat", ctx.root, label);
      Object.assign(cat.style, { left: `${xs[i] - 100}px`, width: "200px", top: `${baseY + 16}px` });
      tl.fromTo(cat, { opacity: 0 }, { opacity: 1 }, { at: at.growAt + i * 0.05, duration: 0.4, ease: "linear" });
    });
    const hx = xs[hi];
    const hy = ys[hi];
    const guide = node(ctx, svg, "line", { x1: hx, y1: hy, x2: hx, y2: baseY, class: "cb-guide" });
    guide.style.transformOrigin = `${hx}px ${hy}px`;
    guide.style.stroke = palette.accent;
    tl.fromTo(guide, { scaleY: 0 }, { scaleY: 1 }, { at: at.climax, duration: 0.5, ease: "in-out" });
    const halo = node(ctx, svg, "circle", { cx: hx, cy: hy, r: 26, class: "cb-halo" });
    halo.style.fill = palette.accent;
    halo.style.transformOrigin = `${hx}px ${hy}px`;
    tl.fromTo(halo, { scale: 0, opacity: 0 }, { scale: 1, opacity: 0.22 }, { at: at.climax, duration: 0.5, ease: "out" });
    ctx.cue(at.climax, "land", { weight: 0.5, at: { x: hx, y: hy } });
    tl.fromTo(dots[hi], { scale: 1, fill: palette.paper, stroke: rest }, { scale: 1.5, fill: palette.accent, stroke: palette.accent }, { at: at.climax, duration: 0.35, ease: "out" });
    tl.to([stroke, area], { opacity: 0.7 }, { at: at.climax, duration: 0.45, ease: "smooth" });
    const val = ctx.el("div", "cb-val", ctx.root, formatNumber(values[hi], fmt));
    const size = 34;
    Object.assign(val.style, { left: `${hx - 150}px`, width: "300px", top: `${hy - 74}px`, fontSize: `${size}px`, color: palette.accent });
    tl.fromTo(val, { y: 12, opacity: 0 }, { y: 0, opacity: 1 }, { at: at.climax + 0.05, duration: 0.45, ease: "out" });
    landBadge(ctx, badge, hx, hy - 84, region, at.climax + 0.15);
  }
  function donut(ctx, region, side, values, labels, hi, fmt, rest, badge, at, headBottom) {
    const { tl, palette } = ctx;
    const n = values.length;
    const total = Math.max(1e-9, values.reduce((a, b) => a + b, 0));
    const legendRows = n * 64;
    const d = side ? Math.min(region.h * 0.86, region.w * 0.56) : Math.min(region.w * 0.78, region.h - legendRows - 90);
    const sw = d * 0.15;
    const r = (d - sw) / 2;
    const cx = side ? region.x + d / 2 : region.x + region.w / 2;
    const cy = side ? region.y + region.h / 2 : region.y + d / 2;
    const C = 2 * Math.PI * r;
    const svg = svgIn(ctx);
    const ring = node(ctx, svg, "g", { transform: `rotate(-90 ${cx} ${cy})` });
    const trackRing = node(ctx, ring, "circle", { cx, cy, r, class: "cb-ring" });
    trackRing.style.strokeWidth = String(sw);
    tl.fromTo(trackRing, { opacity: 0 }, { opacity: 1 }, { at: 0.2, duration: 0.5, ease: "linear" });
    const fractions = values.map((v) => v / total);
    const starts = fractions.map((_, i) => fractions.slice(0, i).reduce((a, b) => a + b, 0));
    const gap = n > 1 ? 6e-3 : 0;
    const tones = [1, 0.62, 0.42, 0.28, 0.18, 0.12];
    let toneIndex = 0;
    const sweepFor = at.growFor + 0.5;
    const ease = resolveEase("in-out");
    const arcs = values.map((_, i) => {
      const arc = node(ctx, ring, "circle", { cx, cy, r, class: "cb-arc" });
      arc.style.strokeWidth = String(sw);
      arc.style.stroke = rest;
      arc.style.opacity = String(i === hi ? 1 : tones[Math.min(tones.length - 1, toneIndex++)]);
      arc.setAttribute("stroke-dashoffset", String(-starts[i] * C));
      return arc;
    });
    tl.track((t) => {
      const q = ease(Math.min(1, Math.max(0, (t - at.growAt) / sweepFor)));
      arcs.forEach((arc, i) => {
        const len = Math.max(0, Math.min(fractions[i] - gap, q - starts[i])) * C;
        arc.setAttribute("stroke-dasharray", `${len.toFixed(2)} ${C.toFixed(2)}`);
      });
    });
    values.forEach((_, i) => ctx.cue(at.growAt + starts[i] * sweepFor, "pop", { weight: 0.25, at: { x: cx, y: cy } }));
    tl.fromTo(arcs[hi], { stroke: rest, strokeWidth: sw }, { stroke: palette.accent, strokeWidth: sw * 1.22 }, { at: at.climax, duration: 0.4, ease: "out" });
    ctx.cue(at.climax, "land", { weight: 0.5, at: { x: cx, y: cy } });
    arcs.forEach((arc, i) => {
      if (i !== hi) tl.fromTo(arc, { opacity: Number(arc.style.opacity) }, { opacity: 0.16 }, { at: at.climax, duration: 0.45, ease: "smooth" });
    });
    const centre = ctx.el("div", "cb-centre");
    const numHost = ctx.el("div", "cb-big", centre);
    const parts = numberParts(ctx, numHost, fmt);
    parts.num.textContent = formatNumber(values[hi], { decimals: fmt.decimals });
    fitWidth(numHost, [numHost], r * 1.25, r * 0.62, 40);
    numHost.style.fontWeight = ctx.display === "sans" ? "300" : "400";
    const sub = labels[hi] ? ctx.el("div", "cb-sub", centre, labels[hi]) : null;
    Object.assign(centre.style, { left: `${cx}px`, top: `${cy}px` });
    tl.set(centre, { xPercent: -50, yPercent: -50 }, 0);
    tl.track(counter(parts.num, { from: 0, to: values[hi], at: at.growAt, duration: sweepFor, ease: "out", decimals: fmt.decimals }));
    cueCount(ctx, parts.num, values[hi], fmt.decimals, at.growAt, sweepFor);
    tl.fromTo(numHost, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }, { at: at.growAt, duration: 0.6, ease: "out" });
    if (sub) {
      tl.fromTo(sub, { opacity: 0 }, { opacity: 1 }, { at: at.growAt + 0.3, duration: 0.4, ease: "linear" });
      tl.fromTo(sub, { color: palette.muted }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
    }
    const legend = ctx.el("div", "cb-legend");
    const lx = side ? cx + d / 2 + 80 : region.x + region.w * 0.12;
    const ly = side ? cy - legendRows / 2 : cy + d / 2 + 70;
    Object.assign(legend.style, { left: `${lx}px`, top: `${ly}px`, width: `${side ? region.x + region.w - lx : region.w * 0.76}px` });
    toneIndex = 0;
    const rows = values.map((v, i) => {
      const row = ctx.el("div", "cb-row", legend);
      const sw0 = ctx.el("span", "cb-swatch", row);
      sw0.style.background = rest;
      sw0.style.opacity = String(i === hi ? 1 : tones[Math.min(tones.length - 1, toneIndex++)]);
      ctx.el("span", "cb-name", row, labels[i] ?? "");
      const val = ctx.el("span", "cb-amount", row);
      tl.track(counter(val, { from: 0, to: v, at: at.growAt + starts[i] * sweepFor, duration: sweepFor * 0.7, ease: "out", ...fmt }));
      if (i === hi) {
        tl.fromTo(sw0, { backgroundColor: rest }, { backgroundColor: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
        tl.fromTo(row, { color: palette.ink }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
      }
      return row;
    });
    tl.fromTo(rows, { y: 16, opacity: 0 }, { y: 0, opacity: 1 }, { at: at.growAt + 0.2, duration: 0.6, ease: "out", stagger: Math.min(0.08, 0.45 / Math.max(1, n - 1)) });
    tl.to(rows.filter((_, i) => i !== hi), { opacity: 0.45 }, { at: at.climax, duration: 0.45, ease: "smooth" });
    if (badge) {
      Object.assign(badge.style, { left: `${ctx.safe.left}px`, top: `${headBottom + 24}px` });
      badge.classList.add("is-flat");
      tl.fromTo(badge, { y: 18, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1 }, { at: at.climax + 0.12, duration: 0.5, ease: "out" });
      ctx.cue(at.climax + 0.12, "pop", { weight: 0.4, at: badge });
    }
  }

  // packages/motion/src/blocks/chart_build/chart_build-entry.ts
  defineBlock(build);
})();
