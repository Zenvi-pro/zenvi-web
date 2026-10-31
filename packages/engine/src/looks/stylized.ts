/**
 * Stylised looks for apply_look_tool and list_looks_tool: solarise,
 * invert, chrome, bleach bypass, duotones and colour accents. Each is a LUT made
 * here (looks/luts.ts) and written into the project when first used, so
 * colours can be any (`duotone #1b1f4a #ffc94a`, `accent #ff2a2a`). Pure.
 */

import { accentLut, bleachBypassLut, chromeLut, duotoneLut, hueOf, invertLut, solarizeLut } from "./luts.js";

export interface StylizedLook {
  id: string;
  label: string;
  description: string;
  vibe_tags: readonly string[];
  /** LUT strength unless the call gives one. */
  intensity: number;
  /** The LUT: a file stem and the cube text. */
  make(): { stem: string; cube: string };
}

/** Duotone presets: [shadow ink, highlight ink]. */
const DUOTONES: Readonly<Record<string, [string, string]>> = {
  midnight_gold: ["#14123b", "#ffc845"],
  navy_red: ["#0b1638", "#ff3b3b"],
  purple_lime: ["#2a0a55", "#c8ff3a"],
  teal_peach: ["#06343f", "#ffb38a"],
  ink_cream: ["#141414", "#f2e8d5"],
  blue_orange: ["#0a2a8a", "#ff8a1f"],
};

/** Colour-accent presets: the hue kept, degrees. */
const ACCENTS: Readonly<Record<string, number>> = { red: 0, orange: 28, yellow: 55, green: 120, cyan: 185, blue: 220, magenta: 300 };

function duotone(id: string, shadow: string, highlight: string): StylizedLook {
  return {
    id,
    label: `Duotone ${shadow} / ${highlight}`,
    description: `Two inks: shadows ${shadow}, highlights ${highlight} (any pair: "duotone #rrggbb #rrggbb")`,
    vibe_tags: ["duotone", "two tone", "graphic", "poster", "promo", "stylized"],
    intensity: 1,
    make: () => ({ stem: `look-duotone-${shadow.slice(1)}-${highlight.slice(1)}`, cube: duotoneLut(shadow, highlight) }),
  };
}

function accent(id: string, hue: number, name: string): StylizedLook {
  return {
    id,
    label: `Colour accent: ${name}`,
    description: `Only the ${name} stays in colour, the rest monochrome (any colour: "accent #rrggbb"; a different accent per shot reads as designed)`,
    vibe_tags: ["accent", "selective color", "color splash", "monochrome", "stylized", name],
    intensity: 1,
    make: () => ({ stem: `look-accent-${Math.round(hue)}`, cube: accentLut(hue) }),
  };
}

export const STYLIZED_LOOKS: readonly StylizedLook[] = [
  {
    id: "solarize",
    label: "Solarize",
    description: "Sabattier solarisation: highlights fold to negative with colour fringes (a flash frame or one shot of a hype reel)",
    vibe_tags: ["solarize", "solarise", "solarized", "psychedelic", "negative", "flash", "hype", "stylized"],
    intensity: 1,
    make: () => ({ stem: "look-solarize", cube: solarizeLut() }),
  },
  {
    id: "invert",
    label: "Invert / negative",
    description: "A photographic negative of the clip: on a 1-3 frame shot it is the inverted flash frame of a flash montage (the negative flash between hard cuts)",
    vibe_tags: ["invert", "inverted", "negative", "flash", "strobe", "hype", "stylized"],
    intensity: 1,
    make: () => ({ stem: "look-invert", cube: invertLut() }),
  },
  {
    id: "chrome",
    label: "Chrome / silver",
    description: "Hard metallic monochrome, the highlights folded to a sheen, a steel-blue cast (solarized chrome riders, product shots)",
    vibe_tags: ["chrome", "silver", "metal", "metallic", "monochrome", "hype", "stylized"],
    intensity: 1,
    make: () => ({ stem: "look-chrome", cube: chromeLut() }),
  },
  {
    id: "bleach_bypass",
    label: "Bleach bypass",
    description: "Harsh contrast, about half the saturation, gritty highlights (war films, sports, documentary grit)",
    vibe_tags: ["bleach bypass", "gritty", "desaturated", "contrast", "film", "moody", "stylized"],
    intensity: 0.9,
    make: () => ({ stem: "look-bleach-bypass", cube: bleachBypassLut() }),
  },
  ...Object.entries(DUOTONES).map(([name, [s, h]]) => duotone(name === "midnight_gold" ? "duotone" : `duotone_${name}`, s, h)),
  ...Object.entries(ACCENTS).map(([name, hue]) => accent(`accent_${name}`, hue, name)),
];

const BY_ID = new Map(STYLIZED_LOOKS.map((l) => [l.id, l]));
/** Spellings agents use for a look (bench round 7: "solarise" was refused and never retried). */
const ALIASES: Readonly<Record<string, string>> = {
  solarise: "solarize",
  solarized: "solarize",
  solarised: "solarize",
  solarization: "solarize",
  solarisation: "solarize",
  negative: "invert",
  inverted: "invert",
  inverse: "invert",
  silver: "chrome",
  "bleach-bypass": "bleach_bypass",
  "bleach bypass": "bleach_bypass",
};
const HEX = "#?([0-9a-fA-F]{6})";
const CUSTOM_DUOTONE = new RegExp(`^duotone[\\s:]+${HEX}[\\s,:/]+${HEX}$`, "i");
const CUSTOM_ACCENT = new RegExp(`^accent[\\s:]+${HEX}$`, "i");

/** A stylised look by id, or one with its colours in it ("duotone #1b1f4a #ffc94a", "accent #ff2a2a"); undefined when it is neither. */
export function stylizedLook(raw: string): StylizedLook | undefined {
  const text = raw.trim();
  const lowered = text.toLowerCase();
  const known = BY_ID.get(ALIASES[lowered] ?? lowered);
  if (known) return known;
  const duo = CUSTOM_DUOTONE.exec(text);
  if (duo) {
    const [s, h] = [`#${duo[1]!.toLowerCase()}`, `#${duo[2]!.toLowerCase()}`];
    return duotone(`duotone ${s} ${h}`, s, h);
  }
  const acc = CUSTOM_ACCENT.exec(text);
  if (acc) {
    const hex = `#${acc[1]!.toLowerCase()}`;
    return accent(`accent ${hex}`, hueOf(hex), hex);
  }
  return undefined;
}
