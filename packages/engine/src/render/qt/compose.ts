/**
 * Qt raster composition modes on premultiplied RGBA8 bytes, ported from
 * qtbase 5.15 src/gui/painting/qcompositionfunctions.cpp (the
 * `Argb32OperationsC` templates and the `*_op` helpers). `constAlpha` is the
 * span coverage already combined with painter opacity (0..255), exactly what
 * Qt passes as `const_alpha`. libopenshot `CompositeType` codes equal
 * `QPainter::CompositionMode` (Enums.h), so `mode` is the clip's `composite`.
 */

import { byteMul } from "../pixels.js";

/** libopenshot `CompositeType` / `QPainter::CompositionMode`. */
export const CompositionMode = {
  SourceOver: 0,
  DestinationOver: 1,
  Clear: 2,
  Source: 3,
  Destination: 4,
  SourceIn: 5,
  DestinationIn: 6,
  SourceOut: 7,
  DestinationOut: 8,
  SourceAtop: 9,
  DestinationAtop: 10,
  Xor: 11,
  Plus: 12,
  Multiply: 13,
  Screen: 14,
  Overlay: 15,
  Darken: 16,
  Lighten: 17,
  ColorDodge: 18,
  ColorBurn: 19,
  HardLight: 20,
  SoftLight: 21,
  Difference: 22,
  Exclusion: 23,
} as const;

/** qt_div_255 (qdrawhelper_p.h:887): rounded x/255 for 0 <= x <= 65535·255. */
function div255(x: number): number {
  return (x + (x >> 8) + 0x80) >> 8;
}

/** INTERPOLATE_PIXEL_255 on one channel. */
function interp255(x: number, a1: number, y: number, a2: number): number {
  return div255(x * a1 + y * a2);
}

/** mix_alpha (qcompositionfunctions.cpp:1046). */
function mixAlpha(da: number, sa: number): number {
  return 255 - div255((255 - sa) * (255 - da));
}

/**
 * Composite `n` source pixels starting at byte offset `si` onto destination
 * pixels starting at `di`. Both arrays hold premultiplied RGBA.
 */
export type SpanCompose = (d: Uint8ClampedArray, di: number, s: Uint8ClampedArray, si: number, n: number, constAlpha: number) => void;

/** SourceOver of one pixel with an 8-bit constant alpha (qt_blend_argb32_on_argb32, blend_pixel). */
function sourceOverPixels(d: Uint8ClampedArray, di: number, s: Uint8ClampedArray, si: number, n: number, ca: number): void {
  if (ca === 255) {
    for (let i = 0; i < n; i += 1, di += 4, si += 4) {
      const sa = s[si + 3]!;
      if (sa === 255) {
        d[di] = s[si]!;
        d[di + 1] = s[si + 1]!;
        d[di + 2] = s[si + 2]!;
        d[di + 3] = 255;
      } else {
        // NEON processes every pixel as s + BYTE_MUL(d, 255 - sa); for
        // valid premultiplied input that equals Qt's C skip of sa == 0.
        const ia = 255 - sa;
        d[di] = s[si]! + byteMul(d[di]!, ia);
        d[di + 1] = s[si + 1]! + byteMul(d[di + 1]!, ia);
        d[di + 2] = s[si + 2]! + byteMul(d[di + 2]!, ia);
        d[di + 3] = sa + byteMul(d[di + 3]!, ia);
      }
    }
    return;
  }
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const r = byteMul(s[si]!, ca);
    const g = byteMul(s[si + 1]!, ca);
    const b = byteMul(s[si + 2]!, ca);
    const a = byteMul(s[si + 3]!, ca);
    const ia = 255 - a;
    d[di] = r + byteMul(d[di]!, ia);
    d[di + 1] = g + byteMul(d[di + 1]!, ia);
    d[di + 2] = b + byteMul(d[di + 2]!, ia);
    d[di + 3] = a + byteMul(d[di + 3]!, ia);
  }
}

/**
 * SourceOver for texture spans. On arm64 Qt installs
 * `qt_blend_argb32_on_argb32_scanline_neon` (qdrawhelper.cpp:6956), which
 * converts the span alpha to 0..256 and back:
 * `((ca * 256 / 255) * 255) >> 8` (qdrawhelper_neon.cpp:369-380, 437-438).
 * x86 SSE2 uses `ca` directly; macOS arm64 is the parity reference.
 */
const sourceOver: SpanCompose = (d, di, s, si, n, ca) => {
  sourceOverPixels(d, di, s, si, n, ca === 255 ? 255 : (Math.trunc((ca * 256) / 255) * 255) >> 8);
};

/**
 * The `qBlendFunctions` fast path (`drawImage` at an integer offset without
 * SmoothPixmapTransform, SourceOver): opacity 0..256 maps to
 * `(op * 255) >> 8` once (qblendfunctions.cpp / qdrawhelper_neon.cpp:437).
 */
