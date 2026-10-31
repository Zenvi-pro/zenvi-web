/**
 * Generates `src/blocks/geo_map/world.gen.ts` from Natural Earth (public domain,
 * https://www.naturalearthdata.com/about/terms-of-use/): 1:50m admin-0 countries,
 * simplified, and the 1:50m populated places.
 *
 *   curl -sSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
 *   curl -sSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson
 *   npx tsx packages/motion/scripts/gen-geo.ts --countries ne_50m_admin_0_countries.geojson --places ne_50m_populated_places_simple.geojson
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { encodeRing } from "../src/blocks/geo_map/geo.js";

/** Douglas-Peucker tolerance, degrees: about 3 km, under a pixel until a country fills a 1080 frame. */
const TOLERANCE = 0.03;
/** Islands and holes smaller than this (square degrees) are dropped unless they are a country's largest ring. */
const MIN_AREA = 0.02;

type Pos = [number, number];

interface Feature {
  properties: Record<string, string | number | null>;
  geometry: { type: "Polygon"; coordinates: Pos[][] } | { type: "MultiPolygon"; coordinates: Pos[][][] };
}

function area(ring: readonly Pos[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(s / 2);
}

function simplify(points: readonly Pos[], tol: number): Pos[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!;
    const [bx, by] = points[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i]!;
      const d = dx === 0 && dy === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring with its repeated last point dropped, simplified; null when too small to keep. */
function ring(points: readonly Pos[], largest: boolean): Pos[] | null {
  if (!largest && area(points) < MIN_AREA) return null;
  // Simplify the two halves so the closing point is never the only one kept.
  const open = points.slice(0, -1);
  const mid = Math.floor(open.length / 2);
  const out = [...simplify(open.slice(0, mid + 1), TOLERANCE).slice(0, -1), ...simplify([...open.slice(mid), open[0]!], TOLERANCE).slice(0, -1)];
  return out.length >= 3 ? out : null;
}

const text = (v: string | number | null | undefined): string => (v === null || v === undefined || v === -99 || v === "-99" ? "" : String(v).trim());

const { values } = parseArgs({ options: { countries: { type: "string" }, places: { type: "string" } } });
if (!values.countries || !values.places) throw new Error("usage: gen-geo.ts --countries <ne_50m_admin_0_countries.geojson> --places <ne_50m_populated_places_simple.geojson>");

const countries = (JSON.parse(readFileSync(values.countries, "utf8")) as { features: Feature[] }).features.map((f) => {
  const p = f.properties;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const biggest = Math.max(...polys.map((poly) => area(poly[0]!)));
  const rings: string[] = [];
  for (const poly of polys) {
    poly.forEach((r, i) => {
      const kept = ring(r, i === 0 && area(r) === biggest);
      if (kept) rings.push(encodeRing(kept));
    });
  }
  const a3 = text(p.ADM0_A3);
  const name = text(p.NAME);
  const aliases = [...new Set([text(p.NAME_LONG), text(p.ADMIN), text(p.NAME_EN), text(p.FORMAL_EN), text(p.ABBREV).replace(/\.$/, ""), text(p.ISO_A2), text(p.ISO_A3), text(p.ISO_A3_EH), text(p.SOVEREIGNT)])].filter((s) => s && s !== name && s !== a3);
  return [a3, name, aliases.join("|"), text(p.CONTINENT), text(p.SUBREGION), Number(p.LABEL_X), Number(p.LABEL_Y), rings] as const;
});
countries.sort((a, b) => a[0].localeCompare(b[0]));

interface Place {
  properties: { name: string; nameascii: string; adm0_a3: string; latitude: number; longitude: number; scalerank: number; pop_max: number; adm0cap: number };
}
const places = (JSON.parse(readFileSync(values.places, "utf8")) as { features: Place[] }).features
  .map(({ properties: p }) => [p.name, p.nameascii === p.name ? "" : p.nameascii, p.adm0_a3, Math.round(p.latitude * 100) / 100, Math.round(p.longitude * 100) / 100, p.scalerank, p.adm0cap ? 1 : 0] as const)
  .sort((a, b) => a[5] - b[5] || a[0].localeCompare(b[0]));

const out = fileURLToPath(new URL("../src/blocks/geo_map/world.gen.ts", import.meta.url));
writeFileSync(
  out,
  [
    "// Generated by packages/motion/scripts/gen-geo.ts from Natural Earth 1:50m (public domain); do not edit.",
    "// Countries: [adm0_a3, name, aliases (|), continent, subregion, label lon, label lat, rings (encodeRing)].",
    "// Places: [name, ascii name, adm0_a3, lat, lon, scalerank, capital (1)].",
    "",
    'import type { CountryRow, PlaceRow } from "./geo.js";',
    "",
    `export const COUNTRIES: readonly CountryRow[] = ${JSON.stringify(countries)};`,
    "",
    `export const PLACES: readonly PlaceRow[] = ${JSON.stringify(places)};`,
    "",
  ].join("\n"),
);
const points = countries.reduce((n, c) => n + c[7].reduce((m, r) => m + r.length, 0), 0);
console.log(`${countries.length} countries (${Math.round(points / 1024)} KiB of rings), ${places.length} places -> ${out}`);
