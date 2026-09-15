import { Injectable, Logger } from '@nestjs/common';
import { AuditActorType, Prisma, SuspicionKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface SuspicionEntry {
  userId: string;
  kind: SuspicionKind;
  severity?: number;
  details: Record<string, unknown>;
  requestId?: string | null;
  ipAddress?: string | null;
}

/** Field names that must never reach the audit table. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'secret',
  'signature',
  'authorization',
  'cookie',
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit row. Never throws - an audit failure must not roll back
   * the business action that succeeded, but it must be loud in the log.
   *
   * Pass `tx` when the audit row should be part of the same transaction as
   * the change it describes (admin mutations, currency movements).
   */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          before: redact(entry.before) as Prisma.InputJsonValue,
          after: redact(entry.after) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (error) {
      if (tx) throw error; // inside a transaction the caller decides
      this.logger.error(
        { err: error, action: entry.action },
        `failed to write audit log for "${entry.action}"`,
      );
    }
  }

  /** Shorthand for player-initiated actions. */
  user(action: string, userId: string, rest: Partial<AuditEntry> = {}): Promise<void> {
    return this.log({ actorType: AuditActorType.USER, actorId: userId, action, ...rest });
  }

  /** Shorthand for admin/moderator actions. Every one of these is mandatory. */
  admin(
    action: string,
    adminId: string,
    rest: Partial<AuditEntry> = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    return this.log({ actorType: AuditActorType.ADMIN, actorId: adminId, action, ...rest }, tx);
  }

  system(action: string, rest: Partial<AuditEntry> = {}): Promise<void> {
    return this.log({ actorType: AuditActorType.SYSTEM, action, ...rest });
  }

  /**
   * Records an anti-cheat signal. These are reviewed in the admin panel; the
   * request itself is normally rejected separately by the caller.
   */
  async flagSuspicious(entry: SuspicionEntry): Promise<void> {
    try {
      await this.prisma.suspiciousActivity.create({
        data: {
          userId: entry.userId,
          kind: entry.kind,
          severity: Math.min(10, Math.max(1, entry.severity ?? 1)),
          details: redact(entry.details) as Prisma.InputJsonValue,
          requestId: entry.requestId ?? null,
          ipAddress: entry.ipAddress ?? null,
        },
      });
      this.logger.warn(
        { userId: entry.userId, kind: entry.kind, severity: entry.severity ?? 1 },
        `suspicious activity: ${entry.kind}`,
      );
    } catch (error) {
      this.logger.error({ err: error }, 'failed to record suspicious activity');
    }
  }
}

/** Recursively strips secrets and truncates anything unreasonably large. */
function redact(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return undefined;
  if (depth > 6) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }

  if (typeof value === 'bigint') return value.toString();

  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}...[truncated]`;
  }

  return value;
}
