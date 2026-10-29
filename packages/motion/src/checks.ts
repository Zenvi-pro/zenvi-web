/**
 * Checks a block's parameters need beyond their types, by block id: a place
 * name the geo_map atlas must know. An error is refused like a bad type.
 */

import { checkGeoMap } from "./blocks/geo_map/plan.js";
import type { Params } from "./params.js";

export const BLOCK_CHECKS: Readonly<Record<string, (params: Params) => string | undefined>> = {
  geo_map: checkGeoMap,
};