export function blendSourceOverFast(d: Uint8ClampedArray, di: number, s: Uint8ClampedArray, si: number, n: number, intOpacity: number): void {
  if (intOpacity <= 0) return;
  sourceOverPixels(d, di, s, si, n, intOpacity >= 256 ? 255 : (intOpacity * 255) >> 8);
}

const destinationOver: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3]!;
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c]! : byteMul(s[si + c]!, ca);
      d[di + c] = byteMul(sc, ida) + d[di + c]!;
    }
  }
};

const clear: SpanCompose = (d, di, _s, _si, n, ca) => {
  if (ca === 255) {
    d.fill(0, di, di + n * 4);
    return;
  }
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) d[di + i] = byteMul(d[di + i]!, ia);
};

const source: SpanCompose = (d, di, s, si, n, ca) => {
  if (ca === 255) {
    d.set(s.subarray(si, si + n * 4), di);
    return;
  }
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) d[di + i] = interp255(s[si + i]!, ca, d[di + i]!, ia);
};

const destination: SpanCompose = () => {};

const sourceIn: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const da = d[di + 3]!;
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(s[si + c]!, da);
    } else {
      const cia = 255 - ca;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c]!, ca), da, d[di + c]!, cia);
    }
  }
};

const destinationIn: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    let sa = s[si + 3]!;
    if (ca !== 255) sa = div255(sa * ca) + (255 - ca);
    for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(d[di + c]!, sa);
  }
};

const sourceOut: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3]!;
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(s[si + c]!, ida);
    } else {
      const cia = 255 - ca;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c]!, ca), ida, d[di + c]!, cia);
    }
  }
};

const destinationOut: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    let sia = 255 - s[si + 3]!;
    if (ca !== 255) sia = div255(sia * ca) + (255 - ca);
    for (let c = 0; c < 4; c += 1) d[di + c] = byteMul(d[di + c]!, sia);
  }
};

const sourceAtop: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const da = d[di + 3]!;
    const sa = ca === 255 ? s[si + 3]! : byteMul(s[si + 3]!, ca);
    const sia = 255 - sa;
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c]! : byteMul(s[si + c]!, ca);
      d[di + c] = interp255(sc, da, d[di + c]!, sia);
    }
  }
};

const destinationAtop: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3]!;
    let sa = s[si + 3]!;
    if (ca === 255) {
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(s[si + c]!, ida, d[di + c]!, sa);
    } else {
      const cia = 255 - ca;
      sa = byteMul(sa, ca) + cia;
      for (let c = 0; c < 4; c += 1) d[di + c] = interp255(byteMul(s[si + c]!, ca), ida, d[di + c]!, sa);
    }
  }
};

const xor: SpanCompose = (d, di, s, si, n, ca) => {
  for (let i = 0; i < n; i += 1, di += 4, si += 4) {
    const ida = 255 - d[di + 3]!;
    const sa = ca === 255 ? s[si + 3]! : byteMul(s[si + 3]!, ca);
    const sia = 255 - sa;
    for (let c = 0; c < 4; c += 1) {
      const sc = ca === 255 ? s[si + c]! : byteMul(s[si + c]!, ca);
      d[di + c] = interp255(sc, ida, d[di + c]!, sia);
    }
  }
};

const plus: SpanCompose = (d, di, s, si, n, ca) => {
  const ia = 255 - ca;
  for (let i = 0; i < n * 4; i += 1) {
    const sum = Math.min(255, d[di + i]! + s[si + i]!);
    d[di + i] = ca === 255 ? sum : interp255(sum, ca, d[di + i]!, ia);
  }
};

/** A separable blend mode: per-channel operator on (dst, src, da, sa), alpha = mix_alpha. */
type ChannelOp = (dst: number, src: number, da: number, sa: number) => number;

function separable(op: ChannelOp): SpanCompose {
  return (d, di, s, si, n, ca) => {
    const ica = 255 - ca;
    for (let i = 0; i < n; i += 1, di += 4, si += 4) {
      const da = d[di + 3]!;
      const sa = s[si + 3]!;
      const r = op(d[di]!, s[si]!, da, sa);
      const g = op(d[di + 1]!, s[si + 1]!, da, sa);
      const b = op(d[di + 2]!, s[si + 2]!, da, sa);
      const a = mixAlpha(da, sa);
      if (ca === 255) {
        d[di] = r;
        d[di + 1] = g;
        d[di + 2] = b;
        d[di + 3] = a;
      } else {
        // QPartialCoverage::store: INTERPOLATE_PIXEL_255(result, ca, dest, 255 - ca).
        d[di] = interp255(r & 0xff, ca, d[di]!, ica);
        d[di + 1] = interp255(g & 0xff, ca, d[di + 1]!, ica);
        d[di + 2] = interp255(b & 0xff, ca, d[di + 2]!, ica);
        d[di + 3] = interp255(a, ca, d[di + 3]!, ica);
      }
    }
  };
}

