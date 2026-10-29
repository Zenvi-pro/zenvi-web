/**
 * Geography for the geo_map block, free of the DOM so params checking can use
 * it: the Natural Earth rows (`world.gen.ts`), place lookup, the two
 * projections (orthographic globe, Mercator) and fitting a view to a place.
 * Longitudes and latitudes are degrees; views and projections work in radians.
 */

/** [adm0_a3, name, aliases (|), continent, subregion, label lon, label lat, rings]. */
export type CountryRow = readonly [string, string, string, string, string, number, number, readonly string[]];
/** [name, ascii name, adm0_a3, lat, lon, scalerank, capital (1)]. */
export type PlaceRow = readonly [string, string, string, number, number, number, number];

export type LonLat = readonly [number, number];

/** Rings are stored as Google's encoded polyline (1/100 degree, deltas), [lon, lat] pairs. */
const PRECISION = 100;

export function encodeRing(points: readonly LonLat[]): string {
  let out = "";
  let px = 0;
  let py = 0;
  for (const [lon, lat] of points) {
    const x = Math.round(lon * PRECISION);
    const y = Math.round(lat * PRECISION);
    for (let d of [x - px, y - py]) {
      d = d < 0 ? ~(d << 1) : d << 1;
      while (d >= 0x20) {
        out += String.fromCharCode((0x20 | (d & 0x1f)) + 63);
        d >>= 5;
      }
      out += String.fromCharCode(d + 63);
    }
    px = x;
    py = y;
  }
  return out;
}

export function decodeRing(encoded: string): LonLat[] {
  const out: LonLat[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  const next = (): number => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    x += next();
    y += next();
    out.push([x / PRECISION, y / PRECISION]);
  }
  return out;
}

/** Lower case, no accents or punctuation, single spaces, no leading "the". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

const RAD = Math.PI / 180;

export type Vec3 = readonly [number, number, number];

export function toVec(lon: number, lat: number): Vec3 {
  const l = lon * RAD;
  const p = lat * RAD;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}

export function toLonLat(v: Vec3): LonLat {
  const [x, y, z] = v;
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/** Great-circle angle between two places, degrees. */
export function angleBetween(a: LonLat, b: LonLat): number {
  const [ax, ay, az] = toVec(a[0], a[1]);
  const [bx, by, bz] = toVec(b[0], b[1]);
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) / RAD;
}

/** The point a fraction `f` along the great circle from a to b. */
export function slerp(a: LonLat, b: LonLat, f: number): LonLat {
  const va = toVec(a[0], a[1]);
  const vb = toVec(b[0], b[1]);
  const w = angleBetween(a, b) * RAD;
  if (w < 1e-9) return a;
  const sa = Math.sin((1 - f) * w) / Math.sin(w);
  const sb = Math.sin(f * w) / Math.sin(w);
  return toLonLat([sa * va[0] + sb * vb[0], sa * va[1] + sb * vb[1], sa * va[2] + sb * vb[2]]);
}

// ---------------------------------------------------------------------------
// The atlas: decoded countries and places, with a name index.

export interface Country {
  a3: string;
  name: string;
  continent: string;
  subregion: string;
  label: LonLat;
  rings: LonLat[][];
  /** The rings that make up the country on a map of it: not far-flung islands and territories (Alaska, French Guiana). */
  core: LonLat[][];
}

export interface Place {
  name: string;
  a3: string;
  at: LonLat;
  rank: number;
}

/** What a place name means: a spot (a city, "lat,lon") or a set of countries. */
export type Resolved =
  | { kind: "point"; name: string; at: LonLat }
  | { kind: "area"; name: string; countries: number[]; world: boolean };

/** Core rings stay within this angle of the country's label point... */
const CORE_REACH = 30;
/** ...and are at least this share of its largest ring (Crete and Hokkaido are; the Canaries and the Azores are not). */
const CORE_SHARE = 0.02;

function ringArea(ring: readonly LonLat[]): number {
  let s = 0;
  let lat = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    lat += ring[i]![1];
  }
  return Math.abs(s / 2) * Math.cos((lat / Math.max(1, ring.length)) * RAD);
}

function ringCentre(ring: readonly LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of ring) {
    const v = toVec(lon, lat);
    x += v[0];
    y += v[1];
    z += v[2];
  }
  return toLonLat([x, y, z]);
}

