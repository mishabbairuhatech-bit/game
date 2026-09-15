import {
  DEFAULT_WORLD_GEOMETRY,
  InvalidWorldGeometryError,
  MAX_VIEWPORT_PLOTS,
  clampBounds,
  locatePlot,
  parsePlotCode,
  plotCode,
  plotDistance,
  plotInWorld,
  plotNeighbours,
  tileToPlot,
  validateGeometry,
  worldCounts,
  zoneToRegion,
  type WorldGeometry,
} from './world';
import {
  TERRAIN_RULES,
  isBuildable,
  isClaimable,
  isTraversable,
  usableTiles,
  STARTER_BIOMES,
} from './terrain';
import { ALL_BIOMES } from '@empire/shared';

const G = DEFAULT_WORLD_GEOMETRY;

describe('world geometry', () => {
  it('produces the documented development world', () => {
    const counts = worldCounts(G);
    expect(counts.regionsPerSide).toBe(10);
    expect(counts.zonesPerSide).toBe(50);
    expect(counts.plotsPerSide).toBe(100);
    expect(counts.totalRegions).toBe(100);
    expect(counts.totalZones).toBe(2500);
    expect(counts.totalPlots).toBe(10000);
  });

  it('accepts a larger world with the same partitioning', () => {
    const big: WorldGeometry = { ...G, width: 4000, height: 4000 };
    const counts = worldCounts(big);
    expect(counts.totalRegions).toBe(1600);
    expect(counts.totalPlots).toBe(160000);
    expect(() => validateGeometry(big)).not.toThrow();
  });

  describe('validation', () => {
    it('accepts the default', () => {
      expect(() => validateGeometry(G)).not.toThrow();
    });

    it.each([
      ['a region that is not a multiple of a zone', { ...G, zoneSize: 30 }],
      ['a zone that is not a multiple of a plot', { ...G, plotSize: 7 }],
      ['a width that is not a multiple of a region', { ...G, width: 1050, height: 1050 }],
      ['a non-square world', { ...G, height: 500 }],
      ['a zero-size world', { ...G, width: 0, height: 0 }],
    ])('rejects %s', (_label, geometry) => {
      // Partial regions at the edges would produce off-by-one coordinate maths
      // everywhere downstream, so this has to fail at generation time.
      expect(() => validateGeometry(geometry as WorldGeometry)).toThrow(
        InvalidWorldGeometryError,
      );
    });
  });

  describe('coordinates', () => {
    it('locates a plot within its zone and region', () => {
      const at = locatePlot(G, 67, 15);
      expect(at.tileX).toBe(670);
      expect(at.tileY).toBe(150);
      expect(at.zoneX).toBe(33);
      expect(at.zoneY).toBe(7);
      expect(at.regionX).toBe(6);
      expect(at.regionY).toBe(1);
    });

    it('agrees with the zone-to-region mapping', () => {
      for (let x = 0; x < 50; x += 3) {
        for (let y = 0; y < 50; y += 7) {
          const viaPlot = locatePlot(G, x * 2, y * 2);
          const viaZone = zoneToRegion(G, x, y);
          expect(viaZone).toEqual({ regionX: viaPlot.regionX, regionY: viaPlot.regionY });
        }
      }
    });

    it('round-trips tile to plot', () => {
      expect(tileToPlot(G, 670, 150)).toEqual({ plotX: 67, plotY: 15 });
      expect(tileToPlot(G, 679, 159)).toEqual({ plotX: 67, plotY: 15 });
    });

    it('builds and parses a plot code', () => {
      const code = plotCode(G, 92, 113 % 100);
      expect(code).toMatch(/^R\d+-\d+:Z\d+-\d+:P\d+-\d+$/);
      expect(parsePlotCode(plotCode(G, 67, 15))).toEqual({ plotX: 67, plotY: 15 });
    });

    it('returns null for a malformed code', () => {
      expect(parsePlotCode('not-a-code')).toBeNull();
      expect(parsePlotCode('')).toBeNull();
    });

    it('bounds-checks plots', () => {
      expect(plotInWorld(G, 0, 0)).toBe(true);
      expect(plotInWorld(G, 99, 99)).toBe(true);
      expect(plotInWorld(G, 100, 0)).toBe(false);
      expect(plotInWorld(G, -1, 0)).toBe(false);
      expect(plotInWorld(G, 1.5, 0)).toBe(false);
    });

    it('clips neighbours at the world edge', () => {
      expect(plotNeighbours(G, 50, 50)).toHaveLength(4);
      expect(plotNeighbours(G, 0, 0)).toHaveLength(2);
      expect(plotNeighbours(G, 99, 99)).toHaveLength(2);
    });

    it('measures Chebyshev distance', () => {
      expect(plotDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(4);
      expect(plotDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    });
  });

  describe('viewport clamping', () => {
    it('leaves a small window alone', () => {
      const { bounds, truncated } = clampBounds(
        G,
        { minX: 10, minY: 10, maxX: 20, maxY: 20 },
        MAX_VIEWPORT_PLOTS,
      );
      expect(bounds).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
      expect(truncated).toBe(false);
    });

    it('caps a request for the whole world', () => {
      // Without this, one crafted request could ask the database for every
      // plot in the world.
      const { bounds, truncated } = clampBounds(
        G,
        { minX: 0, minY: 0, maxX: 99, maxY: 99 },
        MAX_VIEWPORT_PLOTS,
      );
      const area = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
      expect(area).toBeLessThanOrEqual(MAX_VIEWPORT_PLOTS);
      expect(truncated).toBe(true);
    });

    it('clamps out-of-world coordinates back inside', () => {
      const { bounds } = clampBounds(
        G,
        { minX: -500, minY: -500, maxX: 5000, maxY: 5000 },
        MAX_VIEWPORT_PLOTS,
      );
      expect(bounds.minX).toBeGreaterThanOrEqual(0);
      expect(bounds.minY).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX).toBeLessThanOrEqual(99);
      expect(bounds.maxY).toBeLessThanOrEqual(99);
    });

    it('never inverts the rectangle', () => {
      const { bounds } = clampBounds(
        G,
        { minX: 80, minY: 80, maxX: 10, maxY: 10 },
        MAX_VIEWPORT_PLOTS,
      );
      expect(bounds.maxX).toBeGreaterThanOrEqual(bounds.minX);
      expect(bounds.maxY).toBeGreaterThanOrEqual(bounds.minY);
    });
  });
});

describe('terrain rules', () => {
  it('defines a rule for every biome', () => {
    for (const biome of ALL_BIOMES) {
      expect(TERRAIN_RULES[biome]).toBeDefined();
      expect(TERRAIN_RULES[biome].label.length).toBeGreaterThan(0);
      expect(TERRAIN_RULES[biome].color).toMatch(/^#[0-9a-f]{6}$/i);
      // Every biome carries a non-colour encoding, so the map is readable
      // without relying on hue.
      expect(TERRAIN_RULES[biome].glyph.length).toBeGreaterThan(0);
    }
  });

  it('blocks building on water and mountain', () => {
    expect(isBuildable('WATER')).toBe(false);
    expect(isBuildable('MOUNTAIN')).toBe(false);
    expect(isTraversable('WATER')).toBe(false);
    expect(isClaimable('WATER')).toBe(false);
    expect(isClaimable('MOUNTAIN')).toBe(false);
  });

  it('allows building on open ground', () => {
    expect(isBuildable('GRASSLAND')).toBe(true);
    expect(isBuildable('DESERT')).toBe(true);
    expect(isClaimable('GRASSLAND')).toBe(true);
  });

  it('treats forest and swamp as conditional', () => {
    expect(TERRAIN_RULES.FOREST.buildability).toBe('CONDITIONAL');
    expect(TERRAIN_RULES.SWAMP.buildability).toBe('CONDITIONAL');
    expect(TERRAIN_RULES.FOREST.unusableBps).toBeGreaterThan(0);
  });

  it('computes usable tiles from the unusable fraction', () => {
    expect(usableTiles('GRASSLAND', 10)).toBe(100);
    expect(usableTiles('FOREST', 10)).toBe(75); // 25% lost
    expect(usableTiles('WATER', 10)).toBe(0);
  });

  it('only offers starter biomes that are genuinely buildable', () => {
    for (const biome of STARTER_BIOMES) {
      expect(isBuildable(biome)).toBe(true);
      expect(isClaimable(biome)).toBe(true);
      // A starter plot should not cost the new player most of its area.
      expect(TERRAIN_RULES[biome].unusableBps).toBeLessThanOrEqual(2000);
    }
  });

  it('keeps every price modifier positive', () => {
    for (const biome of ALL_BIOMES) {
      expect(TERRAIN_RULES[biome].priceModifierBps).toBeGreaterThan(0);
    }
  });
});
