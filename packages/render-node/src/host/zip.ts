/**
 * Just enough of the zip format to read Zenvi desktop's recovery copies:
 * each save zips the project as one deflated entry
 * (`zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)`, zenvi-core
 * main_window.py). Stored and deflated entries, sizes from the central
 * directory; no zip64, no encryption.
 */

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  /** The entry's bytes (inflated). */
  data(): Buffer;
}

export class ZipError extends Error {
  override readonly name = "ZipError";
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function endOfCentralDirectory(zip: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65535.
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === EOCD) return at;
  }
  throw new ZipError("not a zip file (no end of central directory)");
}

/** The entries of a zip file, in central directory order. Throws ZipError for a damaged file. */
export function readZipEntries(zip: Buffer): ZipEntry[] {
  if (zip.length < 22) throw new ZipError("not a zip file (too short)");
  const eocd = endOfCentralDirectory(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) throw new ZipError("damaged central directory");
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    entries.push({
      name,
      data: () => {
        if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) throw new ZipError(`damaged entry ${name}`);
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const raw = zip.subarray(start, start + compressed);
        if (raw.length !== compressed) throw new ZipError(`truncated entry ${name}`);
        const bytes = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
        if (!bytes) throw new ZipError(`entry ${name} uses compression method ${method}`);
        if (bytes.length !== size) throw new ZipError(`entry ${name} is ${bytes.length} bytes, expected ${size}`);
        return bytes;
      },
    });
  }
  return entries;
}
