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

  // packages/motion/src/runtime/morph.ts
  function signedArea(ring) {
    let a = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  }
  function centroid(ring) {
    let x = 0;
    let y = 0;
    for (const p of ring) {
      x += p.x;
      y += p.y;
    }
    return { x: x / Math.max(1, ring.length), y: y / Math.max(1, ring.length) };
  }
  function perimeter(ring) {
    let len = 0;
    for (let i = 0; i < ring.length; i += 1) len += Math.hypot(ring[(i + 1) % ring.length].x - ring[i].x, ring[(i + 1) % ring.length].y - ring[i].y);
    return len;
  }
  function resampleRing(ring, n) {
    const total = perimeter(ring);
    if (ring.length === 0) return [];
    if (total === 0) return new Array(n).fill(ring[0]).map((p) => ({ ...p }));
    const out = [];
    const step = total / n;
    let seg = 0;
    let segStart = 0;
    let segLen = Math.hypot(ring[1 % ring.length].x - ring[0].x, ring[1 % ring.length].y - ring[0].y);
    for (let k = 0; k < n; k += 1) {
      const d = k * step;
      while (segStart + segLen < d && seg < ring.length - 1) {
        segStart += segLen;
        seg += 1;
        const a2 = ring[seg];
        const b2 = ring[(seg + 1) % ring.length];
        segLen = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      }
      const a = ring[seg];
      const b = ring[(seg + 1) % ring.length];
      const u = segLen > 0 ? Math.min(1, (d - segStart) / segLen) : 0;
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    return out;
  }
  function alignRing(a, b) {
    const n = b.length;
    let best = 0;
    let bestCost = Infinity;
    const coarse = Math.max(1, Math.floor(n / 64));
    const cost = (shift) => {
      let c = 0;
      for (let i = 0; i < n; i += coarse) {
        const p = a[i];
        const q = b[(i + shift) % n];
        c += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      }
      return c;
    };
    for (let s = 0; s < n; s += coarse) {
      const c = cost(s);
      if (c < bestCost) [best, bestCost] = [s, c];
    }
    if (coarse > 1) {
      const around = best;
      for (let s = around - coarse; s <= around + coarse; s += 1) {
        const shift = (s + n) % n;
        const c = cost(shift);
        if (c < bestCost) [best, bestCost] = [shift, c];
      }
    }
    return b.map((_, i) => b[(i + best) % n]);
  }
  function contains(ring, p) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function toOutline(rings) {
    const out = { solids: [], holes: [] };
    for (const ring of rings) {
      if (ring.length < 3) continue;
      const depth = rings.filter((other) => other !== ring && other.length >= 3 && contains(other, ring[0])).length;
      const hole = depth % 2 === 1;
      const clockwise = signedArea(ring) > 0;
      const wound = clockwise === !hole ? [...ring] : [...ring].reverse();
      (hole ? out.holes : out.solids).push(wound);
    }
    return out;
  }
  function byPosition(rings) {
    return rings.map((r) => ({ r, c: centroid(r) })).sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y).map((e) => e.r);
  }
  function pair(ra, rb, spacing) {
    const n = Math.max(24, Math.min(400, Math.ceil(Math.max(ra ? perimeter(ra) : 0, rb ? perimeter(rb) : 0) / spacing)));
    const sa = ra ? resampleRing(ra, n) : new Array(n).fill(centroid(rb));
    const sb = rb ? resampleRing(rb, n) : new Array(n).fill(centroid(ra));
    return [sa, ra && rb ? alignRing(sa, sb) : sb];
  }
  function pairUp(a, b, reuse, spacing, out) {
    const k = Math.max(a.length, b.length);
    const usesA = a.map(() => 0);
    const usesB = b.map(() => 0);
    for (let i = 0; i < k; i += 1) {
      const ia = Math.floor(i * a.length / k);
      const ib = Math.floor(i * b.length / k);
      const ra = a.length > 0 && (reuse || usesA[ia] === 0) ? a[ia] : void 0;
      const rb = b.length > 0 && (reuse || usesB[ib] === 0) ? b[ib] : void 0;
      if (ra) usesA[ia] += 1;
      if (rb) usesB[ib] += 1;
      out.push(pair(ra, rb, spacing));
    }
    return [usesA, usesB];
  }
  function holesFor(solids, uses, holes) {
    return holes.flatMap((h) => {
      let best = -1;
      for (let i = 0; i < solids.length; i += 1) {
        if (contains(solids[i], h[0]) && (best < 0 || Math.abs(signedArea(solids[i])) < Math.abs(signedArea(solids[best])))) best = i;
      }
      return new Array(Math.max(1, best >= 0 ? uses[best] : 1)).fill(h);
    });
  }
  function prepareMorph(from, to, options = {}) {
    const spacing = options.spacing ?? 6;
    const pairs = [];
    const a = byPosition(from.solids);
    const b = byPosition(to.solids);
    const [usesA, usesB] = pairUp(a, b, true, spacing, pairs);
    pairUp(byPosition(holesFor(a, usesA, from.holes)), byPosition(holesFor(b, usesB, to.holes)), false, spacing, pairs);
    return { pairs };
  }
  function relax(ring, passes) {
    let r = ring;
    for (let k = 0; k < Math.ceil(passes); k += 1) {
      const w = Math.min(1, passes - k) * 0.5;
      const n = r.length;
      r = r.map((q, i) => {
        const a = r[(i + n - 1) % n];
        const b = r[(i + 1) % n];
        return { x: q.x + w * ((a.x + b.x) / 2 - q.x), y: q.y + w * ((a.y + b.y) / 2 - q.y) };
      });
    }
    return r;
  }
  function morphRings(morph, p, frame = {}) {
    return morph.pairs.map(([a, b], i) => {
      let q = p;
      if (frame.delay) {
        const d = Math.min(0.9, Math.max(0, frame.delay(i, centroid(a))));
        q = Math.min(1, Math.max(0, (p - d) / (1 - d)));
      }
      if (q <= 0) return a;
      if (q >= 1) return b;
      const e = frame.ease ? frame.ease(q) : q;
      const mixed = a.map((pa, j) => ({ x: pa.x + (b[j].x - pa.x) * e, y: pa.y + (b[j].y - pa.y) * e }));
      return frame.smooth ? relax(mixed, frame.smooth * Math.sin(Math.PI * q)) : mixed;
    });
  }
  function ringsPath(rings) {
    const f = (n) => String(Math.round(n * 100) / 100);
    return rings.filter((r) => r.length > 1).map((r) => `M${r.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}Z`).join("");
  }
  function outlinePath(outline) {
    return ringsPath([...outline.solids, ...outline.holes]);
  }
  function transformRing(ring, t) {
    const s = t.scale ?? 1;
    const a = (t.rotate ?? 0) * Math.PI / 180;
    const cos = Math.cos(a) * s;
    const sin = Math.sin(a) * s;
    return ring.map((p) => ({ x: p.x * cos - p.y * sin + (t.x ?? 0), y: p.x * sin + p.y * cos + (t.y ?? 0) }));
  }
  function transformOutline(outline, t) {
    return { solids: outline.solids.map((r) => transformRing(r, t)), holes: outline.holes.map((r) => transformRing(r, t)) };
  }
  function circle(r = 1, n = 96) {
    return Array.from({ length: n }, (_, i) => {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  }
  function roundRect(w, h, radius, perCorner = 12) {
    const rr = Math.max(0, Math.min(radius, w / 2, h / 2));
    const out = [];
    const corners = [
      [w / 2 - rr, -h / 2 + rr, -Math.PI / 2],
      [w / 2 - rr, h / 2 - rr, 0],
      [-w / 2 + rr, h / 2 - rr, Math.PI / 2],
      [-w / 2 + rr, -h / 2 + rr, Math.PI]
    ];
    for (const [cx, cy, start] of corners) {
      for (let i = 0; i <= perCorner; i += 1) {
        const a = start + i / perCorner * (Math.PI / 2);
        out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
      }
    }
    return out;
  }
  function sector(a0, a1, r = 1, n = 48) {
    const out = [{ x: 0, y: 0 }];
    for (let i = 0; i <= n; i += 1) {
      const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return out;
  }

  // packages/motion/src/runtime/trails.ts
  function measure(points) {
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    return { points: [...points], lengths, total: lengths[lengths.length - 1] ?? 0 };
  }
  function indexAt(path, d) {
    let lo = 0;
    let hi = path.lengths.length - 1;
    while (lo < hi - 1) {
      const mid = lo + hi >> 1;
      if (path.lengths[mid] <= d) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function pointAlong(path, u) {
    const n = path.points.length;
    if (n === 0) return { x: 0, y: 0, angle: 0 };
    if (n === 1) return { ...path.points[0], angle: 0 };
    const d = Math.min(1, Math.max(0, u)) * path.total;
    const i = Math.min(n - 2, indexAt(path, d));
    const a = path.points[i];
    const b = path.points[i + 1];
    const seg = path.lengths[i + 1] - path.lengths[i];
    const k = seg > 0 ? (d - path.lengths[i]) / seg : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  function slice(path, u0, u1) {
    const a = Math.min(1, Math.max(0, u0));
    const b = Math.min(1, Math.max(0, u1));
    if (b <= a || path.points.length < 2) return [];
    const out = [pointAlong(path, a)];
    const i0 = indexAt(path, a * path.total) + 1;
    const i1 = indexAt(path, b * path.total);
    for (let i = i0; i <= i1; i += 1) out.push(path.points[i]);
    const end = pointAlong(path, b);
    out.push({ x: end.x, y: end.y });
    return out;
  }
  var BANDS = 24;
  function drawTrail(g, path, head, style) {
    if (head <= 0) return;
    const start = Number.isFinite(style.tail) ? head - style.tail : 0;
    const span = head - start;
    const taper = style.taper ?? 0.2;
    const opacity = style.opacity ?? 1;
    g.save();
    g.strokeStyle = style.color;
    g.lineJoin = "round";
    for (let b = 0; b < BANDS; b += 1) {
      const u0 = start + span * b / BANDS;
      const u1 = start + span * (b + 1) / BANDS;
      if (u1 <= 0) continue;
      const pts = slice(path, u0, u1);
      if (pts.length < 2) continue;
      const k = (b + 1) / BANDS;
      g.globalAlpha = opacity * (Number.isFinite(style.tail) ? k * k : 1);
      g.lineWidth = style.width * (Number.isFinite(style.tail) ? taper + (1 - taper) * k : 1);
      g.lineCap = b === BANDS - 1 ? "round" : "butt";
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
      g.stroke();
    }
    g.restore();
  }

  // packages/motion/src/blocks/logo_build/block.ts
  var HEX2 = /^#[0-9a-f]{6}$/i;
  var SVG = "http://www.w3.org/2000/svg";
  function petal() {
    return Array.from({ length: 96 }, (_, i) => {
      const a = i / 96 * Math.PI * 2;
      return { x: 0.56 + 0.44 * Math.cos(a), y: 0.36 * Math.sin(a) * (0.62 + 0.38 * Math.cos(a)) };
    });
  }
  function markPieces(mark) {
    switch (mark) {
      case "pinwheel":
        return {
          pieces: [0, 1, 2, 3].map((k) => {
            const a = k * Math.PI / 2;
            return toOutline([transformRing(sector(0, 90, 0.8), { rotate: k * 90, x: Math.cos(a) * 0.2 - 0.1, y: Math.sin(a) * 0.2 - 0.1 })]);
          }),
          turn: 90
        };
      case "stack":
        return {
          pieces: [1.9, 1.45, 1.05, 0.62].map((w, k) => toOutline([transformRing(roundRect(w, 0.34, 0.17), { x: 0.95 - w / 2, y: -0.69 + k * 0.46 })])),
          turn: 0
        };
      case "kit":
        return {
          pieces: [
            toOutline([transformRing(circle(0.42), { x: -0.48, y: -0.48 })]),
            toOutline([transformRing(roundRect(0.84, 0.84, 0.14), { x: 0.48, y: -0.48 })]),
            toOutline([transformRing(sector(-90, 0, 0.88), { x: -0.9, y: 0.92 })]),
            toOutline([transformRing(roundRect(0.84, 0.4, 0.2), { x: 0.48, y: 0.48, rotate: 90 })])
          ],
          turn: 0
        };
      default:
        return { pieces: [0, 1, 2, 3].map((k) => toOutline([transformRing(petal(), { rotate: 45 + k * 90 })])), turn: 90 };
    }
  }
  function bezier(a, c, b, n = 64) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const u = i / n;
      const v = 1 - u;
      return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y };
    });
  }
  function smear(p, r, angle, stretch) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return circle(r, 48).map((q) => {
      const x = q.x * stretch;
      const y = q.y / Math.sqrt(stretch);
      return { x: p.x + x * cos - y * sin, y: p.y + x * sin + y * cos };
    });
  }
  function build(ctx) {
    const { tl, params: p, width: W, height: H, safe, palette, doc } = ctx;
    const cx = W / 2;
    const cy = safe.top + (H - safe.top - safe.bottom) / 2;
    const named = String(p.name).trim() !== "";
    const stacked = W < H * 1.3;
    const R = Math.min(W, H) * (stacked ? 0.17 : 0.18);
    const BIG = named ? 1.45 : 1.6;
    const given = p.colors.filter((c) => HEX2.test(c));
    const colors = [0, 1, 2, 3].map((k) => given[k % Math.max(1, given.length)] ?? [palette.accent, palette.secondary, palette.ink, palette.muted][k]);
    const { pieces: unit, turn } = markPieces(String(p.mark));
    const pieces = unit.map((o) => transformOutline(o, { scale: R, x: cx, y: cy }));
    const slots = pieces.map((o) => centroid(o.solids[0]));
    const dotR = R * 0.2;
    const reach = Math.hypot(W, H) * 0.6 / BIG;
    const flights = slots.map((s, k) => {
      const a = (-0.75 + k * 0.5) * Math.PI + 0.3;
      const from = { x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach };
      const mid = { x: (from.x + s.x) / 2, y: (from.y + s.y) / 2 };
      const bend = 0.35 * Math.hypot(s.x - from.x, s.y - from.y);
      const n = Math.atan2(s.y - from.y, s.x - from.x) + Math.PI / 2;
      return { path: measure(bezier(from, { x: mid.x + Math.cos(n) * bend, y: mid.y + Math.sin(n) * bend }, s)), at: 0.05 + k * 0.09 };
    });
    const FLY = 0.72;
    const landed = flights.map((f) => f.at + FLY);
    const morphAt = Math.max(...landed) - 0.08;
    const MORPH = 0.6;
    const morphs = pieces.map((o, k) => prepareMorph(toOutline([circle(dotR, 64).map((q) => ({ x: q.x + slots[k].x, y: q.y + slots[k].y }))]), o));
    const lockAt = morphAt + MORPH + 3 * 0.06;
    const revealAt = lockAt + 0.45;
    ctx.cue(flights[0].at, "whoosh", { weight: 0.5 });
    landed.forEach((t, k) => ctx.cue(t, "land", { weight: 0.35, at: { x: cx + (slots[k].x - cx) * BIG, y: cy + (slots[k].y - cy) * BIG } }));
    ctx.cue(lockAt, "reveal", { weight: 0.9, at: { x: cx, y: cy } });
    const stage = ctx.el("div", "lbx-stage");
    const canvas = ctx.el("canvas", "lbx-trails", stage);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    stage.append(svg);
    const group = doc.createElementNS(SVG, "g");
    svg.append(group);
    const paths = pieces.map((_, k) => {
      const el = doc.createElementNS(SVG, "path");
      el.setAttribute("fill", colors[k]);
      group.append(el);
      return el;
    });
    const mark = { x: 0, y: 0, scale: BIG, rotate: 0 };
    tl.set(mark, { scale: BIG }, 0);
    tl.to(mark, { scale: BIG * 1.06 }, { at: lockAt, duration: 0.16, ease: "out" });
    tl.to(mark, { scale: BIG }, { at: lockAt + 0.16, duration: 0.36, ease: "back-out" });
    if (turn) tl.fromTo(mark, { rotate: 0 }, { rotate: -turn }, { at: lockAt, duration: 0.6, ease: "back-out" });
    if (named) {
      const word = ctx.el("div", "lbx-word");
      const name = ctx.el("div", "lbx-name", word);
      const chars = Array.from(String(p.name)).map((c) => ctx.el("span", "char", name, c === " " ? "\xA0" : c));
      name.style.fontSize = `${Math.round(R * (stacked ? 1.25 : 1.3))}px`;
      if (stacked) Object.assign(word.style, { alignItems: "center", textAlign: "center" });
      name.style.fontWeight = ctx.display === "display" || ctx.display === "serif" ? "400" : String(p.weight);
      const tag = p.tagline ? ctx.el("div", "lbx-tag", word, String(p.tagline)) : null;
      const room = W - safe.left - safe.right - (stacked ? 0 : 2 * R + R * 0.55);
      const wide = word.getBoundingClientRect().width;
      if (wide > room && wide > 0) name.style.fontSize = `${parseFloat(name.style.fontSize) * room / wide}px`;
      const box = word.getBoundingClientRect();
      const gap = R * 0.55;
      let markX = cx;
      let markY = cy;
      if (stacked) {
        const total = 2 * R + gap + box.height;
        markY = cy - total / 2 + R;
        Object.assign(word.style, { left: `${cx - box.width / 2}px`, top: `${markY + R + gap}px` });
      } else {
        const total = 2 * R + gap + box.width;
        markX = cx - total / 2 + R;
        Object.assign(word.style, { left: `${markX + R + gap}px`, top: `${cy - box.height / 2}px` });
      }
      tl.to(mark, { x: markX - cx, y: markY - cy, scale: 1 }, { at: revealAt, duration: 0.8, ease: "in-out" });
      const rise = revealAt + 0.5;
      const each = Math.min(0.035, 0.32 / chars.length);
      tl.fromTo(chars, { yPercent: 115, rotate: 6 }, { yPercent: 0, rotate: 0 }, { at: rise, duration: 0.7, ease: "out", stagger: each });
      ctx.cue(rise, "whoosh", { weight: 0.35, at: name });
      if (tag) tl.fromTo(tag, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, { at: rise + 0.25 + chars.length * each, duration: 0.6, ease: "out" });
    }
    const out = EASES.out;
    const inOut = EASES["in-out"];
    tl.track((t) => {
      group.setAttribute("transform", `translate(${cx + mark.x} ${cy + mark.y}) rotate(${mark.rotate}) scale(${mark.scale}) translate(${-cx} ${-cy})`);
      const g = canvas.getContext("2d");
      if (g) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.translate(cx + mark.x, cy + mark.y);
        g.rotate(mark.rotate * Math.PI / 180);
        g.scale(mark.scale, mark.scale);
        g.translate(-cx, -cy);
      }
      flights.forEach((f, k) => {
        const q = (t - f.at) / FLY;
        if (q < 1) {
          if (q <= 0) {
            paths[k].setAttribute("d", "");
            return;
          }
          const head = out(q);
          const speed = (out(Math.min(1, q + 0.01)) - out(Math.max(0, q - 0.01))) / 0.02;
          const at = pointAlong(f.path, head);
          if (g) drawTrail(g, f.path, head, { color: colors[k], width: dotR * 1.5, tail: 0.32 * Math.min(1, speed / 3), taper: 0.05, opacity: 0.85 });
          paths[k].setAttribute("d", ringsPath([smear(at, dotR, at.angle, 1 + 0.5 * Math.min(1, speed / 4))]));
          return;
        }
        const m = (t - morphAt - k * 0.06) / MORPH;
        if (m <= 0) {
          const since = t - landed[k];
          const squash = since < 0.25 ? 1 - 0.18 * Math.sin(Math.PI * since / 0.25) * (1 - since / 0.25) : 1;
          paths[k].setAttribute("d", ringsPath([smear(slots[k], dotR, Math.PI / 2, squash)]));
        } else if (m < 1) {
          paths[k].setAttribute("d", ringsPath(morphRings(morphs[k], m, { ease: inOut, smooth: 4 })));
        } else {
          paths[k].setAttribute("d", outlinePath(pieces[k]));
        }
      });
    });
  }

  // packages/motion/src/blocks/logo_build/logo_build-entry.ts
  defineBlock(build);
})();
