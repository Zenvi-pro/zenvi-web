/**
 * EXIF orientation of a JPEG, read from its APP1 segment.
 *
 * The desktop's QtImageReader opens images with `setAutoTransform(true)`
 * (libopenshot src/QtImageReader.cpp), so a portrait phone photo stored
 * landscape with orientation 6 reports swapped width/height and decodes
 * upright. ffmpeg's image demuxers ignore EXIF, so the probe and the still
 * decoder apply it themselves.
 */

import { open } from "node:fs/promises";

/** EXIF orientation 1..8 (1 = as stored). */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Orientations 5..8 swap width and height. */
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

/**
 * ffmpeg filters that turn a stored image upright for an orientation
 * (EXIF 2.3 tag 0x0112 semantics).
 */
export function orientationFilters(orientation: ExifOrientation): string[] {
  switch (orientation) {
    case 2:
      return ["hflip"];
    case 3:
      return ["hflip", "vflip"];
    case 4:
      return ["vflip"];
    case 5:
      return ["transpose=0"];
    case 6:
      return ["transpose=1"];
    case 7:
      return ["transpose=3"];
    case 8:
      return ["transpose=2"];
    default:
      return [];
  }
}

function readOrientationFromTiff(view: DataView, tiffStart: number): ExifOrientation {
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return 1;
  const ifdOffset = view.getUint32(tiffStart + 4, little);
  const ifd = tiffStart + ifdOffset;
  if (ifd + 2 > view.byteLength) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
    }
  }
  return 1;
}

/** Parse the orientation from the first bytes of a JPEG (1 when absent). */
export function jpegOrientation(bytes: Uint8Array): ExifOrientation {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return 1; // start of scan / end of image
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      const isExif =
        view.getUint32(offset + 4) === 0x45786966 && // "Exif"
        view.getUint16(offset + 8) === 0x0000;
      if (isExif && offset + 10 + 8 <= view.byteLength) return readOrientationFromTiff(view, offset + 10);
    }
    offset += 2 + length;
  }
  return 1;
}

/** Orientation of an image file; only JPEG carries one the desktop honors here. */
export async function imageOrientation(path: string): Promise<ExifOrientation> {
  if (!/\.(jpe?g|jpe)$/i.test(path)) return 1;
  const handle = await open(path, "r");
  try {
    const buffer = new Uint8Array(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return jpegOrientation(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
