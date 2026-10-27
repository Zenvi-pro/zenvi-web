/**
 * Audition a sound effect in the library: the engine renders the recipe
 * (the same synth add_sfx_tool writes to a file), played once through Web
 * Audio. Renders are cached per recipe; one sound plays at a time.
 */
import { renderSfx } from "@zenvi/engine";

let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;
const buffers = new Map<string, AudioBuffer>();

function bufferFor(ctx: AudioContext, recipe: string): AudioBuffer {
  let buffer = buffers.get(recipe);
  if (!buffer) {
    const audio = renderSfx(recipe);
    buffer = ctx.createBuffer(2, audio.left.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.left);
    buffer.getChannelData(1).set(audio.right);
    buffers.set(recipe, buffer);
  }
  return buffer;
}

/** Play `recipe`; `onEnded` fires when it finishes or another sound replaces it. */
export function audition(recipe: string, onEnded: () => void): void {
  context ??= new AudioContext();
  void context.resume();
  stopAudition();
  const source = context.createBufferSource();
  source.buffer = bufferFor(context, recipe);
  source.connect(context.destination);
  source.onended = () => {
    if (playing === source) playing = null;
    onEnded();
  };
  playing = source;
  source.start();
}

export function stopAudition(): void {
  playing?.stop();
  playing = null;
}
