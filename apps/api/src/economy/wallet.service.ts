import { Injectable, Logger } from '@nestjs/common';
import {
  CurrencyKey,
  LedgerReason,
  Prisma,
  SuspicionKind,
} from '@prisma/client';
import { ErrorCode } from '@empire/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';

export interface WalletBalances {
  coins: string;
  gems: string;
}

export interface CreditInput {
  userId: string;
  currency: 'COINS' | 'GEMS';
  /** Must be > 0. */
  amount: bigint;
  reason: LedgerReason;
  metadata?: Record<string, unknown>;
  /** Set for anything that must never apply twice (payments, purchases). */
  idempotencyKey?: string;
}

export interface DebitInput extends CreditInput {
  /**
   * Error code raised when the balance is short. Lets a caller surface
   * PLOT-specific copy while still going through the same guard.
   */
  insufficientCode?: string;
}

/**
 * The only component allowed to move coins or gems.
 *
 * Invariants enforced here, not by callers:
 *   1. A balance can never go negative. The UPDATE carries the guard, so two
 *      concurrent spends cannot both pass a read-then-write check.
 *   2. Every movement appends exactly one CurrencyTransaction row, in the same
 *      transaction as the balance change.
 *   3. An idempotencyKey that has already been used is a no-op, not a second
 *      credit. This is what makes replayed payment webhooks safe.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ---- reads ------------------------------------------------------------ */

  async getBalances(userId: string): Promise<WalletBalances> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw AppException.notFound(ErrorCode.WALLET_NOT_FOUND);
    return { coins: wallet.coins.toString(), gems: wallet.gems.toString() };
  }

  /* ---- writes ----------------------------------------------------------- */

  /**
   * Adds currency. `tx` is required when the credit must be atomic with other
   * work (a marketplace settlement, a battle payout); pass nothing for a
   * standalone grant and this opens its own transaction.
   */
  async credit(input: CreditInput, tx?: Prisma.TransactionClient): Promise<bigint> {
    if (input.amount <= 0n) {
      throw AppException.internal(
        ErrorCode.INTERNAL_ERROR,
        `credit() requires a positive amount, got ${input.amount}.`,
      );
    }
    return this.run(tx, (client) => this.applyDelta(client, input, input.amount));
  }

  /**
   * Removes currency, refusing to go below zero.
   * Throws INSUFFICIENT_COINS / INSUFFICIENT_GEMS (or the caller's override).
   */
  async debit(input: DebitInput, tx?: Prisma.TransactionClient): Promise<bigint> {
    if (input.amount <= 0n) {
      throw AppException.internal(
        ErrorCode.INTERNAL_ERROR,
        `debit() requires a positive amount, got ${input.amount}.`,
      );
    }
    return this.run(tx, (client) => this.applyDelta(client, input, -input.amount));
  }

  /** Reads a balance for a spend check. Use inside the same tx as the debit. */
  async balanceOf(
    userId: string,
    currency: 'COINS' | 'GEMS',
    tx?: Prisma.TransactionClient,
  ): Promise<bigint> {
    const client = tx ?? this.prisma;
    const wallet = await client.wallet.findUnique({
      where: { userId },
      select: { coins: true, gems: true },
    });
    if (!wallet) throw AppException.notFound(ErrorCode.WALLET_NOT_FOUND);
    return currency === 'COINS' ? wallet.coins : wallet.gems;
  }

  async canAfford(
    userId: string,
    currency: 'COINS' | 'GEMS',
    amount: bigint,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    return (await this.balanceOf(userId, currency, tx)) >= amount;
  }

  /* ---- internals -------------------------------------------------------- */

  private run<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.transactWithRetry((client) => fn(client));
  }

  private async applyDelta(
    client: Prisma.TransactionClient,
    input: CreditInput | DebitInput,
    delta: bigint,
  ): Promise<bigint> {
    const { userId, currency, reason, metadata, idempotencyKey } = input;

    // 1. Idempotency. A key that already exists means this exact movement has
    //    already been applied; return the recorded balance instead of redoing it.
    if (idempotencyKey) {
      const previous = await client.currencyTransaction.findUnique({
        where: { idempotencyKey },
        select: { balanceAfter: true, userId: true, amount: true },
      });
      if (previous) {
        if (previous.userId !== userId || previous.amount !== delta) {
          // Same key, different movement: a real bug or an attack, never benign.
          await this.audit.flagSuspicious({
            userId,
            kind: SuspicionKind.DUPLICATE_TRANSACTION,
            severity: 8,
            details: { idempotencyKey, expected: delta.toString(), stored: previous.amount.toString() },
          });
          throw AppException.conflict(
            ErrorCode.IDEMPOTENCY_REPLAY,
            'That request was already processed with different values.',
          );
        }
        this.logger.debug(`idempotent replay for key ${idempotencyKey} - no balance change`);
        return previous.balanceAfter;
      }
    }

    const column = currency === 'COINS' ? 'coins' : 'gems';

    // 2. Guarded update. `updateMany` with the balance predicate in the WHERE
    //    clause makes the check and the write a single atomic statement -
    //    there is no window where a concurrent spend can slip past.
    const guard: Prisma.WalletWhereInput =
      delta < 0n ? { userId, [column]: { gte: -delta } } : { userId };

    const updated = await client.wallet.updateMany({
      where: guard,
      data: {
        [column]: { increment: delta },
        ...(delta > 0n && currency === 'COINS'
          ? { lifetimeCoinsEarned: { increment: delta } }
          : {}),
        ...(delta > 0n && currency === 'GEMS' && reason === LedgerReason.PAYMENT_CREDIT
          ? { lifetimeGemsPurchased: { increment: delta } }
          : {}),
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const wallet = await client.wallet.findUnique({ where: { userId }, select: { id: true } });
      if (!wallet) throw AppException.notFound(ErrorCode.WALLET_NOT_FOUND);

      const code =
        (input as DebitInput).insufficientCode ??
        (currency === 'COINS' ? ErrorCode.INSUFFICIENT_COINS : ErrorCode.INSUFFICIENT_GEMS);
      throw AppException.badRequest(code);
    }

    // 3. Read the post-image and append the ledger row.
    const wallet = await client.wallet.findUniqueOrThrow({
      where: { userId },
      select: { coins: true, gems: true },
    });
    const balanceAfter = currency === 'COINS' ? wallet.coins : wallet.gems;

    if (balanceAfter < 0n) {
      // Should be impossible given the guard above; treat as a hard failure so
      // the transaction rolls back rather than persisting a negative balance.
      await this.audit.flagSuspicious({
        userId,
        kind: SuspicionKind.NEGATIVE_BALANCE,
        severity: 10,
        details: { currency, delta: delta.toString(), balanceAfter: balanceAfter.toString() },
      });
      throw AppException.internal(ErrorCode.NEGATIVE_BALANCE);
    }

    await client.currencyTransaction.create({
      data: {
        userId,
        currency: currency as CurrencyKey,
        amount: delta,
        balanceAfter,
        reason,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue,
        idempotencyKey: idempotencyKey ?? null,
      },
    });

    return balanceAfter;
  }
}
