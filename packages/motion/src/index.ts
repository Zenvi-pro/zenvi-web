/** @zenvi/motion: block manifests, parameter checking and design tokens (pure; the renderer is `@zenvi/motion/node`). */

export { BLOCKS, getBlock } from "./catalog.js";
export { allParams, checkParams, tokenParams, type BlockDuration, type BlockManifest, type ParamSpec, type ParamType, type ParamValue, type Params, type ParamsCheck } from "./params.js";
export { FONT_FACES, FONT_ROLES, FONT_STACKS, PALETTE_NAMES, PALETTES, withAccent, type FontRole, type Palette, type PaletteName, type Tokens } from "./tokens.js";
