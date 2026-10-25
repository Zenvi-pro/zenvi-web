/**
 * PNG decoding in pure TypeScript (zlib inflate, RFC 1950/1951, and the PNG
 * scanline filters), so tools can measure the frames a host renders
 * (`FrameHost.renderFrame` answers with PNG bytes) without a platform image
 * API. Every PNG colour type and bit depth decodes, interlaced or not, to
 * 8-bit straight RGBA (16-bit samples keep their high byte; a `tRNS` chunk
 * becomes alpha). Ancillary chunks (gamma, ICC) are ignored.
 */

import type { RgbaImage } from "../render/types.js";

export class PngDecodeError extends Error {
  override readonly name = "PngDecodeError";
}

// ---------------------------------------------------------------------------
// Inflate
// ---------------------------------------------------------------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code as a direct lookup on the next `bits` input bits: entry = symbol << 4 | length. */
interface Huffman {
  table: Int32Array;
  bits: number;
}

function buildHuffman(lengths: ArrayLike<number>, count: number): Huffman {
  let maxLen = 0;
  const lenCount = new Int32Array(16);
  for (let i = 0; i < count; i += 1) {
    const len = lengths[i]!;
    lenCount[len]! += 1;
    if (len > maxLen) maxLen = len;
  }
  if (maxLen === 0) return { table: new Int32Array(1).fill(-1), bits: 1 };
  lenCount[0] = 0;
  const next = new Int32Array(16);
  let code = 0;
  for (let len = 1; len <= 15; len += 1) {
    code = (code + lenCount[len - 1]!) << 1;
    next[len] = code;
  }
  const size = 1 << maxLen;
  const table = new Int32Array(size).fill(-1);
  for (let symbol = 0; symbol < count; symbol += 1) {
    const len = lengths[symbol]!;
    if (!len) continue;
    const c = next[len]!;
    next[len] = c + 1;
    // Codes are packed MSB-first; the bit reader is LSB-first, so index by the reversed code.
    let reversed = 0;
    for (let i = 0; i < len; i += 1) reversed |= ((c >> i) & 1) << (len - 1 - i);
    const entry = (symbol << 4) | len;
    for (let i = reversed; i < size; i += 1 << len) table[i] = entry;
  }
  return { table, bits: maxLen };
}

let fixedLitLen: Huffman | undefined;
let fixedDist: Huffman | undefined;

function fixedCodes(): [Huffman, Huffman] {
  if (!fixedLitLen || !fixedDist) {
    const lengths = new Uint8Array(288);
    lengths.fill(8, 0, 144);
    lengths.fill(9, 144, 256);
    lengths.fill(7, 256, 280);
    lengths.fill(8, 280, 288);
    fixedLitLen = buildHuffman(lengths, 288);
    fixedDist = buildHuffman(new Uint8Array(30).fill(5), 30);
  }
  return [fixedLitLen, fixedDist];
}

class Inflater {
  private pos: number;
  private bitBuf = 0;
  private bitCount = 0;
  private out: Uint8Array;
  private outLen = 0;

  constructor(
    private readonly src: Uint8Array,
    start: number,
    sizeHint: number,
  ) {
    this.pos = start;
    this.out = new Uint8Array(Math.max(1024, sizeHint));
  }

  private need(n: number): void {
    while (this.bitCount < n) {
      // A few zero bytes past the end let the last code be looked up; more means the data is truncated.
      if (this.pos >= this.src.length + 4) throw new PngDecodeError("compressed image data ends early");
      const byte = this.pos < this.src.length ? this.src[this.pos]! : 0;
      this.pos += 1;
      this.bitBuf |= byte << this.bitCount;
      this.bitCount += 8;
    }
  }

  private bits(n: number): number {
    if (n === 0) return 0;
    this.need(n);
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return v;
  }

  private decode(h: Huffman): number {
    this.need(h.bits);
    const entry = h.table[this.bitBuf & ((1 << h.bits) - 1)]!;
    if (entry < 0) throw new PngDecodeError("invalid Huffman code in compressed image data");
    const len = entry & 15;
    this.bitBuf >>>= len;
    this.bitCount -= len;
    return entry >> 4;
  }

  private ensure(extra: number): void {
    if (this.outLen + extra <= this.out.length) return;
    let size = this.out.length * 2;
    while (size < this.outLen + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.out.subarray(0, this.outLen));
    this.out = grown;
  }

