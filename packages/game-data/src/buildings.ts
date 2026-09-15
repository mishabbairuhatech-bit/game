import { Biome, BuildingCategory, ResourceKey, UnitClass } from '@empire/shared';
import type { BuildingDefinition, BuildingLevelSpec, CostBundle } from './types';

/* ---------------------------------------------------------------------------
 * Level curves
 * ---------------------------------------------------------------------------
 * Levels are generated from a base value and a growth factor rather than hand
 * written, so balance changes are a one-line edit. The generated table is what
 * gets written into the BuildingLevel table by the Prisma seed, and the admin
 * panel edits those rows - the curve is only the starting point.
 */

const round = (n: number) => Math.max(1, Math.round(n));

function scaleCost(base: CostBundle, level: number, growth: number): CostBundle {
  const out: CostBundle = {};
  for (const [k, v] of Object.entries(base) as [ResourceKey, number][]) {
    out[k] = round(v * Math.pow(growth, level - 1));
  }
  return out;
}

interface CurveOptions {
  maxLevel: number;
  baseCost: CostBundle;
  costGrowth?: number;
  baseSeconds: number;
  timeGrowth?: number;
  baseHp: number;
  hpGrowth?: number;
  baseProduction?: Partial<Record<ResourceKey, number>>;
  productionGrowth?: number;
  baseStorage?: Partial<Record<ResourceKey, number>>;
  storageGrowth?: number;
  baseDefense?: BuildingLevelSpec['defense'];
  defenseGrowth?: number;
  baseCapacity?: BuildingLevelSpec['capacity'];
  capacityGrowth?: number;
  /** HQ level needed for building level N. Defaults to N. */
  hqRequirement?: (level: number) => number;
  /** How many copies are allowed once the HQ reaches level N. */
  countAtHq?: (level: number) => number;
}

function buildLevels(o: CurveOptions): BuildingLevelSpec[] {
  const {
    maxLevel,
    costGrowth = 1.62,
    timeGrowth = 1.75,
    hpGrowth = 1.28,
    productionGrowth = 1.3,
    storageGrowth = 1.45,
    defenseGrowth = 1.24,
    capacityGrowth = 1.25,
  } = o;

  const levels: BuildingLevelSpec[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    const i = level - 1;
    const spec: BuildingLevelSpec = {
      level,
      buildCost: scaleCost(o.baseCost, level, costGrowth),
      buildSeconds: round(o.baseSeconds * Math.pow(timeGrowth, i)),
      hitpoints: round(o.baseHp * Math.pow(hpGrowth, i)),
      requiredHqLevel: o.hqRequirement ? o.hqRequirement(level) : level,
    };

    if (o.baseProduction) {
      spec.production = {};
      for (const [k, v] of Object.entries(o.baseProduction) as [ResourceKey, number][]) {
        spec.production[k] = round(v * Math.pow(productionGrowth, i));
      }
    }
    if (o.baseStorage) {
      spec.storage = {};
      for (const [k, v] of Object.entries(o.baseStorage) as [ResourceKey, number][]) {
        spec.storage[k] = round(v * Math.pow(storageGrowth, i));
      }
    }
    if (o.baseDefense) {
      spec.defense = {
        ...o.baseDefense,
        damagePerSecond: round(o.baseDefense.damagePerSecond * Math.pow(defenseGrowth, i)),
        // Range creeps up slowly so towers stay readable on the board.
        range: Math.round((o.baseDefense.range + i * 0.15) * 100) / 100,
      };
    }
    if (o.baseCapacity) {
      spec.capacity = {};
      for (const [k, v] of Object.entries(o.baseCapacity) as [string, number][]) {
        (spec.capacity as Record<string, number>)[k] = round(v * Math.pow(capacityGrowth, i));
      }
    }
    if (o.countAtHq) spec.maxCountAtHq = o.countAtHq(level);

    levels.push(spec);
  }
  return levels;
}

