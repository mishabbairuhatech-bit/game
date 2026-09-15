import type { Biome } from '@empire/shared';
import { fbm2D, hashSeed, Rng } from './rng';

/**
 * Deterministic world generation.
 *
 * Everything here is a pure function of (seed, coordinates). The same seed
 * always produces the same world, on any machine, forever - which is what
 * makes it safe to store only the seed and regenerate terrain on demand
 * instead of persisting a height value for every tile.
 *
 * The generator layers three noise fields and reads a biome out of them,
 * rather than picking a biome at random. That gives coherent terrain -
 * mountains form ranges, water forms lakes and rivers, deserts form belts -
 * instead of a confetti of unrelated tiles.
 */

export interface WorldGenParams {
  /** World seed string, e.g. "EMPIRE-001". */
  seed: string;
  /** World edge length in tiles. Used to normalise coordinates. */
  size: number;
  /**
   * Noise frequency. Higher values produce smaller, more numerous features.
   * The default gives continent-scale landmasses on a 1000-tile world.
   */
  featureScale?: number;
  /** Fraction of the world below sea level, 0-1. */
  waterLevel?: number;
  /** Fraction of the world above the mountain line, 0-1. */
  mountainLevel?: number;
}

interface ResolvedParams extends Required<WorldGenParams> {
  elevationSeed: number;
  moistureSeed: number;
  temperatureSeed: number;
  riverSeed: number;
}

function resolve(params: WorldGenParams): ResolvedParams {
  const base = hashSeed(params.seed);
  return {
    seed: params.seed,
    size: params.size,
    featureScale: params.featureScale ?? 3.2,
    waterLevel: params.waterLevel ?? 0.3,
    mountainLevel: params.mountainLevel ?? 0.78,
    // Distinct offsets so the three fields are uncorrelated; derived from the
    // world seed so the whole world stays reproducible from one string.
    elevationSeed: base,
    moistureSeed: (base ^ 0x9e3779b9) >>> 0,
    temperatureSeed: (base ^ 0x85ebca6b) >>> 0,
    riverSeed: (base ^ 0xc2b2ae35) >>> 0,
  };
}

export interface TerrainSample {
  /** 0 (deep) .. 1 (peak). */
  elevation: number;
  /** 0 (arid) .. 1 (saturated). */
  moisture: number;
  /** 0 (frozen) .. 1 (hot). */
  temperature: number;
  /** 0 .. 1, high values trace watercourses. */
  river: number;
  biome: Biome;
}

/**
 * Samples the terrain fields at a normalised position.
 *
 * `nx`/`ny` are 0..1 across the world, so the same logical position samples
 * identically whether the caller is thinking in tiles, plots or regions.
 */
export function sampleTerrain(params: WorldGenParams, nx: number, ny: number): TerrainSample {
  const p = resolve(params);
  const f = p.featureScale;

  // Elevation: broad landmasses with finer detail on top.
  let elevation = fbm2D(p.elevationSeed, nx * f, ny * f, 5);

  // Pull elevation down towards the world edge so the map reads as an island
  // rather than terrain that has been sliced off by the boundary.
  const edgeX = Math.min(nx, 1 - nx);
  const edgeY = Math.min(ny, 1 - ny);
  const edge = Math.min(edgeX, edgeY);
  const falloff = Math.min(1, edge / 0.12);
  elevation *= 0.35 + 0.65 * falloff;

  const moisture = fbm2D(p.moistureSeed, nx * f * 1.7, ny * f * 1.7, 4);

  // Temperature is mostly latitude with a little noise, so climate bands run
  // roughly east-west the way they do on a real map.
  const latitude = 1 - Math.abs(ny - 0.5) * 2;
  const temperature = Math.min(
    1,
    Math.max(0, latitude * 0.75 + fbm2D(p.temperatureSeed, nx * f * 0.8, ny * f * 0.8, 3) * 0.25),
  );

  // Ridged noise: a narrow band around 0.5 traces a connected line, which
  // reads as a watercourse.
  const raw = fbm2D(p.riverSeed, nx * f * 2.1, ny * f * 2.1, 4);
  const river = 1 - Math.abs(raw - 0.5) * 2;

  return {
    elevation,
    moisture,
    temperature,
    river,
    biome: classify(p, { elevation, moisture, temperature, river }),
  };
}

