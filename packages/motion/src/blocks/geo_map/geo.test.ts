import { describe, expect, it } from "vitest";
import { Atlas, angleBetween, decodeRing, encodeRing, fitView, mixView, normalizeName, projector, ringPoints, slerp, worldView } from "./geo.js";
import { COUNTRIES, PLACES } from "./world.gen.js";

const atlas = new Atlas(COUNTRIES, PLACES);

describe("rings", () => {
  it("round-trip through the polyline encoding at 1/100 degree", () => {
    const ring = [[-9.14, 38.72], [179.99, -16.5], [-180, 89.99], [0, 0]] as const;
    expect(decodeRing(encodeRing(ring))).toEqual(ring);
  });
});

describe("Atlas.resolve", () => {
  it("finds countries by name, alias and code", () => {
    for (const q of ["Portugal", "portugal", "PRT", "PT", "Portuguese Republic"]) {
      const r = atlas.resolve(q);
      expect(r?.kind === "area" && atlas.countries[r.countries[0]!]!.a3, q).toBe("PRT");
    }
    for (const q of ["USA", "U.S.A.", "United States of America", "US"]) {
      const r = atlas.resolve(q);
      expect(r?.kind === "area" && atlas.countries[r.countries[0]!]!.a3, q).toBe("USA");
    }
    const uk = atlas.resolve("United Kingdom");
    expect(uk?.kind === "area" && atlas.countries[uk.countries[0]!]!.a3).toBe("GBR");
  });

  it("finds continents and subregions as sets of countries", () => {
    const africa = atlas.resolve("Africa");
    expect(africa?.kind).toBe("area");
    expect(africa?.kind === "area" && africa.countries.length).toBeGreaterThan(50);
    const we = atlas.resolve("Western Europe");
    expect(we?.kind === "area" && we.countries.map((i) => atlas.countries[i]!.a3)).toContain("FRA");
    expect(atlas.resolve("world")).toMatchObject({ kind: "area", world: true });
  });

  it("finds cities, a city in a country, and coordinates", () => {
    const lisbon = atlas.resolve("Lisbon");
    expect(lisbon?.kind).toBe("point");
    expect(lisbon?.kind === "point" && angleBetween(lisbon.at, [-9.14, 38.72])).toBeLessThan(0.5);
    expect(atlas.resolve("São Paulo")).toMatchObject({ kind: "point" });
    expect(atlas.resolve("Sao Paulo")).toMatchObject({ kind: "point" });
    const london = atlas.resolve("London, United Kingdom");
    expect(london?.kind === "point" && london.at[1]).toBeGreaterThan(51);
    expect(atlas.resolve("38.7, -9.1")).toEqual({ kind: "point", name: "38.7, -9.1", at: [-9.1, 38.7] });
    expect(atlas.resolve("91, 0")).toBeUndefined();
  });

  it("refuses unknown names and suggests close ones", () => {
    expect(atlas.resolve("Lisbn")).toBeUndefined();
    expect(atlas.suggest("Lisbn")).toContain("Lisbon");
    expect(atlas.suggest("Portgal")).toContain("Portugal");
  });

  it("keeps far territories out of a country's outline", () => {
    const usa = atlas.resolve("USA")!;
    const lons = atlas.outline(usa).map(([lon]) => lon);
    expect(Math.min(...lons)).toBeGreaterThan(-130);
    const europe = atlas.outline(atlas.resolve("Europe")!);
    expect(Math.max(...europe.map(([lon]) => lon))).toBeLessThan(60);
  });

  it("normalizes names", () => {
    expect(normalizeName("  The Côte d'Ivoire ")).toBe("cote divoire");
  });
});

describe("projections", () => {
  it("centres the view and hides the far side of the globe", () => {
    const view = { lon: -9, lat: 38, zoom: 500 };
    const p = projector("globe", view);
    expect(p(-9, 38)).toEqual({ x: 0, y: -0, visible: true });
    const far = p(171, -38);
    expect(far.visible).toBe(false);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(500, 5);
    // North is up.
    expect(p(-9, 48).y).toBeLessThan(0);
  });

  it("keeps a flat ring that crosses the far meridian in one piece", () => {
    const view = { lon: 10, lat: 0, zoom: 100 };
    const ring = [[-171, 60], [-169, 60], [-169, 62], [-171, 62]] as const;
    const pts = ringPoints("flat", view, projector("flat", view), ring)!;
    const xs = pts.map((q) => q.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(10);
  });

  it("fits a country to the frame and a city to a minimum span", () => {
    for (const kind of ["globe", "flat"] as const) {
      const pts = atlas.outline(atlas.resolve("France")!);
      const view = fitView(kind, pts, 1080, 1920, 0.8);
      const p = projector(kind, view);
      const proj = pts.map(([lon, lat]) => p(lon, lat));
      const w = Math.max(...proj.map((q) => q.x)) - Math.min(...proj.map((q) => q.x));
      const h = Math.max(...proj.map((q) => q.y)) - Math.min(...proj.map((q) => q.y));
      expect(Math.max(w / 1080, h / 1920), kind).toBeCloseTo(0.8, 1);
      const city = fitView(kind, [[-9.14, 38.72]], 1080, 1920);
      expect(Number.isFinite(city.zoom) && city.zoom > view.zoom).toBe(true);
    }
    expect(fitView("globe", atlas.outline(atlas.resolve("world")!), 1080, 1080, 0.8).zoom).toBeCloseTo(432);
  });

  it("mixes views along the great circle with a geometric zoom", () => {
    const a = worldView("globe", 1080, 1920);
    const b = { lon: -9, lat: 38, zoom: a.zoom * 16 };
    const mid = mixView(a, b, 0.5);
    expect(mid.zoom).toBeCloseTo(a.zoom * 4);
    const [lon, lat] = slerp([a.lon, a.lat], [b.lon, b.lat], 0.5);
    expect(mid.lon).toBeCloseTo(lon);
    expect(mid.lat).toBeCloseTo(lat);
  });
});
