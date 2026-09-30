import { describe, expect, it } from "vitest";
import { QTransform, TxNone, TxRotate, TxScale, TxShear, TxTranslate, scaleIsUniform } from "./transform.js";

describe("QTransform", () => {
  it("maps like Clip::get_transform: scale, -origin, shear, rotate, +origin, +translate", () => {
    const [x, y, ox, oy, r, shx, shy, sw, sh] = [10, 20, 5, 3, 30, 0.2, 0.1, 2, 0.5];
    const t = new QTransform().translate(x, y).translate(ox, oy).rotate(r).shear(shx, shy).translate(-ox, -oy).scale(sw, sh);
    const [u, v] = [7, 4];
    const p1 = [u * sw - ox, v * sh - oy];
    const p2 = [p1[0]! + shx * p1[1]!, shy * p1[0]! + p1[1]!];
    const a = (r * Math.PI) / 180;
    const p3 = [Math.cos(a) * p2[0]! - Math.sin(a) * p2[1]!, Math.sin(a) * p2[0]! + Math.cos(a) * p2[1]!];
    const [mx, my] = t.map(u, v);
    expect(mx).toBeCloseTo(p3[0]! + ox + x, 12);
    expect(my).toBeCloseTo(p3[1]! + oy + y, 12);
  });

  it("classifies types with Qt's fuzzy-null tests", () => {
    expect(new QTransform().type()).toBe(TxNone);
    expect(new QTransform().translate(3, 0).type()).toBe(TxTranslate);
    expect(new QTransform().scale(2, 2).type()).toBe(TxScale);
    expect(new QTransform().rotate(30).type()).toBe(TxRotate);
    expect(new QTransform().shear(0.3, 0).type()).toBe(TxShear);
    // sin(2π) ≈ -2.4e-16 is fuzzy-null: a full turn is the identity for Qt,
    // so libopenshot does not even enable smooth sampling (Clip.cpp:1404).
    expect(new QTransform().rotate(360).isIdentity()).toBe(true);
    expect(new QTransform().rotate(360).scale(0.5, 0.5).type()).toBe(TxScale);
  });

  it("uses the exact sin/cos Qt uses for quarter turns", () => {
    const t = new QTransform().rotate(90);
    expect([t.m11, t.m12, t.m21, t.m22]).toEqual([0, 1, -1, 0]);
    const h = new QTransform().rotate(180);
    expect([h.m11, h.m12, h.m21, h.m22]).toEqual([-1, 0, -0, -1]);
  });

  it("inverts affine transforms", () => {
    const t = new QTransform().translate(4, -2).rotate(17).scale(1.5, 0.75);
    const inv = t.inverted()!;
    const [x, y] = t.map(3, 9);
    const [bx, by] = inv.map(x, y);
    expect(bx).toBeCloseTo(3, 10);
    expect(by).toBeCloseTo(9, 10);
    expect(new QTransform().scale(0, 1).inverted()).toBeNull();
  });

  it("detects shear-free uniform scaling like qt_scaleForTransform", () => {
    expect(scaleIsUniform(new QTransform().rotate(20).scale(2, 2))).toBe(true);
    expect(scaleIsUniform(new QTransform().rotate(20).scale(2, 1))).toBe(false);
    expect(scaleIsUniform(new QTransform().shear(0.1, 0))).toBe(false);
    expect(scaleIsUniform(new QTransform().scale(1.25, 1.25))).toBe(true);
  });

  it("round-trips through the Canvas2D affine order", () => {
    const t = new QTransform().translate(1, 2).rotate(45).scale(3, 4);
    const back = QTransform.fromAffine(t.toAffine());
    expect(back.map(5, 6)).toEqual(t.map(5, 6));
    expect(back.type()).toBe(t.type());
  });
});
