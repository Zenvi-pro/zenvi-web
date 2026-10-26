/** @zenvi/motion/node: render motion blocks with headless Chrome + ffmpeg. */

export { ChromeLaunchError, ChromeMissingError, LAUNCH_TIMEOUT_MS, chromeCacheDir, closeChrome, findChrome, installChrome, launchChrome, leaseChrome } from "./chrome.js";
export { blockPage, motionDir, pageHtml, writeBlockPages, type BlockPage } from "./page.js";
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
export { blockInfo, createMotionHost, runtimeStatus, type MotionHostOptions } from "./host.js";
