/**
 * Empire Power - the single number used for matchmaking, leaderboards and
 * loot scaling. Deliberately simple and fully derived from persisted state so
 * it can be recomputed server-side at any time and never trusted from a client.
 */

export interface PowerInputs {
  hqLevel: number;
  /** Sum of levels across all completed buildings. */
  buildingLevelSum: number;
  /** Number of completed buildings. */
  buildingCount: number;
  /** Sum of (unit.population * count) across the standing army. */
  armyPopulation: number;
  /** Sum of unit damage * count. */
  armyOffense: number;
  /** Sum of defensive-building DPS. */
  defenseRating: number;
  /** Plots owned. */
  plotCount: number;
  /** Completed technologies. */
  researchCount: number;
}

export const POWER_WEIGHTS = {
  hqLevel: 120,
  buildingLevelSum: 8,
  buildingCount: 4,
  armyPopulation: 3,
  armyOffense: 0.6,
  defenseRating: 1.4,
  plotCount: 90,
  researchCount: 45,
} as const;

export function calculateEmpirePower(i: PowerInputs): number {
  const raw =
    i.hqLevel * POWER_WEIGHTS.hqLevel +
    i.buildingLevelSum * POWER_WEIGHTS.buildingLevelSum +
    i.buildingCount * POWER_WEIGHTS.buildingCount +
    i.armyPopulation * POWER_WEIGHTS.armyPopulation +
    i.armyOffense * POWER_WEIGHTS.armyOffense +
    i.defenseRating * POWER_WEIGHTS.defenseRating +
    i.plotCount * POWER_WEIGHTS.plotCount +
    i.researchCount * POWER_WEIGHTS.researchCount;
  return Math.max(0, Math.round(raw));
}

/** XP required to advance from `level` to `level + 1`. */
export function xpForNextLevel(level: number, base = 500, growth = 1.35): number {
  return Math.round(base * Math.pow(growth, Math.max(0, level - 1)));
}

/** Total XP -> level, given the same curve. */
export function levelFromXp(
  totalXp: number,
  base = 500,
  growth = 1.35,
  maxLevel = 100,
): number {
  let level = 1;
  let remaining = totalXp;
  while (level < maxLevel) {
    const need = xpForNextLevel(level, base, growth);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }
  return level;
}
