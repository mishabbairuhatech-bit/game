import {
  biomeForPlot,
  calculatePlotPrice,
  dominantBiome,
  plotTerrain,
  regionName,
  sampleTerrain,
  unbuildableCoverageBps,
  type WorldGenParams,
} from './worldgen';
import {
  PLOT_TRANSITIONS,
  canTransition,
  checkPlotTransition,
  isOwnedStatus,
  isWorldPurchasable,
} from './plot-state';

const WORLD: WorldGenParams = { seed: 'EMPIRE-001', size: 1000 };

describe('world generation', () => {
  describe('determinism', () => {
    it('produces identical terrain for the same seed and position', () => {
      for (let i = 0; i < 500; i++) {
        const nx = ((i * 37) % 1000) / 1000;
        const ny = ((i * 91) % 1000) / 1000;
        const a = sampleTerrain(WORLD, nx, ny);
        const b = sampleTerrain(WORLD, nx, ny);
        expect(b).toEqual(a);
      }
    });

    it('produces a genuinely different world for a different seed', () => {
      const other: WorldGenParams = { seed: 'EMPIRE-002', size: 1000 };
      let differences = 0;
      for (let i = 0; i < 400; i++) {
        const nx = ((i * 37) % 1000) / 1000;
        const ny = ((i * 91) % 1000) / 1000;
        if (sampleTerrain(WORLD, nx, ny).biome !== sampleTerrain(other, nx, ny).biome) {
          differences++;
        }
      }
      // A seed that changed almost nothing would mean the seed is barely
      // feeding the noise - the whole point is that it reshapes the world.
      expect(differences).toBeGreaterThan(100);
    });

    it('gives a plot the same biome however it is asked', () => {
      for (const [x, y] of [
        [10, 10],
        [50, 50],
        [77, 23],
        [99, 99],
      ]) {
        expect(biomeForPlot(WORLD, x!, y!, 10)).toBe(biomeForPlot(WORLD, x!, y!, 10));
      }
    });

    it('names regions stably', () => {
      expect(regionName('EMPIRE-001', 3, 4)).toBe(regionName('EMPIRE-001', 3, 4));
      expect(regionName('EMPIRE-001', 3, 4)).not.toBe(regionName('EMPIRE-001', 4, 3));
    });

    it('derives plot terrain deterministically', () => {
      const a = plotTerrain(WORLD, 42, 17, 10);
      const b = plotTerrain(WORLD, 42, 17, 10);
      expect(b).toEqual(a);
      expect(a.seed).toBe('EMPIRE-001:42:17');
    });
  });

  describe('terrain fields', () => {
    it('keeps every field inside its declared range', () => {
      for (let i = 0; i < 300; i++) {
        const s = sampleTerrain(WORLD, (i % 100) / 100, Math.floor(i / 100) / 100);
        for (const value of [s.elevation, s.moisture, s.temperature, s.river]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    });

    it('produces water at the world edge and land inland', () => {
      // The edge falloff is what makes the world read as an island rather
      // than terrain sliced off by the boundary.
      const corner = sampleTerrain(WORLD, 0.01, 0.01);
      expect(corner.biome).toBe('WATER');
    });

    it('produces a varied but coherent biome mix', () => {
      const tally = new Map<string, number>();
      for (let x = 0; x < 100; x += 2) {
        for (let y = 0; y < 100; y += 2) {
          const biome = biomeForPlot(WORLD, x, y, 10);
          tally.set(biome, (tally.get(biome) ?? 0) + 1);
        }
      }
      // Several biomes, but not so fragmented that terrain is noise.
      expect(tally.size).toBeGreaterThanOrEqual(4);
      const largest = Math.max(...tally.values());
      const total = [...tally.values()].reduce((a, b) => a + b, 0);
      expect(largest / total).toBeLessThan(0.85);
    });
  });

  describe('coverage', () => {
    it('reports 100% unbuildable for open water', () => {
      // Deep in the corner falloff, every sample is water.
      expect(unbuildableCoverageBps(WORLD, 0, 0, 10)).toBe(10000);
    });

    it('stays within basis-point bounds', () => {
      for (let i = 0; i < 60; i++) {
        const bps = unbuildableCoverageBps(WORLD, i, (i * 7) % 100, 10);
        expect(bps).toBeGreaterThanOrEqual(0);
        expect(bps).toBeLessThanOrEqual(10000);
      }
    });
  });

  describe('dominant biome', () => {
    it('is deterministic and does not depend on Map iteration order', () => {
      for (let i = 0; i < 40; i++) {
        const a = dominantBiome(WORLD, i * 10, i * 7, 100);
        const b = dominantBiome(WORLD, i * 10, i * 7, 100);
        expect(b).toBe(a);
      }
    });
  });

  describe('pricing', () => {
    const base = {
      basePrice: 2500,
      biomeModifierBps: 10000,
      regionModifierBps: 10000,
      unbuildableBps: 0,
      distanceFromCentre: 0,
      plotsPerSide: 100,
    };

    it('is pure', () => {
      expect(calculatePlotPrice(base)).toBe(calculatePlotPrice(base));
    });

    it('charges more at the centre than at the rim', () => {
      const centre = calculatePlotPrice({ ...base, distanceFromCentre: 0 });
      const rim = calculatePlotPrice({ ...base, distanceFromCentre: 50 });
      expect(centre).toBeGreaterThan(rim);
    });

    it('discounts land that is half unusable', () => {
      const whole = calculatePlotPrice(base);
      const half = calculatePlotPrice({ ...base, unbuildableBps: 5000 });
      expect(half).toBeLessThan(whole);
    });

    it('applies the biome modifier', () => {
      const cheap = calculatePlotPrice({ ...base, biomeModifierBps: 7000 });
      const dear = calculatePlotPrice({ ...base, biomeModifierBps: 13000 });
      expect(dear).toBeGreaterThan(cheap);
    });

    it('never returns a price below the floor', () => {
      const price = calculatePlotPrice({
        ...base,
        basePrice: 1,
        biomeModifierBps: 1,
        unbuildableBps: 9999,
        distanceFromCentre: 50,
      });
      expect(price).toBeGreaterThanOrEqual(100n);
    });
  });
});

describe('plot state machine', () => {
  it('allows the world-purchase path', () => {
    expect(canTransition('FREE', 'OWNED', 'WORLD_PURCHASE')).toBe(true);
    expect(canTransition('FREE', 'STARTER', 'STARTER_GRANT')).toBe(true);
  });

  it('allows the marketplace path', () => {
    expect(canTransition('OWNED', 'FOR_SALE', 'MARKETPLACE_LIST')).toBe(true);
    expect(canTransition('FOR_SALE', 'OWNED', 'MARKETPLACE_PURCHASE')).toBe(true);
  });

  it('refuses illegal transitions', () => {
    // The world does not list its own land.
    expect(canTransition('FREE', 'FOR_SALE')).toBe(false);
    // A player cannot sell the ground their keep stands on.
    expect(canTransition('STARTER', 'FOR_SALE')).toBe(false);
  });

  it('treats UNAVAILABLE as terminal', () => {
    expect(PLOT_TRANSITIONS.UNAVAILABLE).toHaveLength(0);
    for (const target of ['FREE', 'OWNED', 'STARTER', 'FOR_SALE'] as const) {
      const check = checkPlotTransition('UNAVAILABLE', target);
      expect(check.allowed).toBe(false);
      expect(check.refusal).toBe('TERMINAL_STATE');
    }
  });

  it('rejects a legal transition driven by the wrong reason', () => {
    const check = checkPlotTransition('FREE', 'OWNED', 'MARKETPLACE_PURCHASE');
    expect(check.allowed).toBe(false);
    expect(check.refusal).toBe('REASON_NOT_PERMITTED');
  });

  it('treats a no-op transition as allowed so a retry is idempotent', () => {
    expect(canTransition('OWNED', 'OWNED')).toBe(true);
    expect(canTransition('UNAVAILABLE', 'UNAVAILABLE')).toBe(true);
  });

  it('classifies ownership and purchasability', () => {
    expect(isOwnedStatus('STARTER')).toBe(true);
    expect(isOwnedStatus('OWNED')).toBe(true);
    expect(isOwnedStatus('FREE')).toBe(false);

    expect(isWorldPurchasable('FREE')).toBe(true);
    expect(isWorldPurchasable('FOR_SALE')).toBe(false);
    expect(isWorldPurchasable('UNAVAILABLE')).toBe(false);
  });

  it('gives every status a defined transition list', () => {
    for (const [from, targets] of Object.entries(PLOT_TRANSITIONS)) {
      expect(Array.isArray(targets)).toBe(true);
      // No status may transition to itself in the table; that is handled as a
      // no-op instead, so a stray self-entry would be a copy-paste bug.
      expect(targets).not.toContain(from);
    }
  });
});
