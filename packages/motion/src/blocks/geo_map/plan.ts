/**
 * The geo_map parameters read against the atlas: every place name resolved,
 * values parsed. Params checking calls it so an unknown place is refused when
 * the block is placed, not drawn as nothing.
 */

import type { Params } from "../../params.js";
import { Atlas, type LonLat, type Resolved } from "./geo.js";
import { COUNTRIES, PLACES } from "./world.gen.js";

let shared: Atlas | undefined;

/** The Natural Earth atlas, decoded on first use. */
export function atlas(): Atlas {
  shared ??= new Atlas(COUNTRIES, PLACES);
  return shared;
}

export interface GeoMarker {
  at: LonLat;
  /** Empty: no label. */
  label: string;
}

export interface GeoPlan {
  focus: Resolved | undefined;
  start: Resolved | undefined;
  /** Country indexes, in the order they fill. */
  highlight: number[];
  markers: GeoMarker[];
  /** Country index → value. */
  values: Map<number, number>;
}

function unknown(a: Atlas, param: string, name: string): string {
  const close = a.suggest(name);
  return `geo_map ${param}: no place called "${name}"${close.length ? ` (did you mean ${close.map((c) => `"${c}"`).join(", ")}?)` : ""}; give a country, continent, region, city or "lat, lon"`;
}

export function planGeoMap(params: Params): GeoPlan | { error: string } {
  const a = atlas();
  const one = (param: string): Resolved | undefined | { error: string } => {
    const name = String(params[param] ?? "").trim();
    if (!name) return undefined;
    return a.resolve(name) ?? { error: unknown(a, param, name) };
  };
  const focus = one("focus");
  if (focus && "error" in focus) return focus;
  const start = one("start");
  if (start && "error" in start) return start;

  const highlight: number[] = [];
  for (const name of (params.highlight as string[] | undefined) ?? []) {
    const r = a.resolve(name);
    if (!r) return { error: unknown(a, "highlight", name) };
    if (r.kind !== "area") return { error: `geo_map highlight: "${name}" is a point; highlight countries or regions (put cities in markers)` };
    for (const i of r.countries) if (!highlight.includes(i)) highlight.push(i);
  }

  const labels = (params.labels as string[] | undefined) ?? [];
  const markers: GeoMarker[] = [];
  for (const [i, name] of ((params.markers as string[] | undefined) ?? []).entries()) {
    const r = a.resolve(name);
    if (!r) return { error: unknown(a, "markers", name) };
    const given = (labels[i] ?? "").trim();
    markers.push({ at: a.anchor(r), label: given === "-" ? "" : given || (r.kind === "point" && /^-?\d/.test(r.name) ? "" : r.name.split(",")[0]!) });
  }

  const values = new Map<number, number>();
  for (const entry of (params.values as string[] | undefined) ?? []) {
    const m = /^(.+?)\s*[=:]\s*([-+]?[\d,]*\.?\d+)\s*\S{0,3}$/.exec(entry.trim());
    if (!m) return { error: `geo_map values: "${entry}" is not "Place=number"` };
    const r = a.resolve(m[1]!);
    if (!r) return { error: unknown(a, "values", m[1]!) };
    if (r.kind !== "area") return { error: `geo_map values: "${m[1]}" is a point; values colour countries or regions` };
    const v = Number(m[2]!.replace(/,/g, ""));
    for (const i of r.countries) values.set(i, v);
  }
  if (!focus && markers.length === 0 && highlight.length === 0 && values.size === 0) return { error: "geo_map needs a focus, markers, highlight or values" };
  return { focus, start, highlight, markers, values };
}

/** The checkParams hook: an error message, or undefined when every place is known. */
export function checkGeoMap(params: Params): string | undefined {
  const plan = planGeoMap(params);
  return "error" in plan ? plan.error : undefined;
}
