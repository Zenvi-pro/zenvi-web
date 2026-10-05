"use strict";

/**
 * Title images for premiere_add_text without `image` or `mogrt` (SPEC 3.4).
 * Premiere's scripting API cannot type text, so Zenvi Link draws the title on
 * a canvas in its CEP page (Chromium). The result is a transparent PNG at the
 * sequence's frame size with the text already placed inside title-safe; the
 * host script then lays it down as a still, and a frame-sized image fills the
 * frame.
 *
 * layoutTitle() is pure (it measures text through a callback), so it is tested
 * without a browser. drawTitle() replays a layout on any 2D canvas.
 *
 * The PNG is media the project keeps using, so it is written next to the saved
 * project, in "Zenvi Titles/". A temp folder would eventually be cleared and
 * take the title offline. Only an unsaved project gets the Zenvi Link temp
 * folder, with a warning.
 */

const nodeCrypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { makeDir } = require("./discovery");
const { scriptLiteral } = require("./server");

/** TASTE 4 per style: size step, weight (headlines 700-800, supporting text 400-500), leading. */
const STYLES = {
  headline: { size: "headline", weight: 800, leading: "headline", tracking: true },
  title: { size: "title", weight: 700, leading: "headline", tracking: false },
  subtitle: { size: "subtitle", weight: 500, leading: "body", tracking: false },
  "lower-third": { size: "lowerThirdName", weight: 700, leading: "headline", tracking: false },
  caption: { size: "caption", weight: 500, leading: "body", tracking: false },
};

/** Approximate ascent and descent as fractions of the font size (canvas fonts vary little here). */
const ASCENT = 0.8;
const DESCENT = 0.22;

function defaultPlacement(style) {
  if (style === "lower-third") return "lower-third";
  if (style === "caption") return "bottom-center";
  return "center";
}

/** A CSS family name, quoted when it is more than one word. */
function familyName(name) {
  return /^[A-Za-z-]+$/.test(name) ? name : JSON.stringify(String(name));
}

/** "#RRGGBB" or [r, g, b] (0-1) as a CSS rgba() colour. */
function cssColor(value, alpha) {
  let rgb = [255, 255, 255];
  if (typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)) {
    rgb = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  } else if (Array.isArray(value) && value.length === 3) {
    rgb = value.map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel))) * 255));
  }
  return "rgba(" + rgb.join(", ") + ", " + (alpha === undefined ? 1 : alpha) + ")";
}

/**
 * Lines of a title: its own line breaks, then words up to `maxChars` per line
 * (TASTE 4: 32). A last line of a single word takes one word from the line
 * above when that still fits, so no word is left alone.
 */
function wrapLines(text, maxChars) {
  const lines = [];
  for (const paragraph of String(text).trim().split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    const out = [];
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > maxChars) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    out.push(line);
    const last = out.length - 1;
    if (last >= 1 && out[last].indexOf(" ") < 0) {
      const above = out[last - 1].split(" ");
      if (above.length >= 2 && (above[above.length - 1] + " " + out[last]).length <= maxChars) {
        out[last] = above.pop() + " " + out[last];
        out[last - 1] = above.join(" ");
      }
    }
    for (const item of out) lines.push(item);
  }
  return lines;
}

/** TASTE 3 title-safe box: a 10 % inset, or for 9:16 the vertical safe area (top 12 %, bottom 20 %). */
function titleSafe(width, height, layout) {
  const vertical = height > width && Math.abs(width / height - 9 / 16) < 0.02;
  return {
    left: width * layout.titleSafe,
    right: width * (1 - layout.titleSafe),
    top: height * (vertical ? layout.verticalTop : layout.titleSafe),
    bottom: height * (1 - (vertical ? layout.verticalBottom : layout.titleSafe)),
    vertical: vertical,
  };
}

/**
 * Where everything goes. spec: the premiere_add_text arguments (text, style,
 * font_size, color, placement, font, weight, stroke, shadow, box, align) plus
 * width, height (the frame) and taste (TASTE.type, .layout, .color.palette).
 * measure(font, text) gives a line's width in pixels.
 */
