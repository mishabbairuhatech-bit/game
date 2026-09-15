import { Biome } from '@empire/shared';
import { TERRAIN_RULES, type TerrainRule } from './terrain';
import type { EnvironmentDefinition } from './types';

/**
 * Terrain and scatter props. Everything here is procedurally rendered until a
 * GLB is dropped into /assets/environment and referenced from `asset.model`.
 */
export const ENVIRONMENT: EnvironmentDefinition[] = [
  {
    key: 'terrain_grass',
    name: 'Open Grass',
    kind: 'terrain',
    biomes: [Biome.GRASSLAND, Biome.RIVERLAND, Biome.LAKESHORE],
    buildable: true,
    walkable: true,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#6f9a4a', accent: '#5b8039', scale: [1, 0.1, 1] },
    },
  },
  {
    key: 'terrain_highland',
    name: 'Highland Turf',
    kind: 'terrain',
    biomes: [Biome.HIGHLAND, Biome.TUNDRA],
    buildable: true,
    walkable: true,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#7c8f6a', accent: '#647457', scale: [1, 0.1, 1] },
    },
  },
  {
    key: 'terrain_rock',
    name: 'Rocky Ground',
    kind: 'terrain',
    biomes: [Biome.MOUNTAIN, Biome.BADLANDS],
    buildable: true,
    walkable: true,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#8a8175', accent: '#6b635a', scale: [1, 0.1, 1] },
    },
  },
  {
    key: 'mountain_peak',
    name: 'Mountain',
    kind: 'prop',
    biomes: [Biome.MOUNTAIN, Biome.HIGHLAND],
    buildable: false,
    walkable: false,
    density: 0.18,
    asset: {
      model: null,
      placeholder: { shape: 'cone', color: '#7b7367', accent: '#efefef', scale: [4, 6, 4] },
      lod: { high: 80, medium: 200, low: 500 },
    },
  },
  {
    key: 'forest_tree',
    name: 'Conifer',
    kind: 'prop',
    biomes: [Biome.FOREST, Biome.HIGHLAND, Biome.GRASSLAND],
    buildable: false,
    walkable: false,
    density: 0.35,
    asset: {
      model: null,
      placeholder: { shape: 'cone', color: '#2f6b3a', accent: '#4a3222', scale: [1.2, 2.6, 1.2] },
      lod: { high: 40, medium: 110, low: 260 },
    },
  },
  {
    key: 'boulder',
    name: 'Boulder',
    kind: 'prop',
    biomes: [Biome.MOUNTAIN, Biome.BADLANDS, Biome.TUNDRA],
    buildable: false,
    walkable: false,
    density: 0.12,
    asset: {
      model: null,
      placeholder: { shape: 'sphere', color: '#8c8378', accent: '#5f584f', scale: [1.1, 0.9, 1.1] },
    },
  },
  {
    key: 'river',
    name: 'River',
    kind: 'water',
    biomes: [Biome.RIVERLAND],
    buildable: false,
    walkable: false,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#3b82c4', accent: '#1d4e7a', scale: [1, 0.06, 1] },
    },
  },
  {
    key: 'lake',
    name: 'Lake',
    kind: 'water',
    biomes: [Biome.LAKESHORE],
    buildable: false,
    walkable: false,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#2f6fa8', accent: '#194466', scale: [1, 0.06, 1] },
    },
  },
  {
    key: 'road',
    name: 'Trade Road',
    kind: 'road',
    biomes: [],
    buildable: false,
    walkable: true,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#b09a72', accent: '#8a7756', scale: [1, 0.12, 1] },
    },
  },
];

export const ENVIRONMENT_BY_KEY = new Map(ENVIRONMENT.map((e) => [e.key, e]));

/**
 * Per-biome palette and modifiers.
 *
 * Derived from TERRAIN_RULES rather than maintained separately: two hand-kept
 * tables of biome data inevitably drift, and a renderer that disagrees with
 * the server about which ground is buildable is a bug the player sees.
 */
export interface BiomeProfile {
  label: string;
  ground: string;
  accent: string;
  /** Multiplier applied to a plot's base price. */
  priceMultiplier: number;
  yieldBonus: Partial<Record<'WOOD' | 'STONE' | 'FOOD' | 'IRON' | 'GOLD', number>>;
  props: string[];
  /** Non-colour encodings, so the map is readable without relying on hue. */
  glyph: string;
  pattern: TerrainRule['pattern'];
  buildability: TerrainRule['buildability'];
}

export const BIOME_PROFILE: Record<Biome, BiomeProfile> = Object.fromEntries(
  Object.entries(TERRAIN_RULES).map(([biome, rule]) => [
    biome,
    {
      label: rule.label,
      ground: rule.color,
      accent: rule.accent,
      priceMultiplier: rule.priceModifierBps / 10000,
      yieldBonus: rule.yieldBonus,
      props: rule.props,
      glyph: rule.glyph,
      pattern: rule.pattern,
      buildability: rule.buildability,
    },
  ]),
) as Record<Biome, BiomeProfile>;
