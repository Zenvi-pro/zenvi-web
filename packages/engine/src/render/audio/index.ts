/**
 * libopenshot 1.0 audio effects (src/audio_effects/) as pure TypeScript
 * kernels. `registry.ts` maps class names to kernels; the modules export the
 * pieces tests and tools reuse (coefficient functions, the libc generator).
 */

export { getAudioKernel, supportedAudioEffects } from "./registry.js";
export { compressor, expander } from "./dynamics.js";
export { delay, echo } from "./delay.js";
export { distortion, toneCoefficients } from "./distortion.js";
export { eqCoefficients, parametricEq } from "./parametric-eq.js";
export { noise, noiseBlock } from "./noise.js";
export { robotization, whisperization } from "./spectral.js";
export { fnv1a32, LibcRand, RAND_MAX } from "./libc-rand.js";
export { IIRFilter, iirCoefficients } from "./iir.js";
