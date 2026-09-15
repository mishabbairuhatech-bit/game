import type { GameConfigDefaults } from './types';

/**
 * Runtime-tunable game configuration. The seed writes these into the
 * GameConfig table; the admin panel edits the rows. Code reads through
 * ConfigService, never from this array directly - these are only defaults.
 */
export const GAME_CONFIG_DEFAULTS: GameConfigDefaults[] = [
  // --- economy ---------------------------------------------------------
  { key: 'economy.starterCoins', value: 5000, description: 'Coins granted to a new empire.', group: 'economy' },
  { key: 'economy.starterGems', value: 50, description: 'Gems granted to a new empire.', group: 'economy' },
  { key: 'economy.starterWood', value: 1500, description: 'Timber granted to a new empire.', group: 'economy' },
  { key: 'economy.starterStone', value: 1500, description: 'Stone granted to a new empire.', group: 'economy' },
  { key: 'economy.starterFood', value: 1500, description: 'Provisions granted to a new empire.', group: 'economy' },
  { key: 'economy.starterIron', value: 200, description: 'Iron granted to a new empire.', group: 'economy' },
  { key: 'economy.starterGold', value: 50, description: 'Gold ore granted to a new empire.', group: 'economy' },
  { key: 'economy.offlineProductionCapHours', value: 12, description: 'Max hours of production accrued while offline.', group: 'economy' },
  { key: 'economy.goldToCoinRate', value: 25, description: 'Coins minted per gold ore at the Treasury.', group: 'economy' },

  // --- world -------------------------------------------------------------
  { key: 'world.seed', value: 'EMPIRE-001', description: 'Seed for the active world. Changing it only affects newly generated worlds.', group: 'world' },
  { key: 'world.width', value: 1000, description: 'World width in logical tiles.', group: 'world' },
  { key: 'world.regionSize', value: 100, description: 'Region edge length in tiles.', group: 'world' },
  { key: 'world.zoneSize', value: 20, description: 'Zone edge length in tiles.', group: 'world' },
  { key: 'world.plotSize', value: 10, description: 'Plot edge length in tiles. This is the build grid.', group: 'world' },

  // --- starter allocation --------------------------------------------------
  { key: 'starter.minDistancePlots', value: 6, description: 'Minimum Chebyshev distance in plots between two starter holdings.', group: 'starter' },
  { key: 'starter.spawnMarginPlots', value: 5, description: 'Plots of world edge kept clear of starter holdings.', group: 'starter' },
  { key: 'starter.maxSearchCandidates', value: 400, description: 'Candidate plots examined before relaxing the distance rule.', group: 'starter' },
  { key: 'starter.protectionHours', value: 72, description: 'Hours a new player\'s starter holding is protected from attack.', group: 'starter' },

  // --- land ------------------------------------------------------------
  { key: 'land.basePlotPrice', value: 2500, description: 'Base coin price of a 16x16 plot before biome multipliers.', group: 'land' },
  { key: 'land.maxPlotsPerPlayer', value: 12, description: 'Hard cap on plots a single account may hold.', group: 'land' },
  { key: 'land.requireAdjacency', value: true, description: 'New purchases must touch land you already own.', group: 'land' },
  { key: 'land.purchaseCooldownSeconds', value: 300, description: 'Cooldown between land purchases.', group: 'land' },
  // Deliberately 1: headquarters upgrades arrive in a later phase, and a gate
  // that cannot be cleared would make land expansion dead code. Raise it from
  // the admin panel once upgrades exist.
  { key: 'land.minHqLevelToExpand', value: 1, description: 'Headquarters level required before claiming additional plots.', group: 'land' },

  // --- marketplace ------------------------------------------------------
  { key: 'market.feeBps', value: 500, description: 'Marketplace fee in basis points (500 = 5%).', group: 'marketplace' },
  { key: 'market.minListingPrice', value: 100, description: 'Minimum coin price for a listing.', group: 'marketplace' },
  { key: 'market.maxListingPrice', value: 100000000, description: 'Maximum coin price for a listing.', group: 'marketplace' },
  { key: 'market.listingDurationHours', value: 168, description: 'How long a listing stays active.', group: 'marketplace' },
  { key: 'market.maxActiveListingsPerPlayer', value: 10, description: 'Concurrent active listings per account.', group: 'marketplace' },

  // --- combat ------------------------------------------------------------
  { key: 'battle.durationSeconds', value: 180, description: 'Length of a raid.', group: 'combat' },
  { key: 'battle.preparationSeconds', value: 20, description: 'Scouting window before troops may deploy.', group: 'combat' },
  { key: 'battle.tickRateHz', value: 10, description: 'Server simulation ticks per second.', group: 'combat' },
  { key: 'battle.shieldHoursOnDefeat', value: 8, description: 'Protection granted to a defender who loses badly.', group: 'combat' },
  { key: 'battle.shieldDestructionThreshold', value: 60, description: 'Destruction percent that triggers a defender shield.', group: 'combat' },
  { key: 'battle.matchmakingPowerRangeBps', value: 3000, description: 'Allowed power delta when matchmaking (+/- 30%).', group: 'combat' },
  { key: 'battle.attackCooldownSeconds', value: 60, description: 'Cooldown between raids launched by one player.', group: 'combat' },

  // --- anti-cheat --------------------------------------------------------
  { key: 'anticheat.maxActionsPerMinute', value: 240, description: 'Authenticated mutating actions per minute per account.', group: 'anticheat' },
  { key: 'anticheat.resourceGainToleranceBps', value: 500, description: 'Allowed drift between predicted and claimed resource gain.', group: 'anticheat' },
  { key: 'anticheat.autoFlagThreshold', value: 5, description: 'Suspicious events before an account is auto-flagged for review.', group: 'anticheat' },

  // --- progression --------------------------------------------------------
  { key: 'progression.xpPerLevelBase', value: 500, description: 'XP required for level 2.', group: 'progression' },
  { key: 'progression.xpLevelGrowth', value: 1.35, description: 'XP curve growth factor per level.', group: 'progression' },
  { key: 'progression.maxLevel', value: 100, description: 'Maximum account level.', group: 'progression' },

  // --- chat ----------------------------------------------------------------
  { key: 'chat.messagesPerMinute', value: 12, description: 'Chat messages allowed per minute.', group: 'chat' },
  { key: 'chat.maxMessageLength', value: 300, description: 'Maximum characters in a chat message.', group: 'chat' },
];

export const GAME_CONFIG_DEFAULT_MAP = new Map(
  GAME_CONFIG_DEFAULTS.map((c) => [c.key, c.value]),
);
