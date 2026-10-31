/** The category builders: one call per kind of video, each one undo step (compose.ts). */

import type { CatalogTool } from "../../define.js";
import { explainerTools } from "./explainer.js";
import { productLaunchTools } from "./product-launch.js";
import { talkingHeadTools } from "./talking-head.js";
import { trailerTools } from "./trailer.js";

export const categoryBuilderTools: CatalogTool[] = [...explainerTools, ...productLaunchTools, ...talkingHeadTools, ...trailerTools];