export class Atlas {
  readonly countries: Country[];
  readonly places: Place[];
  private readonly names = new Map<string, Resolved>();
  private readonly cities = new Map<string, Place[]>();

  constructor(countryRows: readonly CountryRow[], placeRows: readonly PlaceRow[]) {
    this.countries = countryRows.map(([a3, name, , continent, subregion, lx, ly, encoded]) => {
      const rings = encoded.map(decodeRing);
      const label: LonLat = [lx, ly];
      const largest = Math.max(...rings.map(ringArea));
      const core = rings.filter((r) => ringArea(r) >= largest * CORE_SHARE && angleBetween(ringCentre(r), label) <= CORE_REACH);
      return { a3, name, continent, subregion, label, rings, core: core.length > 0 ? core : rings };
    });
    this.places = placeRows.map(([name, , a3, lat, lon, rank]) => ({ name, a3, at: [lon, lat] as LonLat, rank }));

    const all = this.countries.map((_, i) => i);
    this.names.set("world", { kind: "area", name: "World", countries: all, world: true });
    for (const alias of ["earth", "globe", "the world"]) this.names.set(normalizeName(alias), this.names.get("world")!);
    const groups = new Map<string, number[]>();
    this.countries.forEach((c, i) => {
      // South America is both a continent and a subregion: one entry per country.
      for (const g of new Set([c.continent, c.subregion])) if (g) groups.set(g, [...(groups.get(g) ?? []), i]);
    });
    // Countries win over regions of the same name; a later alias never shadows an earlier name.
    for (const [g, members] of groups) this.names.set(normalizeName(g), { kind: "area", name: g, countries: members, world: false });
    countryRows.forEach(([a3, name], i) => {
      const entry: Resolved = { kind: "area", name, countries: [i], world: false };
      this.names.set(normalizeName(name), entry);
      this.names.set(normalizeName(a3), entry);
    });
    countryRows.forEach(([, name, aliases], i) => {
      for (const alias of aliases.split("|")) {
        const key = normalizeName(alias);
        if (key && !this.names.has(key)) this.names.set(key, { kind: "area", name, countries: [i], world: false });
      }
    });
    placeRows.forEach(([name, ascii], i) => {
      const place = this.places[i]!;
      const keys = new Set([name, ascii, name.split(",")[0]!].filter(Boolean).map(normalizeName));
      for (const key of keys) this.cities.set(key, [...(this.cities.get(key) ?? []), place]);
    });
  }

  /** A country, continent, Natural Earth subregion ("Western Europe"), city ("Lisbon", "Paris, France") or "lat, lon". */
  resolve(query: string): Resolved | undefined {
    const coords = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
    if (coords) {
      const lat = Number(coords[1]);
      const lon = Number(coords[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
      return { kind: "point", name: query.trim(), at: [lon, lat] };
    }
    const key = normalizeName(query);
    const named = this.names.get(key);
    if (named) return named;
    const comma = query.lastIndexOf(",");
    if (comma > 0) {
      const country = this.names.get(normalizeName(query.slice(comma + 1)));
      const city = this.cities.get(normalizeName(query.slice(0, comma)));
      const inCountry = country?.kind === "area" ? city?.filter((p) => country.countries.some((i) => this.countries[i]!.a3 === p.a3)) : undefined;
      if (inCountry?.length) return this.point(inCountry);
    }
    const city = this.cities.get(key);
    return city ? this.point(city) : undefined;
  }

  /** The best-known city of a name (lowest Natural Earth scalerank). */
  private point(candidates: readonly Place[]): Resolved {
    const best = [...candidates].sort((a, b) => a.rank - b.rank)[0]!;
    return { kind: "point", name: best.name, at: best.at };
  }

  /** Known names a misspelt query is close to (at most 3). */
  suggest(query: string): string[] {
    const key = normalizeName(query);
    const scored: [number, string][] = [];
    const consider = (k: string, label: string): void => {
      if (Math.abs(k.length - key.length) > 2) return;
      const d = editDistance(key, k);
      if (d <= Math.max(1, Math.floor(key.length / 3))) scored.push([d, label]);
    };
    for (const [k, v] of this.names) consider(k, v.name);
    for (const [k, list] of this.cities) consider(k, list[0]!.name);
    return [...new Set(scored.sort((a, b) => a[0] - b[0]).map(([, label]) => label))].slice(0, 3);
  }

  /** Points that outline a resolved place, for fitting a view (cities: the point). */
  outline(place: Resolved): LonLat[] {
    if (place.kind === "point") return [place.at];
    const europe = place.countries.length > 1 && /europe/i.test(place.name);
    return place.countries.flatMap((i) => {
      const c = this.countries[i]!;
      const pts = c.core.flat();
      // Natural Earth files Russia under Europe; a map of Europe stops at the Urals.
      return europe && c.a3 === "RUS" ? pts.filter(([lon]) => lon < 60) : pts;
    });
  }

  /** Where a marker for a place goes: the point, or the label point of the (first) country. */
  anchor(place: Resolved): LonLat {
    if (place.kind === "point") return place.at;
    if (place.countries.length === 1) return this.countries[place.countries[0]!]!.label;
    const pts = this.outline(place);
    return ringCentre(pts);
  }
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

// ---------------------------------------------------------------------------
// Projections and views.

export type ProjectionKind = "globe" | "flat";

/** Where the map looks: the centre, and the scale in px per radian at the centre (the globe's radius). */
export interface View {
  lon: number;
  lat: number;
  zoom: number;
}

/** A projected point relative to the frame centre; `visible` false on the globe's far side (then pinned to the rim). */
export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

const MAX_LAT = 85;
const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD) / 2));
const mercLat = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / RAD;
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export type Project = (lon: number, lat: number, lonOffset?: number) => Projected;

