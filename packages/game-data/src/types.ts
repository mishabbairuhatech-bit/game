import type {
  Biome,
  BuildingCategory,
  ResourceKey,
  UnitClass,
} from '@empire/shared';

/** A cost bundle: any subset of resources/currencies. */
export type CostBundle = Partial<Record<ResourceKey, number>>;

/**
 * ---------------------------------------------------------------------------
 * ASSET REGISTRY
 * ---------------------------------------------------------------------------
 * Definitions describe *gameplay*, and point at art through an `asset` block.
 * Swapping placeholder art for final GLB models means editing only `asset` -
 * no gameplay code changes. `model: null` renders the procedural placeholder
 * mesh described by `placeholder`.
 */
export interface AssetRef {
  /** Path under /assets, e.g. "buildings/hq_lv1.glb". Null => procedural. */
  model: string | null;
  /** Procedural fallback so the game is playable before art exists. */
  placeholder: {
    shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'pyramid' | 'tower' | 'wall';
    color: string;
    accent?: string;
    /** World units (1 unit == 1 grid tile). */
    scale: [number, number, number];
  };
  icon?: string | null;
  /** Distance thresholds (world units) at which to swap to a cheaper mesh. */
  lod?: { high: number; medium: number; low: number };
}

export interface BuildingLevelSpec {
  level: number;
  buildCost: CostBundle;
  buildSeconds: number;
  hitpoints: number;
  /** Resources produced per hour at this level (production buildings). */
  production?: Partial<Record<ResourceKey, number>>;
  /** Extra storage granted at this level (storage buildings). */
  storage?: Partial<Record<ResourceKey, number>>;
  /** Combat profile (defensive buildings). */
  defense?: {
    damagePerSecond: number;
    range: number;
    /** Which unit classes this tower can hit. */
    targets: UnitClass[];
    splashRadius?: number;
    attackCooldownMs: number;
  };
  /** Capacity effects (barracks / camps / builders). */
  capacity?: {
    populationCapacity?: number;
    trainingSlots?: number;
    builders?: number;
    researchSlots?: number;
  };
  /** Minimum Headquarters level required to reach this building level. */
  requiredHqLevel: number;
  /** How many of this building the player may own at this HQ level. */
  maxCountAtHq?: number;
}

export interface BuildingDefinition {
  key: string;
  name: string;
  description: string;
  category: BuildingCategory;
  /** Footprint in grid tiles. */
  footprint: { width: number; height: number };
  /** Can only ever exist once per empire (Headquarters, Treasury, ...). */
  unique: boolean;
  /** Blocks enemy pathing during a raid. */
  blocksMovement: boolean;
  /** Biomes this building may be placed on. Empty => any buildable biome. */
  allowedBiomes: Biome[];
  asset: AssetRef;
  levels: BuildingLevelSpec[];
}

export interface UnitDefinition {
  key: string;
  name: string;
  description: string;
  unitClass: UnitClass;
  hitpoints: number;
  damage: number;
  defense: number;
  /** Tiles per second. */
  speed: number;
  /** Attack range in tiles. 1 == melee. */
  range: number;
  attackCooldownMs: number;
  trainCost: CostBundle;
  trainSeconds: number;
  /** Housing space consumed. */
  population: number;
  /** Building key required to train, and at what level it unlocks. */
  trainedAt: string;
  unlockAtBuildingLevel: number;
  /** Damage multiplier vs. specific building categories. */
  preferredTargets?: Partial<Record<BuildingCategory, number>>;
  asset: AssetRef;
}

export interface EnvironmentDefinition {
  key: string;
  name: string;
  /** Terrain layer the renderer paints, or a scatter prop. */
  kind: 'terrain' | 'prop' | 'water' | 'road';
  biomes: Biome[];
  /** Units may not be placed / buildings may not be built here. */
  buildable: boolean;
  walkable: boolean;
  /** Scatter density per tile when generating decoration. */
  density?: number;
  asset: AssetRef;
}

export interface ResourceDefinition {
  key: ResourceKey;
  name: string;
  description: string;
  /** Hard currency lives on the Wallet; soft resources on the Empire. */
  kind: 'currency' | 'premium' | 'resource';
  /** Can be looted in a raid. */
  raidable: boolean;
  /** Percentage of the defender's stock an attacker can take, in basis points. */
  maxLootBps: number;
  baseStorage: number;
  color: string;
  icon: string;
}

export interface GameConfigDefaults {
  key: string;
  value: string | number | boolean;
  description: string;
  /** Admin panel grouping. */
  group: string;
}
