/** Big-endian reads from a font file's bytes, and where its tables are (OpenType spec, "Organization of an OpenType Font"). */

export interface Reader {
  u8(at: number): number;
  u16(at: number): number;
  i16(at: number): number;
  u32(at: number): number;
  tag(at: number): string;
}

export function reader(bytes: Uint8Array): Reader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    u8: (at) => view.getUint8(at),
    u16: (at) => view.getUint16(at),
    i16: (at) => view.getInt16(at),
    u32: (at) => view.getUint32(at),
    tag: (at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3)),
  };
}

/** Offset of a table in the font file, or -1. */
export function tableOffset(r: Reader, tag: string): number {
  const count = r.u16(4);
  for (let i = 0; i < count; i += 1) {
    const rec = 12 + i * 16;
    if (r.tag(rec) === tag) return r.u32(rec + 8);
  }
  return -1;
}