  private stored(): void {
    // Skip to the byte boundary: whole bytes already pulled into the bit buffer go back to the input.
    this.pos -= this.bitCount >> 3;
    this.bitBuf = 0;
    this.bitCount = 0;
    if (this.pos + 4 > this.src.length) throw new PngDecodeError("compressed image data ends early");
    const len = this.src[this.pos]! | (this.src[this.pos + 1]! << 8);
    const nlen = this.src[this.pos + 2]! | (this.src[this.pos + 3]! << 8);
    if ((len ^ 0xffff) !== nlen) throw new PngDecodeError("corrupt stored block in compressed image data");
    this.pos += 4;
    if (this.pos + len > this.src.length) throw new PngDecodeError("compressed image data ends early");
    this.ensure(len);
    this.out.set(this.src.subarray(this.pos, this.pos + len), this.outLen);
    this.outLen += len;
    this.pos += len;
  }

  private dynamicCodes(): [Huffman, Huffman] {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;
    if (nlen > 286 || ndist > 30) throw new PngDecodeError("bad Huffman table in compressed image data");
    const codeLengths = new Uint8Array(19);
    for (let i = 0; i < ncode; i += 1) codeLengths[CODE_LENGTH_ORDER[i]!] = this.bits(3);
    const codeCode = buildHuffman(codeLengths, 19);
    const lengths = new Uint8Array(nlen + ndist);
    let i = 0;
    while (i < nlen + ndist) {
      const sym = this.decode(codeCode);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      let repeat: number;
      let value = 0;
      if (sym === 16) {
        if (i === 0) throw new PngDecodeError("bad Huffman table in compressed image data");
        value = lengths[i - 1]!;
        repeat = 3 + this.bits(2);
      } else if (sym === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (i + repeat > nlen + ndist) throw new PngDecodeError("bad Huffman table in compressed image data");
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    return [buildHuffman(lengths.subarray(0, nlen), nlen), buildHuffman(lengths.subarray(nlen), ndist)];
  }

  private codes(litLen: Huffman, dist: Huffman): void {
    for (;;) {
      const sym = this.decode(litLen);
      if (sym < 256) {
        this.ensure(1);
        this.out[this.outLen++] = sym;
        continue;
      }
      if (sym === 256) return;
      const li = sym - 257;
      if (li >= 29) throw new PngDecodeError("bad length code in compressed image data");
      const length = LENGTH_BASE[li]! + this.bits(LENGTH_EXTRA[li]!);
      const di = this.decode(dist);
      if (di >= 30) throw new PngDecodeError("bad distance code in compressed image data");
      const distance = DIST_BASE[di]! + this.bits(DIST_EXTRA[di]!);
      if (distance > this.outLen) throw new PngDecodeError("distance too far back in compressed image data");
      this.ensure(length);
      const out = this.out;
      let from = this.outLen - distance;
      for (let k = 0; k < length; k += 1) out[this.outLen++] = out[from++]!;
    }
  }

  run(): Uint8Array {
    let last = 0;
    while (!last) {
      last = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) {
        const [lit, dist] = fixedCodes();
        this.codes(lit, dist);
      } else if (type === 2) {
        const [lit, dist] = this.dynamicCodes();
        this.codes(lit, dist);
      } else {
        throw new PngDecodeError("bad block type in compressed image data");
      }
    }
    return this.out.subarray(0, this.outLen);
  }
}

/** zlib-wrapped deflate data (RFC 1950) → bytes. `sizeHint` presizes the output. */
export function zlibInflate(data: Uint8Array, sizeHint = 0): Uint8Array {
  if (data.length < 2) throw new PngDecodeError("compressed image data is empty");
  const cmf = data[0]!;
  const flg = data[1]!;
  if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31 !== 0) throw new PngDecodeError("compressed image data is not zlib/deflate");
  if (flg & 0x20) throw new PngDecodeError("compressed image data needs a preset dictionary");
  return new Inflater(data, 2, sizeHint).run();
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ALLOWED_DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7: x0, y0, dx, dy per pass.
const ADAM7: [number, number, number, number][] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undo the scanline filters of one (sub)image in place; returns the offset after it. */
function unfilter(raw: Uint8Array, at: number, stride: number, rows: number, bpp: number, out: Uint8Array): number {
  let prev: Uint8Array | null = null;
  for (let y = 0; y < rows; y += 1) {
    if (at >= raw.length) throw new PngDecodeError("image data ends early");
    const filter = raw[at]!;
    const line = raw.subarray(at + 1, at + 1 + stride);
    if (line.length < stride) throw new PngDecodeError("image data ends early");
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp]! : 0;
      const up = prev ? prev[x]! : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      switch (filter) {
        case 0:
          break;
        case 1:
          v += left;
          break;
        case 2:
          v += up;
          break;
        case 3:
          v += (left + up) >> 1;
          break;
        case 4:
          v += paeth(left, up, upLeft);
          break;
        default:
          throw new PngDecodeError(`unknown PNG filter type ${filter}`);
      }
      row[x] = v & 255;
    }
    prev = row;
    at += 1 + stride;
  }
  return at;
}

