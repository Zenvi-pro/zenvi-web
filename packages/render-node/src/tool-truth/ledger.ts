/**
 * The tool truth ledger: known failures (bugs the matrix found and nobody
 * has fixed yet). The coverage classification lives in coverage.ts.
 */

export interface KnownFailure {
  /** What is wrong, with the repro, for whoever fixes it. */
  issue: string;
  /** Fails only in full mode (the libopenshot oracle, or a choice only full mode tries). */
  only?: "full";
}

export const KNOWN_FAILURES: Readonly<Record<string, KnownFailure>> = {
  "set_clip_properties_tool properties.display": {
    issue:
      "render-node never draws the clip's frame-number overlay: display Clip/Timeline/Both changes nothing in renderFrameImage, " +
      "while libopenshot's Clip::GetFrame draws the frame numbers (Clip.cpp, display != FRAME_DISPLAY_NONE). " +
      "Repro: set_clip_properties_tool {properties: {display: 'Clip'}} on any clip, render a frame.",
  },
  "add_effect_tool Compressor.release": {
    issue:
      "render-node's Compressor barely reads release: 1 ms vs 1000 ms (ratio 20, threshold -55 dB, pink noise at -28 dBFS) moves the mix by a -38 dB residual, " +
      "under the -30 dB the matrix calls a change; libopenshot's Compressor (Compressor.cpp) moves its mix. Repro: add_effect_tool Compressor {ratio: 20, threshold: -55, release: 1000} vs release 1.",
  },
  "add_effect_tool ParametricEQ.frequency": {
    only: "full",
    issue:
      "libopenshot 1.0's ParametricEQ ignores the frequency the engine writes: a low-pass at 500 Hz and at 8492 Hz (q 1) both play pink noise at -29.9 dBFS " +
      "on the desktop's Timeline, while render-node filters (residual -3 dB). With linear one-point keyframes the same effect at 8000 Hz outputs silence (-259 dBFS). " +
      "The desktop does not hear eq_tool's filters the way the CLI renders them.",
  },
  "eq_tool preset": {
    only: "full",
    issue: "same root cause as ParametricEQ.frequency: eq_tool's muffle preset (ParametricEQ low-pass bands) changes the render-node mix but not libopenshot's.",
  },
  "add_captions_tool font": {
    only: "full",
    issue:
      "a font only the engine bundles (Instrument Serif, packages/engine/assets/fonts) draws in render-node but libopenshot's Caption effect falls back: the desktop " +
      "has to register the engine's fonts with Qt (QFontDatabase::addApplicationFont) for captions to match. The oracle registers no application fonts; check zenvi-core.",
  },
  "edit_captions_tool font": {
    only: "full",
    issue: "as add_captions_tool font: the engine-bundled family is not available to libopenshot's Caption effect.",
  },
  "add_timer_tool font": {
    only: "full",
    issue: "as add_captions_tool font: libopenshot's Timer effect does not find the engine-bundled family, so the desktop draws the default font.",
  },
  "add_sfx_tool pan": {
    issue:
      "add_sfx_tool pan does nothing for static recipes: impact_punch with pan 1 mixes exactly like pan 0 (residual -inf dB) in render-node " +
      "and libopenshot, though a new WAV is generated per pan value. Repro: add_sfx_tool {recipe: 'impact_punch', kit: 'synth', at_seconds: 0.2, pan: 1}.",
  },
};
