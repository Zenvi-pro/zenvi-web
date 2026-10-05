export * from "./types.js";
export { AE_TOOLS } from "./aftereffects.js";
export { PREMIERE_TOOLS } from "./premiere.js";

import { AE_TOOLS } from "./aftereffects.js";
import { PREMIERE_TOOLS } from "./premiere.js";
import { toCatalogJson, type CatalogJson, type HostId, type HostToolDef } from "./types.js";

/** Every tool definition for one host. */
export function catalogFor(host: HostId): readonly HostToolDef[] {
  return host === "aftereffects" ? AE_TOOLS : PREMIERE_TOOLS;
}

/** File name of a host's bundled catalog in `extension/catalog/`. */
export function catalogFileName(host: HostId): string {
  return `${host}.json`;
}

/** The exact text `npm run gen:catalog` writes for a host (and the staleness test compares). */
export function catalogFileText(host: HostId): string {
  const json: CatalogJson = toCatalogJson(host, catalogFor(host));
  return `${JSON.stringify(json, null, 2)}\n`;
}