/**
 * Orthographic globe or Mercator, centred on the view. The Mercator takes an
 * optional longitude offset (±360) so a ring that crosses the far meridian
 * stays in one piece (`ringPoints`).
 */
export function projector(kind: ProjectionKind, view: View): Project {
  const l0 = view.lon * RAD;
  const p0 = view.lat * RAD;
  const R = view.zoom;
  if (kind === "flat") {
    const y0 = mercY(view.lat);
    return (lon, lat, off = 0) => ({ x: R * (wrap(lon - view.lon) + off) * RAD, y: -R * (mercY(lat) - y0), visible: true });
  }
  const sp0 = Math.sin(p0);
  const cp0 = Math.cos(p0);
  return (lon, lat) => {
    const l = lon * RAD - l0;
    const p = lat * RAD;
    const cp = Math.cos(p);
    const x = R * cp * Math.sin(l);
    const y = -R * (cp0 * Math.sin(p) - sp0 * cp * Math.cos(l));
    if (sp0 * Math.sin(p) + cp0 * cp * Math.cos(l) >= 0) return { x, y, visible: true };
    // Far side: pinned to the rim, so a country cut by the horizon fills up to the edge.
    const r = Math.hypot(x, y);
    return r < 1e-9 ? { x: R, y: 0, visible: false } : { x: (x / r) * R, y: (y / r) * R, visible: false };
  };
}

/** A ring projected for drawing; null when none of it is on the visible side. */
export function ringPoints(kind: ProjectionKind, view: View, project: Project, ring: readonly LonLat[]): Projected[] | null {
  if (kind === "globe") {
    const out = ring.map(([lon, lat]) => project(lon, lat));
    return out.some((p) => p.visible) ? out : null;
  }
  // Keep consecutive points within 180° of each other so the far meridian does not slash across the map.
  let off = 0;
  let prev = wrap(ring[0]![0] - view.lon);
  return ring.map(([lon, lat], i) => {
    const d = wrap(lon - view.lon);
    if (i > 0) {
      if (d - prev > 180) off -= 360;
      else if (prev - d > 180) off += 360;
    }
    prev = d;
    return project(lon, lat, off);
  });
}

/**
 * The view that fits `points` into a width × height frame, filling `fill` of
 * it, never closer than `minSpan` degrees across (a city is a point). On the
 * globe a place larger than a hemisphere shows the whole globe.
 */
