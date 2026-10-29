/**
 * Checks a block's parameters need beyond their types, by block id: a place
 * name the geo_map atlas must know, a pictogram that fits in 400 icons,
 * a value for every period of a race. An error is refused like a bad type.
 */

import { checkRace } from "./blocks/bar_race/race.js";
import { checkGeoMap } from "./blocks/geo_map/plan.js";
import { checkPictogram } from "./blocks/pictogram_morph/layout.js";
import type { Params } from "./params.js";

export const BLOCK_CHECKS: Readonly<Record<string, (params: Params) => string | undefined>> = {
  bar_race: checkRace,
  geo_map: checkGeoMap,
  pictogram_morph: checkPictogram,
};
