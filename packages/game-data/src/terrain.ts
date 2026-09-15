import type { Biome } from '@empire/shared';

/**
 * Terrain rules.
 *
 * This file is the single source of truth for what each biome means. The
 * server enforces these rules; the renderer reads the same table for colours
 * and props. Scattering "is this buildable?" logic through UI code is how a
 * client ends up letting a player place a keep in a lake and only finding out
 * after a 422.
 */

export type Buildability =
  /** Freely buildable. */
  | 'BUILDABLE'
  /** Buildable, but at a cost or with a reduced usable area. */
  | 'CONDITIONAL'
  /** Never buildable. */
  | 'BLOCKED';

export interface TerrainRule {
  biome: Biome;
  label: string;
  description: string;
  buildability: Buildability;
  /**
   * Fraction of the plot lost to unusable terrain, in basis points.
   * CONDITIONAL biomes cost usable area; BLOCKED biomes are 100% lost.
   */
  unusableBps: number;
  /** Can troops cross it during a raid? */
  traversable: boolean;
  /** Multiplier applied to a plot's base price, in basis points. */
  priceModifierBps: number;
  /** Production multipliers granted to buildings standing on this biome. */
  yieldBonus: Partial<Record<'WOOD' | 'STONE' | 'FOOD' | 'IRON' | 'GOLD', number>>;
  /** Ground colour used by the map renderer. */
  color: string;
  /** Secondary colour for props and edges. */
  accent: string;
  /**
   * Non-colour identifier. Colour alone is not an accessible encoding, so the
   * map also renders this glyph and a fill pattern per biome.
   */
  glyph: string;
  pattern: 'solid' | 'dots' | 'hatch' | 'cross' | 'waves' | 'peaks' | 'grain';
  /** Environment prop keys scattered on this biome. */
  props: string[];
}

