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
  function bounds(outline) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of outline.solids) {
      for (const p of r) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
    }
    return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  function circle(r = 1, n = 96) {
    return Array.from({ length: n }, (_, i) => {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  }
  function regularPolygon(sides, r = 1) {
    return Array.from({ length: sides }, (_, i) => {
      const a = i / sides * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  }
  function star(points = 5, inner = 0.48, r = 1) {
    return Array.from({ length: points * 2 }, (_, i) => {
      const a = i / (points * 2) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * inner;
      return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
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
  function blob(seed, wobble = 0.16, n = 120) {
    const harmonics = [2, 3, 5].map((k, i) => ({ k, amp: wobble * (0.5 + random01(seed, i, 0)) / (1 + i * 0.6), phase: random01(seed, i, 1) * Math.PI * 2 }));
    return Array.from({ length: n }, (_, i) => {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      const r = 1 + harmonics.reduce((s, h) => s + h.amp * Math.sin(h.k * a + h.phase), 0);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
  }
  function plus(arm = 0.62, round2 = 0.12) {
    const h = arm / 2;
    const raw = [
      { x: -h, y: -1 },
      { x: h, y: -1 },
      { x: h, y: -h },
      { x: 1, y: -h },
      { x: 1, y: h },
      { x: h, y: h },
      { x: h, y: 1 },
      { x: -h, y: 1 },
      { x: -h, y: h },
      { x: -1, y: h },
      { x: -1, y: -h },
      { x: -h, y: -h }
    ];
    return chaikin(raw, round2 > 0 ? 3 : 0, round2);
  }
  function chaikin(ring, passes = 2, cut = 0.25) {
    let r = [...ring];
    for (let k = 0; k < passes; k += 1) {
      const next = [];
      for (let i = 0; i < r.length; i += 1) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        next.push({ x: a.x + (b.x - a.x) * cut, y: a.y + (b.y - a.y) * cut }, { x: a.x + (b.x - a.x) * (1 - cut), y: a.y + (b.y - a.y) * (1 - cut) });
      }
      r = next;
    }
    return r;
  }

  // packages/motion/src/runtime/outline.ts
  function traceContours(values, w, h, threshold = 128, minArea = 4) {
    const at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : values[y * w + x];
    const stride = w + 2;
    const key = (x, y, vertical) => ((y + 1) * stride + (x + 1)) * 2 + (vertical ? 1 : 0);
    const points = /* @__PURE__ */ new Map();
    const links = /* @__PURE__ */ new Map();
    const point = (x, y, vertical) => {
      const k = key(x, y, vertical);
      if (!points.has(k)) {
        const a = at(x, y);
        const b = vertical ? at(x, y + 1) : at(x + 1, y);
        const u = a === b ? 0.5 : (threshold - a) / (b - a);
        points.set(k, vertical ? { x, y: y + u } : { x: x + u, y });
      }
      return k;
    };
    const link = (p, q) => {
      (links.get(p) ?? links.set(p, []).get(p)).push(q);
      (links.get(q) ?? links.set(q, []).get(q)).push(p);
    };
    for (let y = -1; y < h; y += 1) {
      for (let x = -1; x < w; x += 1) {
        const tl = at(x, y) >= threshold;
        const tr = at(x + 1, y) >= threshold;
        const br = at(x + 1, y + 1) >= threshold;
        const bl = at(x, y + 1) >= threshold;
        const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const top = () => point(x, y, false);
        const bottom = () => point(x, y + 1, false);
        const left = () => point(x, y, true);
        const right = () => point(x + 1, y, true);
        switch (code) {
          case 1:
          case 14:
            link(left(), bottom());
            break;
          case 2:
          case 13:
            link(bottom(), right());
            break;
          case 3:
          case 12:
            link(left(), right());
            break;
          case 4:
          case 11:
            link(top(), right());
            break;
          case 6:
          case 9:
            link(top(), bottom());
            break;
          case 7:
          case 8:
            link(left(), top());
            break;
          case 5:
          case 10: {
            const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= threshold;
            if (code === 5 === centre) {
              link(left(), top());
              link(bottom(), right());
            } else {
              link(left(), bottom());
              link(top(), right());
            }
          }
        }
      }
    }
    const rings = [];
    const used = /* @__PURE__ */ new Set();
    for (const start of links.keys()) {
      if (used.has(start)) continue;
      const ring = [];
      let prev = -1;
      let cur = start;
      while (!used.has(cur)) {
        used.add(cur);
        ring.push(points.get(cur));
        const next = links.get(cur).find((n) => n !== prev && !used.has(n));
        if (next === void 0) break;
        prev = cur;
        cur = next;
      }
      let area = 0;
      for (let i = 0; i < ring.length; i += 1) area += ring[i].x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * ring[i].y;
      if (Math.abs(area / 2) >= minArea) rings.push(ring);
    }
    return rings;
  }
  function textOutline(doc, text, font, letterSpacing = 0) {
    const canvas = doc.createElement("canvas");
    let g = null;
    try {
      g = canvas.getContext("2d");
    } catch {
      g = null;
    }
    if (!g) return null;
    g.font = font;
    if (letterSpacing) g.letterSpacing = `${letterSpacing}px`;
    const m = g.measureText(text);
    const ascent = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent;
    const pad = Math.ceil((ascent + descent) * 0.25);
    const w = Math.ceil(m.width + pad * 2);
    const h = Math.ceil(ascent + descent + pad * 2);
    canvas.width = w;
    canvas.height = h;
    g.font = font;
    if (letterSpacing) g.letterSpacing = `${letterSpacing}px`;
    g.fillStyle = "#000";
    g.textBaseline = "alphabetic";
    g.fillText(text, pad, pad + ascent);
    const data = g.getImageData(0, 0, w, h).data;
    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
    const rings = traceContours(alpha, w, h).map((r) => r.map((p) => ({ x: p.x - pad, y: p.y - pad })));
    return { outline: toOutline(rings), width: m.width, height: ascent + descent };
  }

  // packages/motion/src/blocks/shapes.ts
  var SHAPE_NAMES = ["circle", "square", "triangle", "hexagon", "star", "burst", "blob", "plus", "pill", "ring"];
  function isShapeName(name) {
    return SHAPE_NAMES.includes(name);
  }
  function namedShape(name, seed) {
    switch (name) {
      case "circle":
        return toOutline([circle(1)]);
      case "square":
        return toOutline([roundRect(1.62, 1.62, 0.26)]);
      case "triangle":
        return toOutline([chaikin(regularPolygon(3, 1.08), 3, 0.08).map((p) => ({ x: p.x, y: p.y + 0.16 }))]);
      case "hexagon":
        return toOutline([chaikin(regularPolygon(6, 1), 3, 0.08)]);
      case "star":
        return toOutline([chaikin(star(5, 0.5, 1.04), 2, 0.06)]);
      case "burst":
        return toOutline([chaikin(star(12, 0.72, 1), 2, 0.12)]);
      case "blob":
        return toOutline([blob(seed, 0.16).map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }))]);
      case "plus":
        return toOutline([plus(0.66, 0.1)]);
      case "pill":
        return toOutline([roundRect(1.96, 0.9, 0.45)]);
      case "ring":
        return toOutline([circle(1), circle(0.5)]);
    }
  }
  function canvasFont(ctx, px, weight) {
    const w = ctx.display === "display" || ctx.display === "serif" ? 400 : weight;
    return `${w} ${px}px ${FONT_STACKS[ctx.display]}`;
  }
  function glyphShape(ctx, text, weight = 800) {
    const traced = textOutline(ctx.doc, text, canvasFont(ctx, 360, weight));
    if (!traced || traced.outline.solids.length === 0) return null;
    const b = bounds(traced.outline);
    const s = 1.8 / Math.max(b.width, b.height);
    return transformOutline(transformOutline(traced.outline, { x: -(b.x + b.width / 2), y: -(b.y + b.height / 2) }), { scale: s });
  }

  // packages/motion/src/blocks/shape_morph/block.ts
  var HEX2 = /^#[0-9a-f]{6}$/i;
  var SVG = "http://www.w3.org/2000/svg";
  var ENTER = 0.55;
  function symmetry(name) {
    switch (name) {
      case "circle":
      case "ring":
      case "square":
      case "plus":
        return 90;
      case "burst":
        return 30;
      case "hexagon":
        return 60;
      case "star":
        return 72;
      case "triangle":
        return 120;
      case "pill":
        return 180;
      default:
        return 360;
    }
  }
  function build(ctx) {
    const { tl, params: p, width: W, height: H, safe, palette, doc } = ctx;
    const names = p.shapes.map((s) => s.trim()).filter(Boolean);
    const cx = W / 2;
    const cy = safe.top + (H - safe.top - safe.bottom) / 2;
    const R = Math.min(W - safe.left - safe.right, H - safe.top - safe.bottom) / 2 * Number(p.size);
    const shapes = [];
    for (const name of names) {
      const unit = isShapeName(name) ? namedShape(name, ctx.seed) : glyphShape(ctx, name);
      if (unit) shapes.push({ name: isShapeName(name) ? name : "glyph", outline: transformOutline(unit, { scale: R, x: cx, y: cy }) });
    }
    if (shapes.length === 0) shapes.push({ name: "circle", outline: transformOutline(namedShape("circle", 1), { scale: R, x: cx, y: cy }) });
    const given = p.colors.filter((c) => HEX2.test(c));
    const colors = given.length > 0 ? given : [palette.accent, palette.secondary, palette.ink];
    const color = (k) => colors[k % colors.length];
    const n = shapes.length;
    const beat = Number(p.beat) > 0 ? Number(p.beat) : n > 1 ? Math.max(0.2, (ctx.seconds - ENTER - 0.7) / (n - 1)) : ctx.seconds;
    const m = Math.min(Number(p.morph), beat * 0.8);
    const starts = shapes.slice(1).map((_, k) => ENTER + (k + 1) * beat - m);
    const morphs = shapes.slice(1).map((s, k) => prepareMorph(shapes[k].outline, s.outline));
    const rest = [0];
    for (let k = 1; k < n; k += 1) {
      const sym = symmetry(shapes[k].name);
      const a = rest[k - 1];
      rest.push(p.spin && sym <= 180 ? Math.round((a - 90) / sym) * sym : Math.round(a / 360) * 360);
    }
    const style = String(p.style);
    const stage = ctx.el("div", "smx-stage");
    stage.style.transformOrigin = `${cx}px ${cy}px`;
    const svg = doc.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    stage.append(svg);
    const stroke = Math.max(8, R * 0.07);
    const echoOf = doc.createElementNS(SVG, "path");
    const shape = doc.createElementNS(SVG, "path");
    if (style === "duo") {
      echoOf.setAttribute("fill", "none");
      echoOf.setAttribute("stroke", palette.ink);
      echoOf.setAttribute("stroke-width", String(stroke * 0.5));
      echoOf.setAttribute("transform", `translate(${R * 0.09} ${R * 0.09})`);
      svg.append(echoOf);
    }
    svg.append(shape);
    if (style === "outline") {
      shape.setAttribute("fill", "none");
      shape.setAttribute("stroke-width", String(stroke));
      shape.setAttribute("stroke-linejoin", "round");
    }
    ctx.cue(0, "pop", { weight: 0.5, at: { x: cx, y: cy } });
    for (const s of starts) {
      ctx.cue(s, "whoosh", { weight: 0.35, at: { x: cx, y: cy } });
      ctx.cue(s + m, "land", { weight: 0.45, at: { x: cx, y: cy } });
    }
    starts.forEach((s, k) => {
      const wrap = ctx.el("div", "smx-echo", stage);
      wrap.style.transformOrigin = `${cx}px ${cy}px`;
      const esvg = doc.createElementNS(SVG, "svg");
      esvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const ring = doc.createElementNS(SVG, "path");
      ring.setAttribute("d", outlinePath(shapes[k + 1].outline));
      Object.entries({ fill: "none", stroke: color(k + 1), "stroke-width": String(stroke * 0.35) }).forEach(([a, v]) => ring.setAttribute(a, v));
      esvg.append(ring);
      wrap.append(esvg);
      tl.set(wrap, { opacity: 0 }, 0);
      tl.fromTo(wrap, { scale: 1, opacity: 0.8 }, { scale: 1.38, opacity: 0 }, { at: s + m * 0.85, duration: 0.7, ease: "out" });
    });
    const inOut = EASES["in-out"];
    const back = EASES["back-out"];
    tl.track((t) => {
      let d;
      let fill;
      let angle = rest[0];
      let scale = 1;
      const k = starts.findIndex((s2) => t < s2 + m);
      const s = k >= 0 ? starts[k] : Infinity;
      if (k >= 0 && t >= s) {
        const q = (t - s) / m;
        const e = inOut(q);
        d = ringsPath(morphRings(morphs[k], e, { smooth: 6 }));
        fill = String(interpolate(color(k), color(k + 1), e));
        angle = rest[k] + (rest[k + 1] - rest[k]) * back(q) - 10 * Math.sin(Math.PI * q);
        scale = 1 - 0.1 * Math.sin(Math.PI * q);
      } else {
        const i = k >= 0 ? k : n - 1;
        d = outlinePath(shapes[i].outline);
        fill = color(i);
        angle = rest[i];
        const landed = i > 0 ? t - (starts[i - 1] + m) : Infinity;
        if (landed < 0.25) scale = 1 + 0.045 * Math.sin(Math.PI * landed / 0.25);
      }
      if (t < ENTER) scale *= back(Math.max(0, t / ENTER));
      if (t < ENTER) angle += -40 * (1 - EASES.out(Math.max(0, t / ENTER)));
      shape.setAttribute("d", d);
      if (style === "outline") shape.setAttribute("stroke", fill);
      else shape.setAttribute("fill", fill);
      if (style === "duo") echoOf.setAttribute("d", d);
      stage.style.transform = `rotate(${angle.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
    });
  }

  // packages/motion/src/blocks/shape_morph/shape_morph-entry.ts
  defineBlock(build);
})();
