/**
 * Enum values mirrored from prisma/schema.prisma so the frontend can use them
 * without importing @prisma/client. Keep both sides in sync.
 */

export const UserRole = {
  PLAYER: 'PLAYER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Ascending privilege. Guards compare with >=. */
export const ROLE_RANK: Record<UserRole, number> = {
  PLAYER: 0,
  MODERATOR: 10,
  ADMIN: 20,
  SUPER_ADMIN: 30,
};

export function roleAtLeast(actual: UserRole, required: UserRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const UserStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  DELETED: 'DELETED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ALL_PLOT_STATUSES = [
  'FREE',
  'STARTER',
  'OWNED',
  'FOR_SALE',
  'LOCKED',
  'PROTECTED',
  'EVENT',
  'UNAVAILABLE',
] as const;

export const PlotStatus = {
  FREE: 'FREE',
  STARTER: 'STARTER',
  OWNED: 'OWNED',
  FOR_SALE: 'FOR_SALE',
  LOCKED: 'LOCKED',
  PROTECTED: 'PROTECTED',
  EVENT: 'EVENT',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type PlotStatus = (typeof PlotStatus)[keyof typeof PlotStatus];

export const Biome = {
  GRASSLAND: 'GRASSLAND',
  FOREST: 'FOREST',
  MOUNTAIN: 'MOUNTAIN',
  WATER: 'WATER',
  DESERT: 'DESERT',
  SWAMP: 'SWAMP',
  ROCKY: 'ROCKY',
  RIVERLAND: 'RIVERLAND',
  LAKESHORE: 'LAKESHORE',
  HIGHLAND: 'HIGHLAND',
  BADLANDS: 'BADLANDS',
  TUNDRA: 'TUNDRA',
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const ALL_BIOMES: Biome[] = Object.values(Biome);

export const WorldStatus = {
  GENERATING: 'GENERATING',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type WorldStatus = (typeof WorldStatus)[keyof typeof WorldStatus];

export const ResourceKey = {
  COINS: 'COINS',
  GEMS: 'GEMS',
  WOOD: 'WOOD',
  STONE: 'STONE',
  FOOD: 'FOOD',
  IRON: 'IRON',
  GOLD: 'GOLD',
} as const;
export type ResourceKey = (typeof ResourceKey)[keyof typeof ResourceKey];

/** Currencies tracked on the Wallet (hard currencies). */
export const WALLET_CURRENCIES: ResourceKey[] = [ResourceKey.COINS, ResourceKey.GEMS];
/** Produced/stored resources tracked per-empire. */
export const PRODUCED_RESOURCES: ResourceKey[] = [
  ResourceKey.WOOD,
  ResourceKey.STONE,
  ResourceKey.FOOD,
  ResourceKey.IRON,
  ResourceKey.GOLD,
];

export const BuildingCategory = {
  CORE: 'CORE',
  PRODUCTION: 'PRODUCTION',
  STORAGE: 'STORAGE',
  MILITARY: 'MILITARY',
  DEFENSE: 'DEFENSE',
  WALL: 'WALL',
  UTILITY: 'UTILITY',
  DECORATION: 'DECORATION',
} as const;
export type BuildingCategory = (typeof BuildingCategory)[keyof typeof BuildingCategory];

export const UnitClass = {
  INFANTRY: 'INFANTRY',
  RANGED: 'RANGED',
  CAVALRY: 'CAVALRY',
  SIEGE: 'SIEGE',
  CASTER: 'CASTER',
} as const;
export type UnitClass = (typeof UnitClass)[keyof typeof UnitClass];

export const BattleStatus = {
  MATCHING: 'MATCHING',
  PREPARING: 'PREPARING',
  ACTIVE: 'ACTIVE',
  RESOLVING: 'RESOLVING',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
  ERRORED: 'ERRORED',
} as const;
export type BattleStatus = (typeof BattleStatus)[keyof typeof BattleStatus];

export const ListingStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  SOLD: 'SOLD',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const NotificationType = {
  BUILDING_COMPLETED: 'BUILDING_COMPLETED',
  UPGRADE_COMPLETED: 'UPGRADE_COMPLETED',
  TRAINING_COMPLETED: 'TRAINING_COMPLETED',
  ATTACK_RECEIVED: 'ATTACK_RECEIVED',
  BATTLE_COMPLETED: 'BATTLE_COMPLETED',
  PLOT_SOLD: 'PLOT_SOLD',
  PLOT_PURCHASED: 'PLOT_PURCHASED',
  QUEST_COMPLETED: 'QUEST_COMPLETED',
  ACHIEVEMENT_UNLOCKED: 'ACHIEVEMENT_UNLOCKED',
  ALLIANCE_INVITATION: 'ALLIANCE_INVITATION',
  PAYMENT_CREDITED: 'PAYMENT_CREDITED',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