function layoutTitle(spec, measure) {
  const taste = spec.taste;
  const styleName = STYLES[spec.style] ? spec.style : "title";
  const style = STYLES[styleName];
  const width = spec.width;
  const height = spec.height;
  const scale = Math.min(width, height) / taste.type.referenceShortSide;
  const warnings = [];
  const placement = spec.placement || defaultPlacement(styleName);
  const align = spec.align || (placement === "lower-third" || placement === "top-left" ? "left" : "center");
  const weight = spec.weight || style.weight;
  const family = (spec.font ? [spec.font] : taste.type.families).map(familyName).concat(["sans-serif"]).join(", ");
  const leading = taste.type.leading[style.leading];
  const lines = wrapLines(spec.text, taste.type.maxLineChars);
  const safe = titleSafe(width, height, taste.layout);
  const fontFor = (size) => weight + " " + size + "px " + family;
  const padFor = (size) => (spec.box ? (spec.box.padding !== undefined ? spec.box.padding : Math.round(0.4 * size)) : 0);
  const blockHeight = (size) => (ASCENT + DESCENT) * size + (lines.length - 1) * size * leading + 2 * padFor(size);
  const requested = spec.font_size || Math.round(taste.type.sizes[style.size] * scale);
  let size = requested;
  let widths = lines.map((line) => measure(fontFor(size), line));
  // Shrink to fit title-safe: measured widths scale with the size, so two rounds settle it.
  for (let round = 0; round < 3; round += 1) {
    const widest = Math.max.apply(null, widths.concat([0]));
    const fitWidth = (safe.right - safe.left - 2 * padFor(size)) / Math.max(widest, 1);
    const fitHeight = (safe.bottom - safe.top) / blockHeight(size);
    const factor = Math.min(1, fitWidth, fitHeight);
    if (factor >= 1) break;
    size = Math.max(6, Math.floor(size * factor));
    widths = lines.map((line) => measure(fontFor(size), line));
  }
  if (size < requested) warnings.push("Shrank the title from " + requested + " px to " + size + " px to keep it inside title-safe");

  const pad = padFor(size);
  const lineHeight = size * leading;
  const blockWidth = Math.max.apply(null, widths.concat([0])) + 2 * pad;
  const totalHeight = blockHeight(size);
  let left;
  let top;
  switch (placement) {
    case "lower-third": {
      const lowerThird = taste.layout.lowerThird;
      const baseline = height * (safe.vertical ? lowerThird.baselineVertical : lowerThird.baselineLandscape);
      left = safe.left;
      top = Math.max(safe.top, baseline - (lines.length - 1) * lineHeight - ASCENT * size - pad);
      break;
    }
    case "top-left":
      left = safe.left;
      top = safe.top;
      break;
    case "top-center":
      left = (width - blockWidth) / 2;
      top = safe.top;
      break;
    case "bottom-center":
      left = (width - blockWidth) / 2;
      top = safe.bottom - totalHeight;
      break;
    default:
      left = (width - blockWidth) / 2;
      top = (height - totalHeight) / 2;
  }
  const x = align === "left" ? left + pad : align === "right" ? left + blockWidth - pad : left + blockWidth / 2;
  const shadow = taste.type.shadow;
  return {
    width: width,
    height: height,
    style: styleName,
    placement: placement,
    align: align,
    weight: weight,
    family: family,
    fontSize: size,
    font: fontFor(size),
    tracking: style.tracking ? Math.round(taste.type.tracking.headline * size * 100) / 100 : 0,
    lines: lines.map((text, i) => ({ text: text, x: Math.round(x * 100) / 100, y: Math.round((top + pad + ASCENT * size + i * lineHeight) * 100) / 100, width: widths[i] })),
    fill: cssColor(spec.color || taste.color.palette.paper),
    stroke: spec.stroke ? { color: cssColor(spec.stroke.color), width: spec.stroke.width } : null,
    shadow: spec.shadow === false ? null : { color: "rgba(0, 0, 0, " + shadow.opacity + ")", blur: shadow.softness * scale, offset: shadow.distance * scale },
    box: spec.box
      ? {
          color: cssColor(spec.box.color || taste.color.palette.ink, spec.box.opacity !== undefined ? spec.box.opacity : taste.type.scrim["default"]),
          x: Math.round(left * 100) / 100,
          y: Math.round(top * 100) / 100,
          width: Math.round(blockWidth * 100) / 100,
          height: Math.round(totalHeight * 100) / 100,
        }
      : null,
    warnings: warnings,
  };
}