/** Sample `index` of a row of `depth`-bit samples, scaled to 8 bits (palette indexes stay raw when `raw`). */
function sample(row: Uint8Array, index: number, depth: number, raw = false): number {
  if (depth === 8) return row[index]!;
  if (depth === 16) return row[index * 2]!;
  const perByte = 8 / depth;
  const byte = row[Math.floor(index / perByte)]!;
  const shift = 8 - depth * ((index % perByte) + 1);
  const v = (byte >> shift) & ((1 << depth) - 1);
  return raw ? v : Math.round((v * 255) / ((1 << depth) - 1));
}

/** Full-precision sample (for tRNS comparisons). */
function exactSample(row: Uint8Array, index: number, depth: number): number {
  if (depth === 16) return (row[index * 2]! << 8) | row[index * 2 + 1]!;
  return sample(row, index, depth, true);
}

/** Decode a PNG to 8-bit straight RGBA. Throws `PngDecodeError` for anything that is not a valid PNG. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new PngDecodeError("not a PNG image");
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (body.length < len) throw new PngDecodeError(`PNG chunk ${type} ends early`);
    if (type === "IHDR") {
      header = { width: u32(body, 0), height: u32(body, 4), depth: body[8]!, colorType: body[9]!, interlace: body[12]! };
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!header) throw new PngDecodeError("PNG has no IHDR chunk");
  const { width, height, depth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  if (!channels || !ALLOWED_DEPTHS[colorType]!.includes(depth)) throw new PngDecodeError(`unsupported PNG colour type ${colorType} / depth ${depth}`);
  if (width <= 0 || height <= 0) throw new PngDecodeError("PNG has no pixels");
  if (colorType === 3 && !palette) throw new PngDecodeError("palette PNG without a palette");
  if (interlace > 1) throw new PngDecodeError(`unknown PNG interlace method ${interlace}`);

  const total = idat.reduce((n, c) => n + c.length, 0);
  const compressed = new Uint8Array(total);
  let offset = 0;
  for (const c of idat) {
    compressed.set(c, offset);
    offset += c.length;
  }
  const bitsPerPixel = depth * channels;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const strideOf = (w: number): number => Math.ceil((w * bitsPerPixel) / 8);
  const raw = zlibInflate(compressed, (strideOf(width) + 1) * height);

  const out = new Uint8ClampedArray(width * height * 4);
  const writeRow = (row: Uint8Array, y: number, x0: number, dx: number, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const o = (y * width + x0 + i * dx) * 4;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      if (colorType === 0) {
        r = g = b = sample(row, i, depth);
        if (trns && trns.length >= 2 && exactSample(row, i, depth) === ((trns[0]! << 8) | trns[1]!)) a = 0;
      } else if (colorType === 2) {
        r = sample(row, i * 3, depth);
        g = sample(row, i * 3 + 1, depth);
        b = sample(row, i * 3 + 2, depth);
        if (
          trns &&
          trns.length >= 6 &&
          exactSample(row, i * 3, depth) === ((trns[0]! << 8) | trns[1]!) &&
          exactSample(row, i * 3 + 1, depth) === ((trns[2]! << 8) | trns[3]!) &&
          exactSample(row, i * 3 + 2, depth) === ((trns[4]! << 8) | trns[5]!)
        ) {
          a = 0;
        }
      } else if (colorType === 3) {
        const index = sample(row, i, depth, true);
        if (index * 3 + 2 >= palette!.length) throw new PngDecodeError("palette index out of range");
        r = palette![index * 3]!;
        g = palette![index * 3 + 1]!;
        b = palette![index * 3 + 2]!;
        if (trns && index < trns.length) a = trns[index]!;
      } else if (colorType === 4) {
        r = g = b = sample(row, i * 2, depth);
        a = sample(row, i * 2 + 1, depth);
      } else {
        r = sample(row, i * 4, depth);
        g = sample(row, i * 4 + 1, depth);
        b = sample(row, i * 4 + 2, depth);
        a = sample(row, i * 4 + 3, depth);
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  };

  if (interlace === 0) {
    const stride = strideOf(width);
    const pixels = new Uint8Array(stride * height);
    unfilter(raw, 0, stride, height, bpp, pixels);
    for (let y = 0; y < height; y += 1) writeRow(pixels.subarray(y * stride, (y + 1) * stride), y, 0, 1, width);
  } else {
    let pos = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const stride = strideOf(pw);
      const pixels = new Uint8Array(stride * ph);
      pos = unfilter(raw, pos, stride, ph, bpp, pixels);
      for (let j = 0; j < ph; j += 1) writeRow(pixels.subarray(j * stride, (j + 1) * stride), y0 + j * dy, x0, dx, pw);
    }
  }
  return { width, height, data: out };
}

/** `decodePng` of base64 text (a `ToolImage.data`). */
export function decodePngBase64(base64: string): RgbaImage {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return decodePng(bytes);
}
