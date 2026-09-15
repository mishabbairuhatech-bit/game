import { Rng, fbm2D, hashSeed } from './rng';
import { distanceToRect, rectsOverlap, rectContains, rotateFootprint } from './grid';
import { accrue, secondsUntilFull } from './production';
import { calculateEmpirePower, levelFromXp, xpForNextLevel } from './power';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('plot:R0-0:Z0-0:P3-7');
    const b = new Rng('plot:R0-0:Z0-0:P3-7');
    const seriesA = Array.from({ length: 20 }, () => a.next());
    const seriesB = Array.from({ length: 20 }, () => b.next());
    expect(seriesA).toEqual(seriesB);
  });

  it('produces different series for different seeds', () => {
    expect(new Rng('a').next()).not.toEqual(new Rng('b').next());
  });

  it('stays in range', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 500; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(rng.int(3, 9)).toBeGreaterThanOrEqual(3);
      expect(rng.int(3, 9)).toBeLessThanOrEqual(9);
    }
  });

  it('shuffles deterministically', () => {
    const a = new Rng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng('shuffle').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('hashes a seed string to a stable 32-bit value', () => {
    expect(hashSeed('empire')).toBe(hashSeed('empire'));
    expect(hashSeed('empire')).toBeLessThanOrEqual(0xffffffff);
  });

  it('generates terrain noise inside [0, 1] and reproducibly', () => {
    for (let x = 0; x < 8; x += 0.5) {
      const value = fbm2D(1234, x, x * 1.7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(fbm2D(1234, x, x * 1.7)).toBe(value);
    }
  });
});

describe('grid geometry', () => {
  const hq = { x: 6, y: 6, width: 4, height: 4 };

  it('detects overlapping footprints', () => {
    // The HQ spans tiles 6..9 inclusive (x=6, width=4).
    expect(rectsOverlap(hq, { x: 8, y: 8, width: 3, height: 3 })).toBe(true);
    expect(rectsOverlap(hq, { x: 9, y: 9, width: 3, height: 3 })).toBe(true);
    expect(rectsOverlap(hq, { x: 11, y: 11, width: 3, height: 3 })).toBe(false);
  });

  it('treats edge-adjacent footprints as not overlapping', () => {
    // A building whose left edge is exactly the HQ's right edge is legal.
    expect(rectsOverlap(hq, { x: 10, y: 6, width: 2, height: 2 })).toBe(false);
  });

  it('checks containment within the plot bounds', () => {
    const plot = { x: 0, y: 0, width: 16, height: 16 };
    expect(rectContains(plot, hq)).toBe(true);
    expect(rectContains(plot, { x: 14, y: 14, width: 4, height: 4 })).toBe(false);
    expect(rectContains(plot, { x: -1, y: 0, width: 2, height: 2 })).toBe(false);
  });

  it('measures distance to a rectangle, not its centre', () => {
    // A tower 2 tiles to the right of the HQ's edge is 2 away, not 4.
    expect(distanceToRect({ x: 12, y: 8 }, hq)).toBeCloseTo(2);
    // Inside the footprint is zero distance.
    expect(distanceToRect({ x: 7, y: 7 }, hq)).toBe(0);
  });

  it('swaps width and height on a quarter turn only', () => {
    expect(rotateFootprint(4, 2, 0)).toEqual({ width: 4, height: 2 });
    expect(rotateFootprint(4, 2, 90)).toEqual({ width: 2, height: 4 });
    expect(rotateFootprint(4, 2, 180)).toEqual({ width: 4, height: 2 });
    expect(rotateFootprint(4, 2, 270)).toEqual({ width: 2, height: 4 });
  });
});

describe('production accrual', () => {
  const oneHour = 3_600_000;

  it('accrues elapsed production', () => {
    const result = accrue({
      producers: [{ ratePerHour: 180, multiplier: 1 }],
      current: 0,
      capacity: 4000,
      elapsedMs: oneHour,
      maxOfflineHours: 12,
    });
    expect(result.gained).toBe(180);
    expect(result.stored).toBe(180);
    expect(result.wasted).toBe(0);
  });

  it('applies multipliers from biome and boosts', () => {
    const result = accrue({
      producers: [{ ratePerHour: 100, multiplier: 1.3 }],
      current: 0,
      capacity: 1000,
      elapsedMs: oneHour,
      maxOfflineHours: 12,
    });
    expect(result.gained).toBe(130);
  });

  it('never exceeds storage, and reports the overflow', () => {
    const result = accrue({
      producers: [{ ratePerHour: 1000, multiplier: 1 }],
      current: 900,
      capacity: 1000,
      elapsedMs: oneHour,
      maxOfflineHours: 12,
    });
    expect(result.stored).toBe(1000);
    expect(result.gained).toBe(100);
    expect(result.wasted).toBe(900);
    expect(result.cappedOut).toBe(true);
  });

  it('clamps offline time so idling cannot mint unlimited resources', () => {
    const result = accrue({
      producers: [{ ratePerHour: 100, multiplier: 1 }],
      current: 0,
      capacity: 1_000_000,
      elapsedMs: oneHour * 240, // ten days offline
      maxOfflineHours: 12,
    });
    expect(result.gained).toBe(1200); // 12h cap, not 240h
  });

  it('is a no-op for a non-positive elapsed time', () => {
    const result = accrue({
      producers: [{ ratePerHour: 500, multiplier: 1 }],
      current: 250,
      capacity: 1000,
      elapsedMs: 0,
      maxOfflineHours: 12,
    });
    expect(result.gained).toBe(0);
    expect(result.stored).toBe(250);
  });

  it('is a no-op with no producers', () => {
    expect(
      accrue({
        producers: [],
        current: 10,
        capacity: 1000,
        elapsedMs: oneHour,
        maxOfflineHours: 12,
      }).gained,
    ).toBe(0);
  });

  it('reports time-to-full for the HUD', () => {
    expect(secondsUntilFull(0, 3600, 3600)).toBe(3600);
    expect(secondsUntilFull(3600, 3600, 3600)).toBe(0);
    expect(secondsUntilFull(0, 3600, 0)).toBeNull();
  });
});

describe('empire power and levels', () => {
  const base = {
    hqLevel: 1,
    buildingLevelSum: 8,
    buildingCount: 8,
    armyPopulation: 15,
    armyOffense: 230,
    defenseRating: 22,
    plotCount: 1,
    researchCount: 0,
  };

  it('is deterministic and non-negative', () => {
    const power = calculateEmpirePower(base);
    expect(power).toBe(calculateEmpirePower(base));
    expect(power).toBeGreaterThan(0);
  });

  it('rises monotonically with progress', () => {
    const stronger = calculateEmpirePower({ ...base, hqLevel: 5, plotCount: 3 });
    expect(stronger).toBeGreaterThan(calculateEmpirePower(base));
  });

  it('returns zero for an empty empire', () => {
    expect(
      calculateEmpirePower({
        hqLevel: 0,
        buildingLevelSum: 0,
        buildingCount: 0,
        armyPopulation: 0,
        armyOffense: 0,
        defenseRating: 0,
        plotCount: 0,
        researchCount: 0,
      }),
    ).toBe(0);
  });

  it('uses an increasing XP curve', () => {
    expect(xpForNextLevel(1)).toBe(500);
    expect(xpForNextLevel(2)).toBeGreaterThan(xpForNextLevel(1));
  });

  it('inverts the XP curve consistently', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(499)).toBe(1);
    expect(levelFromXp(500)).toBe(2);
    expect(levelFromXp(500 + xpForNextLevel(2))).toBe(3);
  });

  it('respects the level ceiling', () => {
    expect(levelFromXp(Number.MAX_SAFE_INTEGER, 500, 1.35, 10)).toBe(10);
  });
});
