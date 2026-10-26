/** @zenvi/motion/node: render motion blocks with headless Chrome + ffmpeg. */

export { ChromeMissingError, chromeCacheDir, findChrome, installChrome, launchChrome } from "./chrome.js";
export { blockPage, motionDir, pageHtml, type BlockPage } from "./page.js";
export {
  designSize,
  encodeArgs,
  fingerprintRender,
  motionCacheDir,
  MotionBlockError,
  renderBlock,
  RENDERER_VERSION,
  sampleTimes,
  type Fps,
  type MotionCodec,
  type RenderBlockOptions,
  type RenderedBlock,
} from "./render.js";
export { blockInfo, createMotionHost, type MotionHostOptions } from "./host.js";
