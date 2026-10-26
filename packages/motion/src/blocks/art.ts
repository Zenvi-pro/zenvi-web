/**
 * Procedural illustrations for blocks that show pictures (a halftone, a
 * masonry board, a card) when the brief gives no media: seeded SVG scenes we
 * draw, so a default render has real images in it and never a third party's.
 */

import { mulberry32 } from "../runtime/index.js";

export type ArtKind = "hills" | "peaks" | "sea" | "orb" | "bloom" | "dunes" | "mascot";
export const ART_KINDS: readonly ArtKind[] = ["hills", "peaks", "sea", "orb", "bloom", "dunes", "mascot"];

export interface ArtTheme {
  /** Sky, top to bottom. */
  sky: readonly string[];
  sun: string;
  /** Land layers, far to near. */
  land: readonly string[];
}

export const ART_THEMES: readonly ArtTheme[] = [
  { sky: ["#2B1B4A", "#E8577A", "#FFB36B"], sun: "#FFE7B0", land: ["#9A3F6A", "#5E2257", "#331341", "#170A26"] },
  { sky: ["#6FB6F2", "#D6EEFF"], sun: "#FFF8DD", land: ["#B4DD7A", "#78B84D", "#438D3C", "#21582A"] },
  { sky: ["#0B2340", "#3E7CB1", "#BFE3F2"], sun: "#F4FBFF", land: ["#A9D2E6", "#6FA3C8", "#3B6E99", "#1C3F66"] },
  { sky: ["#F09A5B", "#F9D9A8"], sun: "#FFF4E0", land: ["#E3925A", "#C2683C", "#924329", "#55261A"] },
  { sky: ["#0A0630", "#3B0F70", "#FF3D81"], sun: "#FFD1E8", land: ["#6A1F99", "#41106E", "#24084B", "#110328"] },
  { sky: ["#BDEFE0", "#F0FFF9"], sun: "#FFFFFF", land: ["#86DBBC", "#43B597", "#1F8570", "#0E4F46"] },
  { sky: ["#FF7A5C", "#FFC9A3"], sun: "#FFF0D6", land: ["#F05A4F", "#B83147", "#7A1C3C", "#3D0D27"] },
  { sky: ["#1B1F3B", "#4C5FD7", "#9FD3FF"], sun: "#FFFFFF", land: ["#5A6FE0", "#3445B5", "#1E2A7D", "#0E1446"] },
];

/** The theme at index `n`, wrapping both ways: blocks offset by the seed, which may be 0. */
export function artTheme(n: number): ArtTheme {
  const k = ART_THEMES.length;
  return ART_THEMES[((Math.trunc(n) % k) + k) % k]!;
}

const f = (n: number): string => n.toFixed(1);

/** A smooth ridge across the width: y = base + a sum of sines; closed down to the bottom. */
function ridge(w: number, h: number, base: number, amp: number, rnd: () => number, jag = false): string {
  const waves = [0, 1, 2].map((k) => ({ freq: ((1.2 + rnd() * 1.6) * (k + 1) * Math.PI) / w, phase: rnd() * Math.PI * 2, amp: amp / (k + 1.3) }));
  const steps = jag ? 14 : 48;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = (w * i) / steps;
    let y = base;
    for (const wv of waves) y += Math.sin(x * wv.freq + wv.phase) * wv.amp;
    if (jag) y += (rnd() - 0.5) * amp * 1.4;
    pts.push(`${i === 0 ? "M" : "L"}${f(x)},${f(y)}`);
  }
  return `${pts.join(" ")} L${f(w)},${f(h)} L0,${f(h)} Z`;
}

function skyGradient(id: string, sky: readonly string[]): string {
  const stops = sky.map((c, i) => `<stop offset="${sky.length === 1 ? 0 : i / (sky.length - 1)}" stop-color="${c}"/>`).join("");
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
}

function landscape(kind: "hills" | "peaks" | "dunes" | "sea", w: number, h: number, theme: ArtTheme, rnd: () => number): string {
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
    const base = h * (0.5 + (i / layers) * 0.38);
    const amp = h * (kind === "peaks" ? 0.12 - i * 0.02 : kind === "dunes" ? 0.05 : 0.06 - i * 0.008);
    body += `<path d="${ridge(w, h, base, amp, rnd, kind === "peaks" && i < 2)}" fill="${color}"/>`;
  });
  return body;
}

function orb(w: number, h: number, theme: ArtTheme, rnd: () => number): string {
  const r = Math.min(w, h) * (0.28 + rnd() * 0.06);
  const cx = w * (0.45 + rnd() * 0.1);
  const cy = h * (0.46 + rnd() * 0.06);
  return (
    `<radialGradient id="orb" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${theme.sun}"/><stop offset="0.45" stop-color="${theme.sky[theme.sky.length - 1]}"/><stop offset="1" stop-color="${theme.land[1]}"/></radialGradient>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
    `<ellipse cx="${f(cx + r * 0.15)}" cy="${f(cy + r * 1.08)}" rx="${f(r * 0.9)}" ry="${f(r * 0.14)}" fill="${theme.land[3]}" opacity="0.35"/>` +
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#orb)"/>`
  );
}