const ANY_BIOME: Biome[] = [];

/* ------------------------------------------------------------------------ */
/* Building catalogue                                                        */
/* ------------------------------------------------------------------------ */

export const BUILDINGS: BuildingDefinition[] = [
  // ---------------------------------------------------------------- CORE --
  {
    key: 'headquarters',
    name: 'Headquarters',
    description: 'The seat of your empire. Its level gates every other structure.',
    category: BuildingCategory.CORE,
    footprint: { width: 4, height: 4 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'tower', color: '#c8a165', accent: '#7c3f1d', scale: [4, 5, 4] },
      icon: 'hq',
      lod: { high: 40, medium: 90, low: 200 },
    },
    levels: buildLevels({
      maxLevel: 15,
      baseCost: { [ResourceKey.WOOD]: 0, [ResourceKey.STONE]: 0 },
      baseSeconds: 5,
      baseHp: 1600,
      hqRequirement: (l) => l,
      baseStorage: { [ResourceKey.WOOD]: 1500, [ResourceKey.STONE]: 1500, [ResourceKey.FOOD]: 1500 },
      baseCapacity: { builders: 1 },
      countAtHq: () => 1,
    }).map((lvl, i) =>
      // Level 1 HQ is free (granted at signup); later levels cost stone + timber.
      i === 0
        ? { ...lvl, buildCost: {}, buildSeconds: 0 }
        : {
            ...lvl,
            buildCost: scaleCost(
              { [ResourceKey.WOOD]: 900, [ResourceKey.STONE]: 900, [ResourceKey.COINS]: 400 },
              i,
              1.7,
            ),
            buildSeconds: round(120 * Math.pow(1.85, i - 1)),
          },
    ),
  },
  {
    key: 'builder_hut',
    name: "Builder's Lodge",
    description: 'Each lodge houses one builder, letting you run one more job at a time.',
    category: BuildingCategory.UTILITY,
    footprint: { width: 2, height: 2 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#a9744f', accent: '#5b3a21', scale: [2, 2, 2] },
      icon: 'hammer',
    },
    levels: buildLevels({
      maxLevel: 5,
      baseCost: { [ResourceKey.COINS]: 500 },
      costGrowth: 4,
      baseSeconds: 30,
      baseHp: 500,
      baseCapacity: { builders: 1 },
      capacityGrowth: 1,
      hqRequirement: (l) => Math.min(15, 1 + (l - 1) * 3),
      countAtHq: (l) => l,
    }),
  },

  // ---------------------------------------------------------- PRODUCTION --
  {
    key: 'farm',
    name: 'Terrace Farm',
    description: 'Grows provisions used to train and sustain your army.',
    category: BuildingCategory.PRODUCTION,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.GRASSLAND, Biome.RIVERLAND, Biome.LAKESHORE],
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#8fae4e', accent: '#5d7a2c', scale: [3, 0.8, 3] },
      icon: 'grain',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.WOOD]: 120 },
      baseSeconds: 45,
      baseHp: 420,
      baseProduction: { [ResourceKey.FOOD]: 180 },
      baseStorage: { [ResourceKey.FOOD]: 400 },
      countAtHq: (l) => Math.min(6, 1 + Math.floor(l / 2)),
    }),
  },
  {
    key: 'lumber_mill',
    name: 'Lumber Mill',
    description: 'Fells and mills timber from the surrounding woodland.',
    category: BuildingCategory.PRODUCTION,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.FOREST, Biome.GRASSLAND, Biome.HIGHLAND],
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#7b5230', accent: '#3f2a18', scale: [3, 2, 3] },
      icon: 'timber',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.STONE]: 120 },
      baseSeconds: 45,
      baseHp: 420,
      baseProduction: { [ResourceKey.WOOD]: 180 },
      baseStorage: { [ResourceKey.WOOD]: 400 },
      countAtHq: (l) => Math.min(6, 1 + Math.floor(l / 2)),
    }),
  },
  {
    key: 'stone_quarry',
    name: 'Stone Quarry',
    description: 'Cuts blocks from the bedrock for walls and heavy construction.',
    category: BuildingCategory.PRODUCTION,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.MOUNTAIN, Biome.HIGHLAND, Biome.BADLANDS, Biome.GRASSLAND],
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#8d8d8d', accent: '#5a5a5a', scale: [3, 1.6, 3] },
      icon: 'stone',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.WOOD]: 150 },
      baseSeconds: 55,
      baseHp: 480,
      baseProduction: { [ResourceKey.STONE]: 160 },
      baseStorage: { [ResourceKey.STONE]: 400 },
      countAtHq: (l) => Math.min(5, 1 + Math.floor(l / 3)),
    }),
  },
  {
    key: 'iron_mine',
    name: 'Iron Mine',
    description: 'Digs ore for advanced military structures and siege engines.',
    category: BuildingCategory.PRODUCTION,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.MOUNTAIN, Biome.HIGHLAND, Biome.BADLANDS],
    asset: {
      model: null,
      placeholder: { shape: 'cone', color: '#6b7280', accent: '#374151', scale: [3, 2.4, 3] },
      icon: 'ingot',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.WOOD]: 400, [ResourceKey.STONE]: 400 },
      baseSeconds: 180,
      baseHp: 520,
      baseProduction: { [ResourceKey.IRON]: 60 },
      baseStorage: { [ResourceKey.IRON]: 250 },
      hqRequirement: (l) => Math.min(15, 3 + l),
      countAtHq: (l) => Math.min(4, 1 + Math.floor(l / 3)),
    }),
  },
  {
    key: 'gold_mine',
    name: 'Gold Mine',
    description: 'Extracts gold ore, refined into coins at the Treasury.',
    category: BuildingCategory.PRODUCTION,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.MOUNTAIN, Biome.BADLANDS, Biome.HIGHLAND],
    asset: {
      model: null,
      placeholder: { shape: 'cone', color: '#b8912f', accent: '#6b5416', scale: [3, 2.4, 3] },
      icon: 'nugget',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.WOOD]: 600, [ResourceKey.STONE]: 600 },
      baseSeconds: 300,
      baseHp: 560,
      baseProduction: { [ResourceKey.GOLD]: 30 },
      baseStorage: { [ResourceKey.GOLD]: 150 },
      hqRequirement: (l) => Math.min(15, 5 + l),
      countAtHq: (l) => Math.min(3, 1 + Math.floor(l / 4)),
    }),
  },

  // ------------------------------------------------------------- STORAGE --
  {
    key: 'warehouse',
    name: 'Warehouse',
    description: 'Raises the ceiling on every stockpiled resource.',
    category: BuildingCategory.STORAGE,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#a06a3c', accent: '#5c3b1e', scale: [3, 2.2, 3] },
      icon: 'crate',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.WOOD]: 200, [ResourceKey.STONE]: 200 },
      baseSeconds: 60,
      baseHp: 700,
      baseStorage: {
        [ResourceKey.WOOD]: 1200,
        [ResourceKey.STONE]: 1200,
        [ResourceKey.FOOD]: 1200,
        [ResourceKey.IRON]: 400,
        [ResourceKey.GOLD]: 200,
      },
      countAtHq: (l) => Math.min(4, 1 + Math.floor(l / 4)),
    }),
  },
  {
    key: 'treasury',
    name: 'Treasury',
    description: 'Refines gold ore into coins and shields part of your coin stock from raids.',
    category: BuildingCategory.STORAGE,
    footprint: { width: 3, height: 3 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#d8b45a', accent: '#7a621f', scale: [3, 2.6, 3] },
      icon: 'vault',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.STONE]: 900, [ResourceKey.GOLD]: 60 },
      baseSeconds: 420,
      baseHp: 900,
      baseProduction: { [ResourceKey.COINS]: 120 },
      hqRequirement: (l) => Math.min(15, 4 + l),
      countAtHq: () => 1,
    }),
  },

  // ------------------------------------------------------------ MILITARY --
  {
    key: 'barracks',
    name: 'Barracks',
    description: 'Drills infantry. More levels unlock heavier foot soldiers.',
    category: BuildingCategory.MILITARY,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#7f6a4d', accent: '#4a3b28', scale: [3, 2.2, 3] },
      icon: 'sword',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.WOOD]: 300, [ResourceKey.STONE]: 150 },
      baseSeconds: 90,
      baseHp: 620,
      baseCapacity: { populationCapacity: 20, trainingSlots: 1 },
      hqRequirement: (l) => Math.min(15, 1 + l),
      countAtHq: (l) => Math.min(3, 1 + Math.floor(l / 5)),
    }),
  },
  {
    key: 'archery_range',
    name: 'Archery Range',
    description: 'Trains ranged units that outreach walls and towers.',
    category: BuildingCategory.MILITARY,
    footprint: { width: 3, height: 4 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#6f7f4d', accent: '#3d4a26', scale: [3, 1.8, 4] },
      icon: 'bow',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.WOOD]: 600, [ResourceKey.IRON]: 40 },
      baseSeconds: 200,
      baseHp: 580,
      baseCapacity: { populationCapacity: 16, trainingSlots: 1 },
      hqRequirement: (l) => Math.min(15, 3 + l),
      countAtHq: (l) => Math.min(2, 1 + Math.floor(l / 6)),
    }),
  },
  {
    key: 'stable',
    name: 'Stable',
    description: 'Raises cavalry - fast flankers that punish exposed production.',
    category: BuildingCategory.MILITARY,
    footprint: { width: 4, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: [Biome.GRASSLAND, Biome.HIGHLAND, Biome.RIVERLAND],
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#8a6b4a', accent: '#4c3928', scale: [4, 2, 3] },
      icon: 'horseshoe',
    },
    levels: buildLevels({
      maxLevel: 8,
      baseCost: { [ResourceKey.WOOD]: 1200, [ResourceKey.FOOD]: 800 },
      baseSeconds: 600,
      baseHp: 640,
      baseCapacity: { populationCapacity: 18, trainingSlots: 1 },
      hqRequirement: (l) => Math.min(15, 5 + l),
      countAtHq: () => 1,
    }),
  },
  {
    key: 'siege_workshop',
    name: 'Siege Workshop',
    description: 'Assembles rams and trebuchets that break fortifications.',
    category: BuildingCategory.MILITARY,
    footprint: { width: 4, height: 4 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#5f5346', accent: '#332c24', scale: [4, 2.6, 4] },
      icon: 'gear',
    },
    levels: buildLevels({
      maxLevel: 6,
      baseCost: { [ResourceKey.WOOD]: 2400, [ResourceKey.IRON]: 400 },
      baseSeconds: 1200,
      baseHp: 780,
      baseCapacity: { populationCapacity: 24, trainingSlots: 1 },
      hqRequirement: (l) => Math.min(15, 7 + l),
      countAtHq: () => 1,
    }),
  },
  {
    key: 'research_center',
    name: 'Research Center',
    description: 'Unlocks technologies that permanently improve your empire.',
    category: BuildingCategory.UTILITY,
    footprint: { width: 3, height: 3 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'cylinder', color: '#6a7fa0', accent: '#33415a', scale: [3, 3, 3] },
      icon: 'scroll',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.STONE]: 800, [ResourceKey.GOLD]: 40 },
      baseSeconds: 480,
      baseHp: 700,
      baseCapacity: { researchSlots: 1 },
      capacityGrowth: 1.15,
      hqRequirement: (l) => Math.min(15, 4 + l),
      countAtHq: () => 1,
    }),
  },
  {
    key: 'market',
    name: 'Market',
    description: 'Required to list land and goods. Higher levels cut the marketplace fee.',
    category: BuildingCategory.UTILITY,
    footprint: { width: 3, height: 3 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'box', color: '#b07a4f', accent: '#5f3f26', scale: [3, 2, 3] },
      icon: 'scales',
    },
    levels: buildLevels({
      maxLevel: 8,
      baseCost: { [ResourceKey.WOOD]: 700, [ResourceKey.COINS]: 1500 },
      baseSeconds: 300,
      baseHp: 660,
      hqRequirement: (l) => Math.min(15, 2 + l),
      countAtHq: () => 1,
    }),
  },
  {
    key: 'alliance_hall',
    name: 'Alliance Hall',
    description: 'Lets you found or join an alliance and receive reinforcements.',
    category: BuildingCategory.UTILITY,
    footprint: { width: 3, height: 3 },
    unique: true,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'tower', color: '#7a6ea8', accent: '#3d3560', scale: [3, 3.4, 3] },
      icon: 'banner',
    },
    levels: buildLevels({
      maxLevel: 8,
      baseCost: { [ResourceKey.STONE]: 1000, [ResourceKey.COINS]: 2500 },
      baseSeconds: 600,
      baseHp: 820,
      baseCapacity: { populationCapacity: 10 },
      hqRequirement: (l) => Math.min(15, 3 + l),
      countAtHq: () => 1,
    }),
  },

  // ------------------------------------------------------------- DEFENSE --
  {
    key: 'archer_tower',
    name: 'Archer Tower',
    description: 'Fast single-target tower. Reliable against light infantry.',
    category: BuildingCategory.DEFENSE,
    footprint: { width: 2, height: 2 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'tower', color: '#8b9dab', accent: '#3f4c57', scale: [2, 4, 2] },
      icon: 'tower-bow',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.WOOD]: 250, [ResourceKey.STONE]: 250 },
      baseSeconds: 90,
      baseHp: 460,
      baseDefense: {
        damagePerSecond: 22,
        range: 8,
        targets: [UnitClass.INFANTRY, UnitClass.RANGED, UnitClass.CAVALRY, UnitClass.SIEGE, UnitClass.CASTER],
        attackCooldownMs: 700,
      },
      hqRequirement: (l) => Math.min(15, 1 + l),
      countAtHq: (l) => Math.min(8, 1 + Math.floor(l / 2)),
    }),
  },
  {
    key: 'cannon',
    name: 'Bombard',
    description: 'Heavy ground-only gun. Slow but devastating to melee pushes.',
    category: BuildingCategory.DEFENSE,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'cylinder', color: '#4b5563', accent: '#1f2937', scale: [3, 1.8, 3] },
      icon: 'cannon',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.STONE]: 400, [ResourceKey.IRON]: 60 },
      baseSeconds: 150,
      baseHp: 620,
      baseDefense: {
        damagePerSecond: 46,
        range: 7,
        targets: [UnitClass.INFANTRY, UnitClass.CAVALRY, UnitClass.SIEGE],
        attackCooldownMs: 1400,
      },
      hqRequirement: (l) => Math.min(15, 2 + l),
      countAtHq: (l) => Math.min(6, 1 + Math.floor(l / 3)),
    }),
  },
  {
    key: 'mortar',
    name: 'Trebuchet Emplacement',
    description: 'Lobs splash shots at clustered units. Blind at close range.',
    category: BuildingCategory.DEFENSE,
    footprint: { width: 3, height: 3 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'pyramid', color: '#6b6152', accent: '#33301f', scale: [3, 2.6, 3] },
      icon: 'mortar',
    },
    levels: buildLevels({
      maxLevel: 10,
      baseCost: { [ResourceKey.STONE]: 900, [ResourceKey.IRON]: 150 },
      baseSeconds: 400,
      baseHp: 540,
      baseDefense: {
        damagePerSecond: 34,
        range: 12,
        targets: [UnitClass.INFANTRY, UnitClass.RANGED, UnitClass.CAVALRY, UnitClass.CASTER],
        splashRadius: 2.2,
        attackCooldownMs: 4500,
      },
      hqRequirement: (l) => Math.min(15, 5 + l),
      countAtHq: (l) => Math.min(4, 1 + Math.floor(l / 4)),
    }),
  },
  {
    key: 'watch_tower',
    name: 'Watch Tower',
    description: 'Sees far and reveals attackers early, giving nearby towers a damage bonus.',
    category: BuildingCategory.DEFENSE,
    footprint: { width: 2, height: 2 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'tower', color: '#9a8f78', accent: '#4c4536', scale: [2, 5, 2] },
      icon: 'eye',
    },
    levels: buildLevels({
      maxLevel: 8,
      baseCost: { [ResourceKey.WOOD]: 350 },
      baseSeconds: 120,
      baseHp: 380,
      baseDefense: {
        damagePerSecond: 10,
        range: 14,
        targets: [UnitClass.INFANTRY, UnitClass.RANGED, UnitClass.CAVALRY, UnitClass.SIEGE, UnitClass.CASTER],
        attackCooldownMs: 1200,
      },
      hqRequirement: (l) => Math.min(15, 2 + l),
      countAtHq: (l) => Math.min(4, 1 + Math.floor(l / 3)),
    }),
  },

  // ---------------------------------------------------------------- WALL --
  {
    key: 'wall',
    name: 'Rampart',
    description: 'Cheap segment that stalls melee units inside your kill zones.',
    category: BuildingCategory.WALL,
    footprint: { width: 1, height: 1 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'wall', color: '#a8a29e', accent: '#57534e', scale: [1, 1.6, 1] },
      icon: 'wall',
      lod: { high: 30, medium: 70, low: 140 },
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.STONE]: 50 },
      costGrowth: 1.9,
      baseSeconds: 1,
      timeGrowth: 1,
      baseHp: 320,
      hpGrowth: 1.34,
      hqRequirement: (l) => Math.min(15, l),
      countAtHq: (l) => 25 * l,
    }),
  },
  {
    key: 'gate',
    name: 'Gatehouse',
    description: 'A reinforced opening. Your own reinforcements can pass; enemies cannot.',
    category: BuildingCategory.WALL,
    footprint: { width: 2, height: 1 },
    unique: false,
    blocksMovement: true,
    allowedBiomes: ANY_BIOME,
    asset: {
      model: null,
      placeholder: { shape: 'wall', color: '#7d6b53', accent: '#3b3125', scale: [2, 2, 1] },
      icon: 'gate',
    },
    levels: buildLevels({
      maxLevel: 12,
      baseCost: { [ResourceKey.STONE]: 120, [ResourceKey.WOOD]: 80 },
      costGrowth: 1.9,
      baseSeconds: 10,
      timeGrowth: 1.2,
      baseHp: 480,
      hpGrowth: 1.34,
      hqRequirement: (l) => Math.min(15, l),
      countAtHq: (l) => Math.min(8, 2 + Math.floor(l / 2)),
    }),
  },
];

export const BUILDING_BY_KEY = new Map(BUILDINGS.map((b) => [b.key, b]));

export function buildingLevel(key: string, level: number): BuildingLevelSpec | undefined {
  return BUILDING_BY_KEY.get(key)?.levels.find((l) => l.level === level);
}

/** Buildings a brand-new empire receives for free on its starter plot. */
export const STARTER_BUILDINGS: { key: string; level: number }[] = [
  { key: 'headquarters', level: 1 },
  { key: 'builder_hut', level: 1 },
  { key: 'farm', level: 1 },
  { key: 'lumber_mill', level: 1 },
  { key: 'stone_quarry', level: 1 },
  { key: 'warehouse', level: 1 },
  { key: 'barracks', level: 1 },
  { key: 'archer_tower', level: 1 },
];
