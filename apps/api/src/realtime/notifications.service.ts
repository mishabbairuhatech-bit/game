import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { ServerEvent } from '@empire/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link target for the client, e.g. { screen: 'battle', id }. */
  data?: Record<string, unknown>;
}

/**
 * Notifications are persisted first, then pushed.
 *
 * Persisting first is what makes them survive a refresh, a logout or an
 * offline player: the socket emit is a live convenience, and the database row
 * is the source of truth the client reads on next login.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async notify(input: NotifyInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;

    const row = await client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 120),
        body: input.body.slice(0, 500),
        data: (input.data ?? undefined) as Prisma.InputJsonValue,
      },
    });

    // Never let a socket failure roll back the caller's transaction.
    try {
      this.gateway.toUser(input.userId, ServerEvent.NOTIFICATION, {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'notification persisted but push failed');
    }
  }

  async list(userId: string, limit = 30, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids?: string[]): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return count;
  }
}
