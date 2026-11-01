/** @zenvi/motion/node: render motion blocks and agent-written scenes with headless Chrome + ffmpeg. */

export { ChromeLaunchError, ChromeMissingError, LAUNCH_TIMEOUT_MS, chromeArgs, chromeCacheDir, closeChrome, findChrome, installChrome, launchChrome, leaseChrome } from "./chrome.js";
export { blockPage, motionDir, pageHtml, writeBlockPages, type BlockPage } from "./page.js";
export {
  blockEvents,
  designSize,
  encodeArgs,
  fingerprintRender,
  motionCacheDir,
  MotionBlockError,
  renderBlock,
  RENDERER_VERSION,
  sampleTimes,
  type BlockEventsOptions,
  type Fps,
  type MotionCodec,
  type RenderBlockOptions,
  type RenderedBlock,
} from "./render.js";
export { blockInfo, createMotionHost, runtimeStatus, type MotionHostOptions } from "./host.js";
export { draftScene, renderScene, SCENE_CSP, SceneJobError, type DraftOptions, type DraftResult, type RenderSceneOptions, type RenderSceneResult, type SceneJob } from "./scene-render.js";
export { lintScene, lintText, type LintProblem } from "./scene-lint.js";