function classify(
  p: ResolvedParams,
  s: { elevation: number; moisture: number; temperature: number; river: number },
): Biome {
  // Order matters: each rule assumes the ones above it did not fire.

  if (s.elevation < p.waterLevel) return 'WATER';

  if (s.elevation > p.mountainLevel) return 'MOUNTAIN';

  // Just below the peaks: exposed stone and thin turf.
  if (s.elevation > p.mountainLevel - 0.1) {
    return s.moisture > 0.55 ? 'HIGHLAND' : 'ROCKY';
  }

  // Strong river signal on low, wet ground.
  if (s.river > 0.93 && s.elevation < 0.55) return 'RIVERLAND';

  // Shoreline: low ground immediately above the waterline.
  if (s.elevation < p.waterLevel + 0.05) return 'LAKESHORE';

  if (s.temperature < 0.22) return 'TUNDRA';

  if (s.temperature > 0.7 && s.moisture < 0.3) return 'DESERT';

  if (s.moisture > 0.72 && s.elevation < 0.5) return 'SWAMP';

  if (s.moisture > 0.55) return 'FOREST';

  if (s.moisture < 0.32 && s.temperature > 0.5) return 'BADLANDS';

  return 'GRASSLAND';
}

/* -------------------------------------------------------------------------- */
/* Tier helpers                                                                */
/* -------------------------------------------------------------------------- */

/** Biome at a plot's centre. This is the plot's canonical biome. */
export function biomeForPlot(
  params: WorldGenParams,
  plotX: number,
  plotY: number,
  plotSize: number,
): Biome {
  const centreTileX = plotX * plotSize + plotSize / 2;
  const centreTileY = plotY * plotSize + plotSize / 2;
  return sampleTerrain(params, centreTileX / params.size, centreTileY / params.size).biome;
}

/**
 * Dominant biome across an area, by sampling a grid inside it.
 *
 * Used for regions and zones, whose biome is a summary for far-zoom map
 * colouring rather than a gameplay input. Sampling beats taking the centre:
 * a region whose centre happens to be a lake is not "a water region".
 */
export function dominantBiome(
  params: WorldGenParams,
  tileX: number,
  tileY: number,
  sizeTiles: number,
  samples = 6,
): Biome {
  const tally = new Map<Biome, number>();

  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = tileX + ((i + 0.5) / samples) * sizeTiles;
      const y = tileY + ((j + 0.5) / samples) * sizeTiles;
      const { biome } = sampleTerrain(params, x / params.size, y / params.size);
      tally.set(biome, (tally.get(biome) ?? 0) + 1);
    }
  }

  let winner: Biome = 'GRASSLAND';
  let best = -1;
  // Iterate a sorted key list so ties resolve identically on every run -
  // Map iteration order is insertion order, which depends on sampling order.
  for (const biome of [...tally.keys()].sort()) {
    const count = tally.get(biome) ?? 0;
    if (count > best) {
      best = count;
      winner = biome;
    }
  }
  return winner;
}

/**
 * Fraction of a plot covered by water or sheer rock, in basis points.
 *
 * Drives both the price and how much of the plot is actually usable, so it is
 * measured rather than inferred from the plot's single biome label.
 */
export function unbuildableCoverageBps(
  params: WorldGenParams,
  plotX: number,
  plotY: number,
  plotSize: number,
  samples = 5,
): number {
  let blocked = 0;
  const total = samples * samples;

  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = plotX * plotSize + ((i + 0.5) / samples) * plotSize;
      const y = plotY * plotSize + ((j + 0.5) / samples) * plotSize;
      const { biome } = sampleTerrain(params, x / params.size, y / params.size);
      if (biome === 'WATER' || biome === 'MOUNTAIN') blocked++;
    }
  }

  return Math.round((blocked / total) * 10000);
}

