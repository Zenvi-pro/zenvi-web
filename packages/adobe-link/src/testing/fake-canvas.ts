/**
 * A stand-in for the CEP page's canvas (Chromium), for the title renderer
 * (extension/server/titles.js) under Node. It records what is drawn, measures
 * text at 0.55 em per character, and toDataURL gives a real transparent PNG
 * of the canvas size, so the host script's PNG size reader sees true dimensions.
 */

import { deflateSync } from "node:zlib";

export interface DrawOp {
  op: "fillText" | "strokeText" | "fillRect" | "clearRect";
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  font: string;
  textAlign: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  shadowColor: string;
  shadowBlur: number;
  letterSpacing: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A valid fully transparent RGBA PNG. */
export function transparentPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

export class FakeContext2D {
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineJoin = "miter";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  /** Chromium 99+ has it; drawTitle uses it only when present. */
  letterSpacing = "0px";
  private readonly saved: Partial<FakeContext2D>[] = [];

  constructor(readonly ops: DrawOp[]) {}

  /** 0.55 em per character at the current font size. */
  measureText(text: string): { width: number } {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * size * 0.55 };
  }

  private record(op: DrawOp["op"], x: number, y: number, extra: Partial<DrawOp> = {}): void {
    this.ops.push({
      op,
      x,
      y,
      font: this.font,
      textAlign: this.textAlign,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      letterSpacing: this.letterSpacing,
      ...extra,
    });
  }

  fillText(text: string, x: number, y: number): void {
    this.record("fillText", x, y, { text });
  }

  strokeText(text: string, x: number, y: number): void {
    this.record("strokeText", x, y, { text });
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.record("fillRect", x, y, { width, height });
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.record("clearRect", x, y, { width, height });
  }

  save(): void {
    this.saved.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, shadowOffsetX: this.shadowOffsetX, shadowOffsetY: this.shadowOffsetY });
  }

  restore(): void {
    Object.assign(this, this.saved.pop() ?? {});
  }
}

export class FakeCanvas {
  width = 300;
  height = 150;
  readonly ops: DrawOp[] = [];
  private context: FakeContext2D | undefined;

  getContext(kind: string): FakeContext2D {
    if (kind !== "2d") throw new Error(`FakeCanvas: no ${kind} context`);
    this.context ??= new FakeContext2D(this.ops);
    return this.context;
  }

  toDataURL(type = "image/png"): string {
    if (type !== "image/png") throw new Error(`FakeCanvas: no ${type}`);
    return `data:image/png;base64,${transparentPng(this.width, this.height).toString("base64")}`;
  }
}

/** A `document` that makes FakeCanvases, keeping each one for assertions. */
export function fakeDocument(): { createElement(tag: string): FakeCanvas; canvases: FakeCanvas[] } {
  const canvases: FakeCanvas[] = [];
  return {
    canvases,
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`fakeDocument: no <${tag}>`);
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
  };
}
