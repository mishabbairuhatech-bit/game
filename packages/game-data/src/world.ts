/**
 * World geometry.
 *
 * The world is a square grid of logical tiles, partitioned three ways so the
 * client can stream a slice of it instead of all of it:
 *
 *   WORLD  -> REGION -> ZONE -> PLOT
 *
 * Every size is expressed in *tiles* and is configurable. The authoritative
 * values for a running world live on the `worlds` row; the constants here are
 * only the defaults a new world is generated with, and the pure maths that
 * both the server and the renderer need to agree on.
 *
 * Record counts matter. The development default produces 100 regions, 2 500
 * zones and 10 000 plots - small enough to generate in seconds and to hold in
 * a browser's memory when zoomed out. Scaling up is a configuration change,
 * not a code change: raise `width`/`height` and the same generator produces a
 * bigger world, streamed region by region.
 */

export interface WorldGeometry {
  /** Width of the world in logical tiles. */
  width: number;
  /** Height of the world in logical tiles. */
  height: number;
  /** Edge length of a region, in tiles. */
  regionSize: number;
  /** Edge length of a zone, in tiles. */
  zoneSize: number;
  /** Edge length of a plot, in tiles. This is also the build grid. */
  plotSize: number;
}

/**
 * Development default: 1000x1000 tiles.
 *
 *   region 100x100  ->  10 x 10  =    100 regions
 *   zone    20x20   ->  50 x 50  =  2 500 zones
 *   plot    10x10   -> 100 x 100 = 10 000 plots
 */
export const DEFAULT_WORLD_GEOMETRY: WorldGeometry = {
  width: 1000,
  height: 1000,
  regionSize: 100,
  zoneSize: 20,
  plotSize: 10,
};

/** Thrown by `validateGeometry` when the partitioning does not divide evenly. */
export class InvalidWorldGeometryError extends Error {}

/**
 * A world whose tiers do not divide evenly would produce partial regions at
 * the edges and off-by-one coordinate maths everywhere downstream. Fail loudly
 * at generation time instead.
 */