/**
 * Per-plot terrain detail for the renderer.
 *
 * Deliberately small: a seed plus a few summary numbers, not a heightmap. The
 * client regenerates the detail from the seed, so streaming a region costs
 * kilobytes rather than megabytes.
 */
export interface PlotTerrain {
  seed: string;
  elevation: number;
  moisture: number;
  temperature: number;
  waterBps: number;
}

export function plotTerrain(
  params: WorldGenParams,
  plotX: number,
  plotY: number,
  plotSize: number,
): PlotTerrain {
  const centreX = (plotX * plotSize + plotSize / 2) / params.size;
  const centreY = (plotY * plotSize + plotSize / 2) / params.size;
  const s = sampleTerrain(params, centreX, centreY);

  return {
    seed: `${params.seed}:${plotX}:${plotY}`,
    elevation: Math.round(s.elevation * 1000) / 1000,
    moisture: Math.round(s.moisture * 1000) / 1000,
    temperature: Math.round(s.temperature * 1000) / 1000,
    waterBps: unbuildableCoverageBps(params, plotX, plotY, plotSize),
  };
}

/* -------------------------------------------------------------------------- */
/* Naming                                                                      */
/* -------------------------------------------------------------------------- */

const NAME_PREFIX = [
  'North', 'South', 'East', 'West', 'Upper', 'Lower', 'Outer', 'Inner',
  'Old', 'Far', 'High', 'Deep',
];
const NAME_ROOT = [
  'March', 'Reach', 'Vale', 'Hold', 'Expanse', 'Barrow', 'Fen', 'Wold',
  'Cairn', 'Hollow', 'Ridge', 'Weald', 'Downs', 'Moor', 'Basin', 'Spur',
];

/**
 * Deterministic region name. Derived from the seed and coordinates so the
 * same region is always called the same thing, which matters once players
 * start referring to places by name.
 */
export function regionName(seed: string, regionX: number, regionY: number): string {
  const rng = new Rng(`${seed}:region:${regionX}:${regionY}`);
  return `${rng.pick(NAME_PREFIX)} ${rng.pick(NAME_ROOT)}`;
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

export interface PlotPriceInputs {
  basePrice: number;
  /** Terrain price modifier, in basis points. */
  biomeModifierBps: number;
  /** Region-wide modifier, in basis points. */
  regionModifierBps: number;
  /** Fraction of the plot that is unbuildable, in basis points. */
  unbuildableBps: number;
  /** Chebyshev distance from the world centre, in plots. */
  distanceFromCentre: number;
  /** Plots along one edge of the world, for normalising the distance. */
  plotsPerSide: number;
}

/**
 * Server-computed asking price for a plot bought from the world.
 *
 * Never sent by, or trusted from, the client. Land near the centre is dearer
 * (it is contested and well-connected); land that is half lake is cheaper.
 */
export function calculatePlotPrice(i: PlotPriceInputs): bigint {
  const half = i.plotsPerSide / 2;
  const normalised = half > 0 ? Math.min(1, i.distanceFromCentre / half) : 0;
  // 1.35x at the centre down to 0.75x at the rim.
  const centralityBps = Math.round(13500 - normalised * 6000);

  // A plot that is 40% water is worth ~40% less usable ground.
  const usabilityBps = Math.max(2000, 10000 - i.unbuildableBps);

  const price =
    (i.basePrice *
      i.biomeModifierBps *
      i.regionModifierBps *
      centralityBps *
      usabilityBps) /
    (10000 * 10000 * 10000 * 10000);

  // Round to a readable figure - nobody wants to see 2 837 coins.
  const rounded = Math.max(100, Math.round(price / 50) * 50);
  return BigInt(rounded);
}
