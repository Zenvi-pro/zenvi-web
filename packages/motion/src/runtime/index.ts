/** The block runtime: what a block's `block.ts` imports. Runs in the page (headless Chrome). */

export { cubicBezier, EASES, resolveEase, spring, type Ease, type EaseName, type SpringOptions } from "./easing.js";
export type { ImageRef, MediaRef, VideoFrames } from "../config.js";
export { createCamera, frameUrl, particlePosition, particles, strokeDrawable, videoTrack, type Camera, type ParticleOptions } from "./effects.js";
export { interpolate, type Value } from "./interpolate.js";
export { createContext, defineBlock, safeArea, type BlockBuild, type BlockConfig, type BlockContext, type Rect } from "./page.js";
export { hashInts, mulberry32, random01, seedOf } from "./rng.js";
export {
  caretBlink,
  counter,
  counterValue,
  formatNumber,
  odometer,
  odometerPositions,
  scramble,
  scrambledText,
  splitText,
  typedCount,
  typewriter,
  typingSeconds,
  type CounterOptions,
  type SplitText,
} from "./text.js";
export { composeTransform, Timeline, type Props, type Target, type Targets, type Track, type TweenOptions } from "./timeline.js";
export {
  alignRing,
  blob,
  bounds,
  centroid,
  chaikin,
  circle,
  morphRings,
  outlinePath,
  perimeter,
  plus,
  prepareMorph,
  regularPolygon,
  resampleRing,
  ringsPath,
  roundRect,
  sector,
  signedArea,
  star,
  toOutline,
  transformOutline,
  transformRing,
  type Morph,
  type MorphOptions,
  type Outline,
  type Point,
  type Ring,
} from "./morph.js";
export { textOutline, traceContours, type TextOutline } from "./outline.js";
export { drawTrail, measure, pointAlong, sampleCurve, slice, type Curve, type PathLine, type TrailStyle } from "./trails.js";
