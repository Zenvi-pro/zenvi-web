/**
 * Qt 5.15's antialiased scan converter (src/gui/painting/qgrayraster.c),
 * which QRasterPaintEngine uses for antialiased path fills and clips.
 */

import type { CoverageMask } from "./rasterizer.js";

/**
 * Antialiased coverage of closed polygons exactly as Qt 5.15's gray raster
 * computes it, for outlines of line segments (QOutlineMapper flattens curves
 * first): qgrayraster.c `gray_move_to` :1152-1171, `gray_render_line`
 * :643-807, `gray_render_scanline` :545-640, `gray_set_cell`/`gray_start_cell`
 * :472-541, `gray_sweep` :1357-1428 and `gray_hline` :1219-1330, with the
 * device rectangle as clip box (qpaintengine_raster.cpp rasterize). Device
 * coordinates become 26.6 fixed point with `qRound(v * 64)` like
 * `QOutlineMapper::convertElements` (measured: an edge at y = 135.7448 covers
 * its row like 135.75). Banding (gray_convert_glyph) does not change cells,
 * so the whole box is one band. `oddEven` is QT_FT_OUTLINE_EVEN_ODD_FILL.
 */
export function grayRasterize(contours: readonly (readonly number[])[], oddEven: boolean, width: number, height: number): CoverageMask | null {
  const outline = contours.filter((c) => c.length >= 4).map((c) => c.map((v) => Math.floor(v * 64 + 0.5)));
  if (outline.length === 0) return null;
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const c of outline) {
    for (let i = 0; i + 1 < c.length; i += 2) {
      bx0 = Math.min(bx0, c[i]!);
      bx1 = Math.max(bx1, c[i]!);
      by0 = Math.min(by0, c[i + 1]!);
      by1 = Math.max(by1, c[i + 1]!);
    }
  }
  // gray_compute_cbox, then the clip box (gray_convert_glyph).
  let minEx = Math.floor(bx0 / 64);
  let minEy = Math.floor(by0 / 64);
  let maxEx = Math.floor((bx1 + 63) / 64);
  let maxEy = Math.floor((by1 + 63) / 64);
  if (maxEx <= 0 || minEx >= width || maxEy <= 0 || minEy >= height) return null;
  minEx = Math.max(minEx, 0);
  minEy = Math.max(minEy, 0);
  maxEx = Math.min(maxEx, width);
  maxEy = Math.min(maxEy, height);
  const countEx = maxEx - minEx;
  const countEy = maxEy - minEy;
  if (countEx <= 0 || countEy <= 0) return null;

  const rows: Map<number, [number, number]>[] = Array.from({ length: countEy }, () => new Map());
  let ex = 0;
  let ey = 0;
  let area = 0;
  let cover = 0;
  let invalid = true;
  let px = 0;
  let py = 0;
  const divMod = (a: number, b: number): [number, number] => {
    let q = Math.trunc(a / b);
    let r = a % b;
    if (r < 0) {
      q -= 1;
      r += b;
    }
    return [q, r];
  };
  const recordCell = (): void => {
    if (area === 0 && cover === 0) return;
    const row = rows[ey]!;
    const x = ex > countEx ? countEx : ex;
    const cell = row.get(x);
    if (cell) {
      cell[0] += cover;
      cell[1] += area;
    } else row.set(x, [cover, area]);
  };
  const setCell = (cx: number, cy: number): void => {
    const y = cy - minEy;
    let x = cx > maxEx ? maxEx : cx;
    x -= minEx;
    if (x < 0) x = -1;
    if (x !== ex || y !== ey) {
      if (!invalid) recordCell();
      area = 0;
      cover = 0;
      ex = x;
      ey = y;
    }
    invalid = y < 0 || y >= countEy || x >= countEx;
  };
  const startCell = (cx: number, cy: number): void => {
    let x = cx;
    if (x > maxEx) x = maxEx;
    if (x < minEx) x = minEx - 1;
    area = 0;
    cover = 0;
    ex = x - minEx;
    ey = cy - minEy;
    invalid = false;
    setCell(x, cy);
  };
  const renderScanline = (row: number, x1: number, y1: number, x2: number, y2: number): void => {
    let dx = x2 - x1;
    let ex1 = x1 >> 8;
    const ex2 = x2 >> 8;
    const fx1 = x1 - ex1 * 256;
    const fx2 = x2 - ex2 * 256;
    if (y1 === y2) {
      setCell(ex2, row);
      return;
    }
    if (ex1 === ex2) {
      const delta = y2 - y1;
      area += (fx1 + fx2) * delta;
      cover += delta;
      return;
    }
    let p = (256 - fx1) * (y2 - y1);
    let first = 256;
    let incr = 1;
    if (dx < 0) {
      p = fx1 * (y2 - y1);
      first = 0;
      incr = -1;
      dx = -dx;
    }
    let [delta, mod] = divMod(p, dx);
    area += (fx1 + first) * delta;
    cover += delta;
    ex1 += incr;
    setCell(ex1, row);
    let y = y1 + delta;
    if (ex1 !== ex2) {
      const [lift, rem] = divMod(256 * (y2 - y + delta), dx);
      mod -= dx;
      while (ex1 !== ex2) {
        delta = lift;
        mod += rem;
        if (mod >= 0) {
          mod -= dx;
          delta += 1;
        }
        area += 256 * delta;
        cover += delta;
        y += delta;
        ex1 += incr;
        setCell(ex1, row);
      }
    }
    delta = y2 - y;
    area += (fx2 + 256 - first) * delta;
    cover += delta;
  };
  const renderLine = (toX: number, toY: number): void => {
    let ey1 = py >> 8;
    const ey2 = toY >> 8;
    const fy1 = py - ey1 * 256;
    const fy2 = toY - ey2 * 256;
    const dx = toX - px;
    let dy = toY - py;
    if ((ey1 >= maxEy && ey2 >= maxEy) || (ey1 < minEy && ey2 < minEy)) {
      // vertical clipping: nothing on these rows
    } else if (ey1 === ey2) {
      renderScanline(ey1, px, fy1, toX, fy2);
    } else if (dx === 0) {
      const cx = px >> 8;
      const twoFx = (px - cx * 256) * 2;
      const first = dy < 0 ? 0 : 256;
      let delta = first - fy1;
      area += twoFx * delta;
      cover += delta;
      delta = first + first - 256;
      const step = twoFx * delta;
      const maxEy1 = countEy + minEy;
      if (dy < 0) {
        if (ey1 > maxEy1) ey1 = maxEy1 > ey2 ? maxEy1 : ey2;
        else ey1 -= 1;
        setCell(cx, ey1);
        while (ey1 > ey2 && ey1 >= minEy) {
          area += step;
          cover += delta;
          ey1 -= 1;
          setCell(cx, ey1);
        }
      } else {
        if (ey1 < minEy) ey1 = minEy < ey2 ? minEy : ey2;
        else ey1 += 1;
        setCell(cx, ey1);
        while (ey1 < ey2 && ey1 < maxEy1) {
          area += step;
          cover += delta;
          ey1 += 1;
          setCell(cx, ey1);
        }
      }
      if (ey1 !== ey2) {
        ey1 = ey2;
        setCell(cx, ey1);
      }
      delta = fy2 - 256 + first;
      area += twoFx * delta;
      cover += delta;
    } else {
      let p = (256 - fy1) * dx;
      let first = 256;
      let incr = 1;
      if (dy < 0) {
        p = fy1 * dx;
        first = 0;
        incr = -1;
        dy = -dy;
      }
      let [delta, mod] = divMod(p, dy);
      let x = px + delta;
      renderScanline(ey1, px, fy1, x, first);
      ey1 += incr;
      setCell(x >> 8, ey1);
      if (ey1 !== ey2) {
        const [lift, rem] = divMod(256 * dx, dy);
        mod -= dy;
        while (ey1 !== ey2) {
          delta = lift;
          mod += rem;
          if (mod >= 0) {
            mod -= dy;
            delta += 1;
          }
          const x2 = x + delta;
          renderScanline(ey1, x, 256 - first, x2, first);
          x = x2;
          ey1 += incr;
          setCell(x >> 8, ey1);
        }
      }
      renderScanline(ey1, x, 256 - first, toX, fy2);
    }
    px = toX;
    py = toY;
  };

  // QT_FT_Outline_Decompose: move to the first point, line to the others, close.
  for (const c of outline) {
    if (!invalid) recordCell();
    const sx = c[0]! * 4;
    const sy = c[1]! * 4;
    startCell(sx >> 8, sy >> 8);
    px = sx;
    py = sy;
    for (let i = 2; i + 1 < c.length; i += 2) renderLine(c[i]! * 4, c[i + 1]! * 4);
    renderLine(sx, sy);
  }
  if (!invalid) recordCell();

  const data = new Uint8Array(countEx * countEy);
  const hline = (x: number, y: number, a: number, count: number): void => {
    let coverage = Math.floor(a / 512);
    if (coverage < 0) coverage = -coverage;
    if (oddEven) {
      coverage &= 511;
      if (coverage > 256) coverage = 512 - coverage;
      else if (coverage === 256) coverage = 255;
    } else if (coverage >= 256) coverage = 255;
    if (coverage) data.fill(coverage, y * countEx + x, y * countEx + x + count);
  };
  for (let yi = 0; yi < countEy; yi += 1) {
    const cells = [...rows[yi]!.entries()].sort((a, b) => a[0] - b[0]);
    let acc = 0;
    let x = 0;
    for (const [cx, [cellCover, cellArea]] of cells) {
      if (cx > x && acc !== 0) hline(x, yi, acc * 512, cx - x);
      acc += cellCover;
      const a = acc * 512 - cellArea;
      if (a !== 0 && cx >= 0) hline(cx, yi, a, 1);
      x = cx + 1;
    }
    if (countEx > x && acc !== 0) hline(x, yi, acc * 512, countEx - x);
  }
  return { x: minEx, y: minEy, width: countEx, height: countEy, data };
}