export const TERRAIN_RULES: Record<Biome, TerrainRule> = {
  GRASSLAND: {
    biome: 'GRASSLAND',
    label: 'Grassland',
    description: 'Open, level ground. The easiest land to build on.',
    buildability: 'BUILDABLE',
    unusableBps: 0,
    traversable: true,
    priceModifierBps: 10000,
    yieldBonus: { FOOD: 1.1 },
    color: '#6f9a4a',
    accent: '#5b8039',
    glyph: '·',
    pattern: 'solid',
    props: ['forest_tree'],
  },
  FOREST: {
    biome: 'FOREST',
    label: 'Woodland',
    description: 'Dense timber. Must be partly cleared before building.',
    buildability: 'CONDITIONAL',
    unusableBps: 2500,
    traversable: true,
    priceModifierBps: 11500,
    yieldBonus: { WOOD: 1.3 },
    color: '#4f7c3a',
    accent: '#2f6b3a',
    glyph: '↑',
    pattern: 'dots',
    props: ['forest_tree'],
  },
  MOUNTAIN: {
    biome: 'MOUNTAIN',
    label: 'Mountain',
    description: 'Sheer rock. Cannot be built on, and blocks movement.',
    buildability: 'BLOCKED',
    unusableBps: 10000,
    traversable: false,
    priceModifierBps: 13500,
    yieldBonus: { STONE: 1.3, IRON: 1.25, GOLD: 1.2 },
    color: '#8a8175',
    accent: '#efefef',
    glyph: '▲',
    pattern: 'peaks',
    props: ['mountain_peak', 'boulder'],
  },
  WATER: {
    biome: 'WATER',
    label: 'Water',
    description: 'Open water. Cannot be built on or crossed.',
    buildability: 'BLOCKED',
    unusableBps: 10000,
    traversable: false,
    priceModifierBps: 8000,
    yieldBonus: {},
    color: '#2f6fa8',
    accent: '#194466',
    glyph: '≈',
    pattern: 'waves',
    props: ['lake'],
  },
  DESERT: {
    biome: 'DESERT',
    label: 'Desert',
    description: 'Arid sand. Buildable but grows almost nothing.',
    buildability: 'BUILDABLE',
    unusableBps: 0,
    traversable: true,
    priceModifierBps: 7000,
    yieldBonus: { FOOD: 0.6, GOLD: 1.1 },
    color: '#c8a86a',
    accent: '#a2854b',
    glyph: '~',
    pattern: 'grain',
    props: ['boulder'],
  },
  SWAMP: {
    biome: 'SWAMP',
    label: 'Swamp',
    description: 'Waterlogged ground. Needs draining before heavy building.',
    buildability: 'CONDITIONAL',
    unusableBps: 4000,
    traversable: true,
    priceModifierBps: 6500,
    yieldBonus: { FOOD: 0.9, WOOD: 1.1 },
    color: '#5c6b48',
    accent: '#3d4a30',
    glyph: '⌇',
    pattern: 'hatch',
    props: ['forest_tree'],
  },
  ROCKY: {
    biome: 'ROCKY',
    label: 'Rocky Flats',
    description: 'Broken stone. Hard going, but rich in ore.',
    buildability: 'CONDITIONAL',
    unusableBps: 3000,
    traversable: true,
    priceModifierBps: 9500,
    yieldBonus: { STONE: 1.25, IRON: 1.15 },
    color: '#8d8d8d',
    accent: '#5a5a5a',
    glyph: '◆',
    pattern: 'cross',
    props: ['boulder'],
  },
  RIVERLAND: {
    biome: 'RIVERLAND',
    label: 'Riverland',
    description: 'Fertile ground along a watercourse. Prime farmland.',
    buildability: 'CONDITIONAL',
    unusableBps: 1500,
    traversable: true,
    priceModifierBps: 12500,
    yieldBonus: { FOOD: 1.25 },
    color: '#6a9c58',
    accent: '#3b82c4',
    glyph: '≀',
    pattern: 'waves',
    props: ['river', 'forest_tree'],
  },
  LAKESHORE: {
    biome: 'LAKESHORE',
    label: 'Lakeshore',
    description: 'Sheltered water margin. Desirable and productive.',
    buildability: 'CONDITIONAL',
    unusableBps: 2000,
    traversable: true,
    priceModifierBps: 13000,
    yieldBonus: { FOOD: 1.2 },
    color: '#6d9d66',
    accent: '#2f6fa8',
    glyph: '◡',
    pattern: 'waves',
    props: ['lake'],
  },
  HIGHLAND: {
    biome: 'HIGHLAND',
    label: 'Highland',
    description: 'Elevated turf. Good visibility, awkward ground.',
    buildability: 'BUILDABLE',
    unusableBps: 500,
    traversable: true,
    priceModifierBps: 11000,
    yieldBonus: { STONE: 1.15 },
    color: '#7c8f6a',
    accent: '#647457',
    glyph: '⌃',
    pattern: 'hatch',
    props: ['forest_tree', 'mountain_peak'],
  },
  BADLANDS: {
    biome: 'BADLANDS',
    label: 'Badlands',
    description: 'Scoured, mineral-streaked ground. Cheap land.',
    buildability: 'BUILDABLE',
    unusableBps: 0,
    traversable: true,
    priceModifierBps: 8000,
    yieldBonus: { IRON: 1.2, GOLD: 1.15 },
    color: '#a2795a',
    accent: '#6b4f38',
    glyph: '⋰',
    pattern: 'grain',
    props: ['boulder'],
  },
  TUNDRA: {
    biome: 'TUNDRA',
    label: 'Tundra',
    description: 'Frozen plain. Buildable, but nothing grows well.',
    buildability: 'BUILDABLE',
    unusableBps: 0,
    traversable: true,
    priceModifierBps: 7500,
    yieldBonus: { FOOD: 0.7 },
    color: '#9aa8a3',
    accent: '#7d8a86',
    glyph: '∗',
    pattern: 'dots',
    props: ['boulder'],
  },
};

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function terrainRule(biome: Biome): TerrainRule {
  const rule = TERRAIN_RULES[biome];
  if (!rule) throw new Error(`No terrain rule defined for biome "${biome}".`);
  return rule;
}

/** True when a plot of this biome can host buildings at all. */
export function isBuildable(biome: Biome): boolean {
  return terrainRule(biome).buildability !== 'BLOCKED';
}

/** True when troops can cross this biome. */
export function isTraversable(biome: Biome): boolean {
  return terrainRule(biome).traversable;
}

/** Buildable tiles on a plot of the given biome, after unusable terrain. */
export function usableTiles(biome: Biome, plotSize: number): number {
  const rule = terrainRule(biome);
  const total = plotSize * plotSize;
  return Math.floor((total * (10000 - rule.unusableBps)) / 10000);
}

/** Biomes a starter plot may be placed on: buildable, no penalty, decent yield. */
export const STARTER_BIOMES: Biome[] = ['GRASSLAND', 'RIVERLAND', 'HIGHLAND', 'LAKESHORE'];

/** Biomes that can never be sold or owned - they are scenery. */
export const UNCLAIMABLE_BIOMES: Biome[] = ['WATER', 'MOUNTAIN'];

export function isClaimable(biome: Biome): boolean {
  return !UNCLAIMABLE_BIOMES.includes(biome);
}
