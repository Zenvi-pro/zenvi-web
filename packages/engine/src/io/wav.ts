/**
 * WAV (RIFF, 16-bit integer PCM) encoding in pure TypeScript, so generated
 * audio (procedural sound effects, speech uploads) can be written on every
 * surface without a platform encoder.
 */

/** A WAV file of float channels (-1..1, equal lengths, interleaved on write) as 16-bit PCM. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length === 0) throw new Error("encodeWav needs at least one channel");
  const frames = channels[0]!.length;
  if (channels.some((ch) => ch.length !== frames)) throw new Error("encodeWav channels must have the same length");
  const count = channels.length;
  const dataBytes = frames * count * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < count; c += 1) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return bytes;
}