export function fitView(kind: ProjectionKind, points: readonly LonLat[], width: number, height: number, fill = 0.8, minSpan = 6): View {
  let [lon, lat] = toLonLat(points.reduce<[number, number, number]>((s, [x, y]) => {
    const v = toVec(x, y);
    return [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
  }, [0, 0, 0]));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) [lon, lat] = points[0] ?? [0, 0];
  const half = (minSpan / 2) * RAD;
  if (kind === "flat") {
    const xs = points.map(([x]) => wrap(x - lon) * RAD);
    const ys = points.map(([, y]) => mercY(y));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const centreLon = wrap(lon + ((x0 + x1) / 2) / RAD);
    const centreLat = mercLat((y0 + y1) / 2);
    const k = Math.cos(centreLat * RAD);
    const zoom = Math.min((width * fill) / Math.max(x1 - x0, (2 * half) / k), (height * fill) / Math.max(y1 - y0, (2 * half) / k));
    return { lon: centreLon, lat: centreLat, zoom };
  }
  const whole = (Math.min(width, height) * fill) / 2;
  // The mean of the points leans toward detailed coasts: centre on the projected box instead (twice, it converges fast).
  for (let pass = 0; ; pass += 1) {
    const project = projector("globe", { lon, lat, zoom: 1 });
    const proj = points.map(([x, y]) => project(x, y));
    if (proj.some((p) => !p.visible)) return { lon, lat, zoom: whole };
    const [x0, x1] = [Math.min(...proj.map((p) => p.x)), Math.max(...proj.map((p) => p.x))];
    const [y0, y1] = [Math.min(...proj.map((p) => p.y)), Math.max(...proj.map((p) => p.y))];
    if (pass === 2) {
      const ex = Math.max(Math.sin(half), (x1 - x0) / 2);
      const ey = Math.max(Math.sin(half), (y1 - y0) / 2);
      return { lon, lat, zoom: Math.max(whole, Math.min((width * fill) / (2 * ex), (height * fill) / (2 * ey))) };
    }
    [lon, lat] = unprojectGlobe(lon, lat, (x0 + x1) / 2, (y0 + y1) / 2);
  }
}

/** The place under (x, y) on a unit globe centred on lon0, lat0 (y down). */
function unprojectGlobe(lon0: number, lat0: number, x: number, y: number): LonLat {
  const rho = Math.hypot(x, y);
  if (rho < 1e-12) return [lon0, lat0];
  const c = Math.asin(Math.min(1, rho));
  const p0 = lat0 * RAD;
  const up = -y;
  const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (up * Math.sin(c) * Math.cos(p0)) / rho);
  const lon = lon0 * RAD + Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(p0) - up * Math.sin(c) * Math.sin(p0));
  return [wrap(lon / RAD), lat / RAD];
}

/** The whole world: the globe turned to `lon, lat`, or the Mercator from 60°S to 75°N. */
export function worldView(kind: ProjectionKind, width: number, height: number, lon = 10, lat = 20, fill = 0.82): View {
  if (kind === "globe") return { lon, lat, zoom: (Math.min(width, height) * fill) / 2 };
  const span = mercY(75) - mercY(-60);
  return { lon, lat: mercLat((mercY(75) + mercY(-60)) / 2), zoom: Math.min(width / (2 * Math.PI), (height * fill) / span) };
}

/**
 * A route on the globe as a flight arc: the great circle through the samples
 * raised off the surface by up to `height` (a fraction of the radius) mid-way.
 * A raised point is visible in front of the globe or outside its disc.
 */
export function globeArc(view: View, samples: readonly LonLat[], height: number): Projected[] {
  const l0 = view.lon * RAD;
  const sp0 = Math.sin(view.lat * RAD);
  const cp0 = Math.cos(view.lat * RAD);
  const n = Math.max(1, samples.length - 1);
  return samples.map(([lon, lat], i) => {
    const l = lon * RAD - l0;
    const p = lat * RAD;
    const cp = Math.cos(p);
    const r = view.zoom * (1 + height * Math.sin((Math.PI * i) / n));
    const x = cp * Math.sin(l);
    const y = -(cp0 * Math.sin(p) - sp0 * cp * Math.cos(l));
    const z = sp0 * Math.sin(p) + cp0 * cp * Math.cos(l);
    return { x: r * x, y: r * y, visible: z >= 0 || Math.hypot(x, y) * r > view.zoom };
  });
}

/** A view between two: the centre along the great circle, the zoom geometric (a push in feels even). */
export function mixView(a: View, b: View, f: number): View {
  const [lon, lat] = slerp([a.lon, a.lat], [b.lon, b.lat], f);
  return { lon, lat, zoom: a.zoom * (b.zoom / a.zoom) ** f };
}
