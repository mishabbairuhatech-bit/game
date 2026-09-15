import { Injectable } from '@nestjs/common';
import { xpForNextLevel } from '@empire/game-engine';
import { ErrorCode } from '@empire/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app.exception';
import { PlayerBootstrapService } from './player-bootstrap.service';

export interface EmpireSummary {
  id: string;
  name: string;
  hqLevel: number;
  builders: number;
  empirePower: number;
  population: { used: number; cap: number };
  resources: Record<string, { amount: number; capacity: number }>;
  wallet: { coins: string; gems: string };
  plotCount: number;
  buildingCount: number;
  lastAccrualAt: string;
}

export interface PlayerProfileView {
  userId: string;
  username: string;
  displayName: string;
  empireName: string | null;
  avatarUrl: string | null;
  level: number;
  xp: number;
  xpToNextLevel: number;
  empirePower: number;
  battlesWon: number;
  battlesLost: number;
  raidsDefended: number;
  plotCount: number;
  buildingCount: number;
  achievementsUnlocked: number;
  allianceTag: string | null;
  memberSince: string;
}

@Injectable()
export class PlayersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bootstrap: PlayerBootstrapService,
  ) {}

  /**
   * The signed-in player's own empire.
   *
   * Also performs the lazy starter-territory claim: an account created before
   * the world was generated gets its plot the first time it reads its empire,
   * rather than needing a backfill migration.
   */
  async getMyEmpire(userId: string): Promise<EmpireSummary> {
    const existing = await this.prisma.empire.findUnique({ where: { userId } });
    if (!existing) throw AppException.notFound(ErrorCode.NOT_FOUND, 'This account has no empire.');

    const ownsLand = await this.prisma.plot.count({ where: { empireId: existing.id } });

    // Claiming territory mutates the empire row (capacities change once the
    // starter buildings land), so re-read afterwards rather than reusing the
    // pre-claim snapshot. Binding the result to a new const instead of
    // reassigning avoids writing back a value read before the await.
    const empire =
      ownsLand > 0
        ? existing
        : await this.claimStarterTerritory(userId, existing.id);

    const [wallet, plotCount, buildingCount] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId }, select: { coins: true, gems: true } }),
      this.prisma.plot.count({ where: { empireId: empire.id } }),
      this.prisma.building.count({ where: { empireId: empire.id } }),
    ]);

    return {
      id: empire.id,
      name: empire.name,
      hqLevel: empire.hqLevel,
      builders: empire.builders,
      empirePower: empire.empirePower,
      population: { used: empire.populationUsed, cap: empire.populationCap },
      resources: {
        WOOD: { amount: empire.wood, capacity: empire.woodCapacity },
        STONE: { amount: empire.stone, capacity: empire.stoneCapacity },
        FOOD: { amount: empire.food, capacity: empire.foodCapacity },
        IRON: { amount: empire.iron, capacity: empire.ironCapacity },
        GOLD: { amount: empire.gold, capacity: empire.goldCapacity },
      },
      wallet: {
        coins: (wallet?.coins ?? 0n).toString(),
        gems: (wallet?.gems ?? 0n).toString(),
      },
      plotCount,
      buildingCount,
      lastAccrualAt: empire.lastAccrualAt.toISOString(),
    };
  }

  /**
   * Runs the starter-territory claim and returns the refreshed empire.
   *
   * A failure here is not fatal: no world has been generated yet, or another
   * request won the race for the same plot. Either way the player still gets
   * their empire, and the claim is retried on the next read.
   */
  private async claimStarterTerritory(userId: string, empireId: string) {
    await this.prisma
      .$transaction((tx) => this.bootstrap.assignStarterTerritory(tx, userId, empireId), {
        timeout: 20_000,
      })
      .catch(() => null);

    return this.prisma.empire.findUniqueOrThrow({ where: { userId } });
  }

  /** Public profile. Safe to show to any authenticated player. */
  async getProfile(usernameOrId: string): Promise<PlayerProfileView> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      usernameOrId,
    );

    const user = await this.prisma.user.findFirst({
      where: {
        ...(isUuid ? { id: usernameOrId } : { username: usernameOrId }),
        deletedAt: null,
      },
      include: {
        profile: true,
        empire: { select: { id: true } },
        allianceMembership: { include: { alliance: { select: { tag: true } } } },
      },
    });

    if (!user || !user.profile) {
      throw AppException.notFound(ErrorCode.NOT_FOUND, 'No such commander.');
    }

    const [plotCount, buildingCount, achievements] = await Promise.all([
      this.prisma.plot.count({ where: { ownerId: user.id } }),
      user.empire
        ? this.prisma.building.count({ where: { empireId: user.empire.id } })
        : Promise.resolve(0),
      this.prisma.playerAchievement.count({
        where: { userId: user.id, unlockedAt: { not: null } },
      }),
    ]);

    return {
      userId: user.id,
      username: user.username,
      displayName: user.profile.displayName,
      empireName: user.profile.empireName,
      avatarUrl: user.avatarUrl,
      level: user.profile.level,
      xp: user.profile.xp,
      xpToNextLevel: xpForNextLevel(user.profile.level),
      empirePower: user.profile.empirePower,
      battlesWon: user.profile.battlesWon,
      battlesLost: user.profile.battlesLost,
      raidsDefended: user.profile.raidsDefended,
      plotCount,
      buildingCount,
      achievementsUnlocked: achievements,
      allianceTag: user.allianceMembership?.alliance.tag ?? null,
      memberSince: user.createdAt.toISOString(),
    };
  }
}