const multiplyOp: ChannelOp = (dst, src, da, sa) => div255(src * dst + src * (255 - da) + dst * (255 - sa));

const screenOp: ChannelOp = (dst, src) => 255 - div255((255 - dst) * (255 - src));

const overlayOp: ChannelOp = (dst, src, da, sa) => {
  const temp = src * (255 - da) + dst * (255 - sa);
  if (2 * dst < da) return div255(2 * src * dst + temp);
  return div255(sa * da - 2 * (da - dst) * (sa - src) + temp);
};

const darkenOp: ChannelOp = (dst, src, da, sa) =>
  div255(Math.min(src * da, dst * sa) + src * (255 - da) + dst * (255 - sa));

const lightenOp: ChannelOp = (dst, src, da, sa) =>
  div255(Math.max(src * da, dst * sa) + src * (255 - da) + dst * (255 - sa));

const colorDodgeOp: ChannelOp = (dst, src, da, sa) => {
  const saDa = sa * da;
  const dstSa = dst * sa;
  const srcDa = src * da;
  const temp = src * (255 - da) + dst * (255 - sa);
  if (srcDa + dstSa > saDa) return div255(saDa + temp);
  if (src === sa || sa === 0) return div255(temp);
  return div255(Math.trunc((255 * dstSa) / (255 - Math.trunc((255 * src) / sa))) + temp);
};

const colorBurnOp: ChannelOp = (dst, src, da, sa) => {
  const srcDa = src * da;
  const dstSa = dst * sa;
  const saDa = sa * da;
  const temp = src * (255 - da) + dst * (255 - sa);
  if (srcDa + dstSa < saDa) return div255(temp);
  if (src === 0) return div255(dstSa + temp);
  return div255(Math.trunc((sa * (srcDa + dstSa - saDa)) / src) + temp);
};

const hardLightOp: ChannelOp = (dst, src, da, sa) => {
  const temp = src * (255 - da) + dst * (255 - sa);
  if (2 * src < sa) return div255(2 * src * dst + temp);
  return div255(sa * da - 2 * (da - dst) * (sa - src) + temp);
};

const softLightOp: ChannelOp = (dst, src, da, sa) => {
  const src2 = src << 1;
  const dstNp = da !== 0 ? Math.trunc((255 * dst) / da) : 0;
  const temp = (src * (255 - da) + dst * (255 - sa)) * 255;
  if (src2 < sa) return Math.trunc((dst * (sa * 255 + (src2 - sa) * (255 - dstNp)) + temp) / 65025);
  if (4 * dst <= da) {
    const poly = Math.trunc((((16 * dstNp - 12 * 255) * dstNp + 3 * 65025) * dstNp) / 65025);
    return Math.trunc((dst * sa * 255 + da * (src2 - sa) * poly + temp) / 65025);
  }
  return Math.trunc((dst * sa * 255 + da * (src2 - sa) * (Math.trunc(Math.sqrt(dstNp * 255)) - dstNp) + temp) / 65025);
};

const differenceOp: ChannelOp = (dst, src, da, sa) => src + dst - div255(2 * Math.min(src * da, dst * sa));

const exclusionOp: ChannelOp = (dst, src) => dst + src - ((dst * src) >> 7);

const COMPOSERS: readonly SpanCompose[] = [
  sourceOver,
  destinationOver,
  clear,
  source,
  destination,
  sourceIn,
  destinationIn,
  sourceOut,
  destinationOut,
  sourceAtop,
  destinationAtop,
  xor,
  plus,
  separable(multiplyOp),
  separable(screenOp),
  separable(overlayOp),
  separable(darkenOp),
  separable(lightenOp),
  separable(colorDodgeOp),
  separable(colorBurnOp),
  separable(hardLightOp),
  separable(softLightOp),
  separable(differenceOp),
  separable(exclusionOp),
];

/** The span compositor for a libopenshot `composite` code (unknown codes fall back to SourceOver). */
export function composerFor(mode: number): SpanCompose {
  return COMPOSERS[mode] ?? sourceOver;
}

/**
 * True when a transparent source pixel still changes the destination
 * (Clear, Source, SourceIn, DestinationIn, SourceOut, DestinationAtop). For
 * these modes Qt's full-canvas `apply_background` draw affects pixels outside
 * the clip too, so the compositor must visit the whole canvas.
 */
export function transparentSourceAffectsDestination(mode: number): boolean {
  return mode === 2 || mode === 3 || mode === 5 || mode === 6 || mode === 7 || mode === 10;
}

/**
 * True when the mode makes the clip vanish when drawn onto a transparent
 * canvas (libopenshot draws each clip into a transparent canvas-sized image
 * with its composite mode first, Clip.cpp:1411).
 */
export function vanishesOnTransparent(mode: number): boolean {
  return mode === 2 || mode === 4 || mode === 5 || mode === 6 || mode === 8 || mode === 9;
}