function bloom(w: number, h: number, theme: ArtTheme, rnd: () => number): string {
  const cx = w / 2;
  const cy = h * 0.48;
  const R = Math.min(w, h) * 0.36;
  const petals = 7 + Math.floor(rnd() * 5);
  let body = `<rect width="${w}" height="${h}" fill="url(#sky)"/>`;
  for (let ring = 0; ring < 2; ring += 1) {
    for (let i = 0; i < petals; i += 1) {
      const a = (i / petals) * 360 + ring * (180 / petals);
      const len = R * (ring === 0 ? 1 : 0.62);
      body += `<ellipse cx="${f(cx)}" cy="${f(cy - len / 2)}" rx="${f(len * 0.22)}" ry="${f(len / 2)}" fill="${theme.land[ring]}" opacity="0.92" transform="rotate(${f(a)} ${f(cx)} ${f(cy)})"/>`;
    }
  }
  body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.18)}" fill="${theme.sun}"/>`;
  return body;
}

/** A round creature we drew (eyes, cheeks, a bobble antenna); colour variants come from the theme. */
function mascot(w: number, h: number, theme: ArtTheme, rnd: () => number): string {
  const cx = w / 2;
  const cy = h * 0.56;
  const R = Math.min(w, h) * 0.3;
  const body = theme.land[0]!;
  const shade = theme.land[2]!;
  const pts: string[] = [];
  const bumps = rnd() * Math.PI * 2;
  for (let i = 0; i <= 40; i += 1) {
    const a = (i / 40) * Math.PI * 2;
    const rr = R * (1 + 0.035 * Math.sin(a * 3 + bumps));
    pts.push(`${i === 0 ? "M" : "L"}${f(cx + Math.cos(a) * rr * 1.05)},${f(cy + Math.sin(a) * rr * (a > 0 && a < Math.PI ? 0.88 : 1))}`);
  }
  const eye = (dx: number): string =>
    `<ellipse cx="${f(cx + dx)}" cy="${f(cy - R * 0.12)}" rx="${f(R * 0.15)}" ry="${f(R * 0.19)}" fill="#fff"/><circle cx="${f(cx + dx + R * 0.03)}" cy="${f(cy - R * 0.09)}" r="${f(R * 0.085)}" fill="#14101E"/><circle cx="${f(cx + dx + R * 0.06)}" cy="${f(cy - R * 0.14)}" r="${f(R * 0.03)}" fill="#fff"/>`;
  return (
    `<radialGradient id="body" cx="0.38" cy="0.3" r="0.85"><stop offset="0" stop-color="${theme.sun}"/><stop offset="0.35" stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></radialGradient>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
    `<ellipse cx="${f(cx)}" cy="${f(cy + R * 0.98)}" rx="${f(R * 0.85)}" ry="${f(R * 0.12)}" fill="${theme.land[3]}" opacity="0.3"/>` +
    `<path d="M${f(cx + R * 0.1)},${f(cy - R * 0.92)} Q${f(cx + R * 0.25)},${f(cy - R * 1.3)} ${f(cx + R * 0.42)},${f(cy - R * 1.42)}" stroke="${shade}" stroke-width="${f(R * 0.06)}" fill="none" stroke-linecap="round"/>` +
    `<circle cx="${f(cx + R * 0.44)}" cy="${f(cy - R * 1.46)}" r="${f(R * 0.12)}" fill="${theme.sun}"/>` +
    `<path d="${pts.join(" ")} Z" fill="url(#body)"/>` +
    eye(-R * 0.32) +
    eye(R * 0.32) +
    `<ellipse cx="${f(cx - R * 0.55)}" cy="${f(cy + R * 0.18)}" rx="${f(R * 0.12)}" ry="${f(R * 0.07)}" fill="${theme.sky[0]}" opacity="0.5"/>` +
    `<ellipse cx="${f(cx + R * 0.55)}" cy="${f(cy + R * 0.18)}" rx="${f(R * 0.12)}" ry="${f(R * 0.07)}" fill="${theme.sky[0]}" opacity="0.5"/>` +
    `<path d="M${f(cx - R * 0.14)},${f(cy + R * 0.2)} Q${f(cx)},${f(cy + R * 0.34)} ${f(cx + R * 0.14)},${f(cy + R * 0.2)}" stroke="#14101E" stroke-width="${f(R * 0.045)}" fill="none" stroke-linecap="round"/>`
  );
}

/** The SVG markup of a `kind` scene in `theme`, `w`×`h`, laid out by `seed`, with a fine grain. */
export function artSvg(kind: ArtKind, theme: ArtTheme, w: number, h: number, seed: number): string {
  const rnd = mulberry32(seed);
  const scene =
    kind === "orb" ? orb(w, h, theme, rnd) : kind === "bloom" ? bloom(w, h, theme, rnd) : kind === "mascot" ? mascot(w, h, theme, rnd) : landscape(kind, w, h, theme, rnd);
  const grain = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 1000}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.09 0"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${skyGradient("sky", theme.sky)}${grain}</defs>${scene}<rect width="${w}" height="${h}" filter="url(#grain)"/></svg>`;
}

/** `artSvg` as an image URL (an <img> src, or a canvas source: data SVG does not taint the canvas). */
export function artUrl(kind: ArtKind, theme: ArtTheme, w: number, h: number, seed: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(kind, theme, Math.round(w), Math.round(h), seed))}`;
}

/**
 * `artUrl` rasterised once to a PNG blob URL: an SVG <img> with grain would be
 * re-rasterised on every frame it is scaled. Falls back to the SVG URL where
 * the page cannot draw (tests).
 */
export async function artImage(doc: Document, kind: ArtKind, theme: ArtTheme, w: number, h: number, seed: number): Promise<string> {
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : svg;
}
