/**
 * Minimal PNG encoder (8-bit RGBA) for preview frames, so previewing one frame
 * does not need an extra ffmpeg process. Rows use the Up filter, which
 * compresses video frames well and costs one subtraction per byte.
 */

import * as zlib from "node:zlib";
import type { RgbaImage } from "@zenvi/engine";

let crcTable: Uint32Array | undefined;

function crc32Fallback(bytes: Uint8Array, seed = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const nativeCrc32 = (zlib as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;

function crc32(bytes: Uint8Array, seed = 0): number {
  return nativeCrc32 ? nativeCrc32(bytes, seed) >>> 0 : crc32Fallback(bytes, seed);
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

export function encodePng(image: RgbaImage, level = 6): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    const src = y * stride;
    if (y === 0) {
      raw[row] = 0;
      raw.set(data.subarray(src, src + stride), row + 1);
    } else {
      raw[row] = 2; // Up
      const prev = src - stride;
      for (let x = 0; x < stride; x += 1) raw[row + 1 + x] = (data[src + x]! - data[prev + x]!) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