export function validateGeometry(g: WorldGeometry): void {
  const problems: string[] = [];

  if (g.width <= 0 || g.height <= 0) problems.push('width and height must be positive');
  if (g.width !== g.height) problems.push('only square worlds are supported');
  if (g.regionSize % g.zoneSize !== 0) {
    problems.push(`regionSize (${g.regionSize}) must be a multiple of zoneSize (${g.zoneSize})`);
  }
  if (g.zoneSize % g.plotSize !== 0) {
    problems.push(`zoneSize (${g.zoneSize}) must be a multiple of plotSize (${g.plotSize})`);
  }
  if (g.width % g.regionSize !== 0) {
    problems.push(`width (${g.width}) must be a multiple of regionSize (${g.regionSize})`);
  }

  if (problems.length > 0) {
    throw new InvalidWorldGeometryError(`Invalid world geometry: ${problems.join('; ')}.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Derived counts                                                              */
/* -------------------------------------------------------------------------- */

export interface WorldCounts {
  regionsPerSide: number;
  zonesPerSide: number;
  plotsPerSide: number;
  zonesPerRegionSide: number;
  plotsPerZoneSide: number;
  totalRegions: number;
  totalZones: number;
  totalPlots: number;
}

export function worldCounts(g: WorldGeometry): WorldCounts {
  const regionsPerSide = g.width / g.regionSize;
  const zonesPerSide = g.width / g.zoneSize;
  const plotsPerSide = g.width / g.plotSize;

  return {
    regionsPerSide,
    zonesPerSide,
    plotsPerSide,
    zonesPerRegionSide: g.regionSize / g.zoneSize,
    plotsPerZoneSide: g.zoneSize / g.plotSize,
    totalRegions: regionsPerSide * regionsPerSide,
    totalZones: zonesPerSide * zonesPerSide,
    totalPlots: plotsPerSide * plotsPerSide,
  };
}

/* -------------------------------------------------------------------------- */
/* Coordinate maths                                                            */
/* -------------------------------------------------------------------------- */

export interface PlotLocation {
  /** Plot-grid coordinates. */
  plotX: number;
  plotY: number;
  /** Zone-grid coordinates the plot belongs to. */
  zoneX: number;
  zoneY: number;
  /** Region-grid coordinates the plot belongs to. */
  regionX: number;
  regionY: number;
  /** Tile coordinates of the plot's north-west corner. */
  tileX: number;
  tileY: number;
}

/** Plot-grid coordinate -> every tier above it. */
export function locatePlot(g: WorldGeometry, plotX: number, plotY: number): PlotLocation {
  const tileX = plotX * g.plotSize;
  const tileY = plotY * g.plotSize;
  return {
    plotX,
    plotY,
    zoneX: Math.floor(tileX / g.zoneSize),
    zoneY: Math.floor(tileY / g.zoneSize),
    regionX: Math.floor(tileX / g.regionSize),
    regionY: Math.floor(tileY / g.regionSize),
    tileX,
    tileY,
  };
}

/** Zone-grid coordinate -> its region. */
export function zoneToRegion(
  g: WorldGeometry,
  zoneX: number,
  zoneY: number,
): { regionX: number; regionY: number } {
  const zonesPerRegionSide = g.regionSize / g.zoneSize;
  return {
    regionX: Math.floor(zoneX / zonesPerRegionSide),
    regionY: Math.floor(zoneY / zonesPerRegionSide),
  };
}

/** Tile coordinate -> the plot containing it. */
export function tileToPlot(
  g: WorldGeometry,
  tileX: number,
  tileY: number,
): { plotX: number; plotY: number } {
  return { plotX: Math.floor(tileX / g.plotSize), plotY: Math.floor(tileY / g.plotSize) };
}

/* -------------------------------------------------------------------------- */
/* Codes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Stable, human-readable plot code: `R3-4:Z18-22:P92-113`.
 *
 * Used in the UI, in search, and as the deterministic seed for a plot's
 * terrain - so it must never change for a given coordinate.
 */
export function plotCode(g: WorldGeometry, plotX: number, plotY: number): string {
  const l = locatePlot(g, plotX, plotY);
  return `R${l.regionX}-${l.regionY}:Z${l.zoneX}-${l.zoneY}:P${plotX}-${plotY}`;
}

export function regionCode(regionX: number, regionY: number): string {
  return `R${regionX}-${regionY}`;
}

export function zoneCode(zoneX: number, zoneY: number): string {
  return `Z${zoneX}-${zoneY}`;
}

/** Parses `R3-4:Z18-22:P92-113` back to plot coordinates. Null if malformed. */
export function parsePlotCode(code: string): { plotX: number; plotY: number } | null {
  const match = /:P(\d+)-(\d+)$/.exec(code.trim());
  if (!match) return null;
  return { plotX: Number(match[1]), plotY: Number(match[2]) };
}

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

export function plotInWorld(g: WorldGeometry, plotX: number, plotY: number): boolean {
  const perSide = g.width / g.plotSize;
  return (
    Number.isInteger(plotX) &&
    Number.isInteger(plotY) &&
    plotX >= 0 &&
    plotY >= 0 &&
    plotX < perSide &&
    plotY < perSide
  );
}

/** Four-way neighbours of a plot, clipped to the world bounds. */
export function plotNeighbours(
  g: WorldGeometry,
  plotX: number,
  plotY: number,
): { x: number; y: number }[] {
  return [
    { x: plotX + 1, y: plotY },
    { x: plotX - 1, y: plotY },
    { x: plotX, y: plotY + 1 },
    { x: plotX, y: plotY - 1 },
  ].filter((p) => plotInWorld(g, p.x, p.y));
}

/** Chebyshev distance in plot units - the natural metric on a square grid. */
export function plotDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                    */
/* -------------------------------------------------------------------------- */

/** An inclusive plot-grid rectangle. */
export interface PlotBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Clamps a requested viewport to the world and to a maximum area.
 *
 * The cap is the whole point: without it a client could ask for the entire
 * world in one query. The server clamps rather than rejecting so a slightly
 * oversized viewport still renders, just truncated.
 */
export function clampBounds(
  g: WorldGeometry,
  requested: PlotBounds,
  maxPlots: number,
): { bounds: PlotBounds; truncated: boolean } {
  const perSide = g.width / g.plotSize;

  const minX = Math.max(0, Math.min(perSide - 1, Math.floor(requested.minX)));
  const minY = Math.max(0, Math.min(perSide - 1, Math.floor(requested.minY)));
  let maxX = Math.max(minX, Math.min(perSide - 1, Math.floor(requested.maxX)));
  let maxY = Math.max(minY, Math.min(perSide - 1, Math.floor(requested.maxY)));

  let truncated = false;
  // Shrink the far edges symmetrically until the area fits the cap.
  while ((maxX - minX + 1) * (maxY - minY + 1) > maxPlots && (maxX > minX || maxY > minY)) {
    truncated = true;
    if (maxX - minX >= maxY - minY && maxX > minX) maxX--;
    else if (maxY > minY) maxY--;
    else break;
  }

  return { bounds: { minX, minY, maxX, maxY }, truncated };
}

/** Largest viewport a single map query may return. */
export const MAX_VIEWPORT_PLOTS = 2500;

/* -------------------------------------------------------------------------- */
/* Backwards-compatible aliases                                                */
/* -------------------------------------------------------------------------- */

/**
 * Phase 1 shipped a fixed `WORLD` constant. Keeping the name pointing at the
 * default geometry means existing imports keep working while new code takes
 * geometry as a parameter.
 */
export const WORLD = DEFAULT_WORLD_GEOMETRY;
