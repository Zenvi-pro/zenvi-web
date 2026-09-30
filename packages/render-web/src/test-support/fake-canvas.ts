/**
 * Minimal Canvas2D doubles for orchestration tests in Node: a recording
 * context, plus pixel storage for the getImageData/putImageData stages.
 * Real pixels are covered by the browser suite (e2e/).
 */

export interface Call {
  op: string;
  args: unknown[];
  state: { alpha: number; composite: string; transform: number[]; fill: unknown };
}

export class FakeImage {
  closed = false;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly label = "image",
  ) {}
  close() {
    this.closed = true;
  }
}

export class FakeContext {
  calls: Call[] = [];
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  fillStyle: unknown = "#000";
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  transform = [1, 0, 0, 1, 0, 0];
  private stack: unknown[] = [];
  pixels: Uint8ClampedArray;

  constructor(
    readonly canvas: { width: number; height: number; label?: string },
    readonly label = "main",
  ) {
    this.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  private record(op: string, args: unknown[]) {
    this.calls.push({ op, args, state: { alpha: this.globalAlpha, composite: this.globalCompositeOperation, transform: [...this.transform], fill: this.fillStyle } });
  }

  save() {
    this.stack.push({ a: this.globalAlpha, c: this.globalCompositeOperation, t: [...this.transform], f: this.fillStyle });
    this.record("save", []);
  }
  restore() {
    const s = this.stack.pop() as { a: number; c: string; t: number[]; f: unknown } | undefined;
    if (s) {
      this.globalAlpha = s.a;
      this.globalCompositeOperation = s.c;
      this.transform = s.t;
      this.fillStyle = s.f;
    }
    this.record("restore", []);
  }
  setTransform(...m: number[]) {
    this.transform = m;
    this.record("setTransform", m);
  }
  beginPath() {
    this.record("beginPath", []);
  }
  rect(...args: number[]) {
    this.record("rect", args);
  }
  clip() {
    this.record("clip", []);
  }
  clearRect(...args: number[]) {
    this.pixels.fill(0);
    this.record("clearRect", args);
  }
  fillRect(...args: number[]) {
    this.record("fillRect", args);
  }
  drawImage(image: unknown, ...args: number[]) {
    const label = (image as { label?: string }).label ?? "?";
    // Pixel stages copy a scratch canvas 1:1 when sizes match.
    const source = image as { __ctx?: FakeContext };
    if (source.__ctx && source.__ctx.pixels.length === this.pixels.length) this.pixels.set(source.__ctx.pixels);
    this.record("drawImage", [label, ...args]);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.record("getImageData", [w, h]);
    return { data: new Uint8ClampedArray(this.pixels), width: w, height: h };
  }
  putImageData(data: { data: Uint8ClampedArray }, ...args: number[]) {
    if (data.data.length === this.pixels.length) this.pixels.set(data.data);
    this.record("putImageData", args);
  }

  ops(): string[] {
    return this.calls.map((c) => c.op);
  }
}

let scratchCount = 0;

export class FakeOffscreenCanvas {
  label: string;
  private _width: number;
  private _height: number;
  __ctx: FakeContext;
  static created: FakeOffscreenCanvas[] = [];
  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;
    scratchCount += 1;
    this.label = `scratch${scratchCount}`;
    this.__ctx = new FakeContext(this, this.label);
    FakeOffscreenCanvas.created.push(this);
  }
  get width() {
    return this._width;
  }
  set width(v: number) {
    this._width = v;
    this.__ctx.pixels = new Uint8ClampedArray(this._width * this._height * 4);
  }
  get height() {
    return this._height;
  }
  set height(v: number) {
    this._height = v;
    this.__ctx.pixels = new Uint8ClampedArray(this._width * this._height * 4);
  }
  getContext() {
    return this.__ctx;
  }
}

export class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

/** Install the doubles as globals for the duration of a test file. */
export function installFakeCanvas(): () => void {
  const g = globalThis as Record<string, unknown>;
  const previous = { OffscreenCanvas: g.OffscreenCanvas, ImageData: g.ImageData };
  g.OffscreenCanvas = FakeOffscreenCanvas;
  g.ImageData = FakeImageData;
  return () => {
    g.OffscreenCanvas = previous.OffscreenCanvas;
    g.ImageData = previous.ImageData;
  };
}