/** Draw a layout on a 2D canvas (sized to the frame, transparent). */
function drawTitle(canvas, layout) {
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, layout.width, layout.height);
  if (layout.box) {
    context.fillStyle = layout.box.color;
    context.fillRect(layout.box.x, layout.box.y, layout.box.width, layout.box.height);
  }
  context.font = layout.font;
  context.textAlign = layout.align;
  context.textBaseline = "alphabetic";
  // letterSpacing exists in Chromium 99+ (CEP 12); older panels draw without tracking.
  if (layout.tracking && "letterSpacing" in context) context.letterSpacing = layout.tracking + "px";
  for (const line of layout.lines) {
    if (!line.text) continue;
    context.save();
    if (layout.shadow) {
      context.shadowColor = layout.shadow.color;
      context.shadowBlur = layout.shadow.blur;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = layout.shadow.offset;
    }
    if (layout.stroke) {
      context.lineJoin = "round";
      context.strokeStyle = layout.stroke.color;
      context.lineWidth = layout.stroke.width;
      context.strokeText(line.text, line.x, line.y);
    }
    context.fillStyle = layout.fill;
    context.fillText(line.text, line.x, line.y);
    context.restore();
  }
}

/** Measuring and rendering with the CEP page's canvas (`document` of the service or panel page). */
function createCanvasRenderer(document) {
  let scratch = null;
  return {
    measure(font, text) {
      if (!scratch) scratch = document.createElement("canvas").getContext("2d");
      scratch.font = font;
      return scratch.measureText(text).width;
    },
    render(layout) {
      const canvas = document.createElement("canvas");
      drawTitle(canvas, layout);
      const url = String(canvas.toDataURL("image/png"));
      if (url.indexOf("data:image/png;base64,") !== 0) throw new Error("the canvas did not produce a PNG");
      return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    },
  };
}

/** "launch-day-3f9a1c2b07.png": readable, and the same title reuses the same file. */
function titleFileName(text, layout) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "title";
  const fingerprint = JSON.stringify([layout.width, layout.height, layout.font, layout.align, layout.lines, layout.fill, layout.stroke, layout.shadow, layout.box, layout.tracking]);
  return slug + "-" + nodeCrypto.createHash("sha1").update(fingerprint).digest("hex").slice(0, 10) + ".png";
}

/** Write via a temp file and rename, so the host never imports half a PNG; an existing file (same fingerprint) is kept. */
function writeTitle(file, png) {
  if (fs.existsSync(file)) return;
  makeDir(path.dirname(file), 0o755);
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, png);
  fs.renameSync(temp, file);
}

/**
 * The server's preparer for premiere_add_text: renders the title when the
 * call has neither `image` nor `mogrt`, then hands the host script `image`.
 * Resolves null when there is nothing to do (the host script then answers,
 * refusing with the reason when there is no project or sequence).
 */
function createTitlePreparer(options) {
  const renderer = options.renderer;
  return async function prepareTitle(call) {
    const args = call.args;
    // Blank text is the host script's to refuse; rendering it would leave an empty PNG behind.
    if (args.image !== undefined || args.mogrt !== undefined || !String(args.text || "").trim()) return null;
    let frame = null;
    try {
      frame = JSON.parse(await call.evalScript("ZenviLink.ppro.titleFrame(" + scriptLiteral(JSON.stringify({ sequence: args.sequence === undefined ? null : args.sequence })) + ")"));
    } catch (_error) {
      frame = null;
    }
    if (!frame || frame.ok !== true) return null;
    let layout;
    let file;
    try {
      layout = layoutTitle(Object.assign({}, args, { width: frame.width, height: frame.height, taste: frame.taste }), renderer.measure);
      const dir = frame.project ? path.join(path.dirname(frame.project), "Zenvi Titles") : path.join(call.tempDir, "titles");
      file = path.join(dir, titleFileName(args.text, layout));
      if (!fs.existsSync(file)) writeTitle(file, renderer.render(layout));
    } catch (error) {
      // The host script then refuses with what to pass instead.
      return { warnings: ["Could not render the title image: " + (error && error.message ? error.message : String(error))] };
    }
    const warnings = layout.warnings.slice();
    if (!frame.project) {
      warnings.push("The project is not saved yet, so the title image is in the temp folder (" + file + "). Save the project and add the title again, or it may go offline when the system clears its temp files.");
    }
    return {
      args: Object.assign({}, args, { image: file, sequence: frame.sequence_id }),
      warnings: warnings,
      data: {
        source: "rendered",
        rendered: {
          path: file,
          width: layout.width,
          height: layout.height,
          lines: layout.lines.map((line) => line.text),
          font: layout.font,
          font_size: layout.fontSize,
          weight: layout.weight,
          placement: layout.placement,
          align: layout.align,
        },
      },
    };
  };
}

module.exports = { layoutTitle, drawTitle, wrapLines, titleSafe, cssColor, createCanvasRenderer, createTitlePreparer, titleFileName, STYLES };
