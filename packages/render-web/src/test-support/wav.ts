/**
 * A 16-bit PCM WAV file built in memory: a media fixture that needs no ffmpeg,
 * so registry and audio tests also run where ffmpeg is missing.
 */

export function makeWav(options: { seconds: number; sampleRate?: number; channels?: number; frequency?: number }): Uint8Array {
  const sampleRate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;
  const frequency = options.frequency ?? 440;
  const frames = Math.round(options.seconds * sampleRate);
  const dataBytes = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.5 * 32767);
    for (let c = 0; c < channels; c += 1) view.setInt16(44 + (i * channels + c) * 2, value, true);
  }
  return bytes;
}
