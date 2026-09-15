import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import {
  ClientEvent,
  ServerEvent,
  SocketRoom,
  AccessTokenPayload,
  SocketErrorPayload,
} from '@empire/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

interface AuthedSocket extends Socket {
  data: {
    userId?: string;
    username?: string;
    role?: string;
  };
}

/**
 * The single realtime entry point.
 *
 * Authentication happens once, at handshake time: the client presents the same
 * short-lived access token it uses for REST, and the socket is joined to its
 * own user room. Nothing here trusts a userId sent in a message payload - the
 * identity always comes from the verified handshake.
 *
 * Phase 1 establishes connection, auth, rooms and the notification channel.
 * Battle and chat message handlers arrive in Phases 5 and 8; they will plug
 * into the same authenticated socket.
 */
@WebSocketGateway({ path: '/socket.io' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.reject(client, { code: 'UNAUTHENTICATED', message: 'No access token supplied.' });
      return;
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.jwtSecret,
      });
    } catch {
      this.reject(client, { code: 'INVALID_TOKEN', message: 'Access token is invalid or expired.' });
      return;
    }

    if (payload.typ !== 'access') {
      this.reject(client, { code: 'INVALID_TOKEN', message: 'Wrong token type.' });
      return;
    }

    // Same database re-check as the HTTP guard: a banned player must not keep
    // a live socket open for the remaining lifetime of their token.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, status: true, tokenVersion: true, deletedAt: true },
    });

    if (
      !user ||
      user.deletedAt ||
      user.tokenVersion !== payload.tv ||
      user.status === 'BANNED' ||
      user.status === 'SUSPENDED'
    ) {
      this.reject(client, { code: 'FORBIDDEN', message: 'This account cannot connect.' });
      return;
    }

    // Assigned as one object rather than three field writes: a half-populated
    // identity would be worse than none.
    //
    // require-atomic-updates flags any post-await write to a value captured
    // before it. That is the right default, but not applicable here:
    // handleConnection runs exactly once per socket, `client` is a parameter
    // that is never reassigned, and no other code path writes this socket's
    // data - so there is no interleaving for a second writer to lose.
    // eslint-disable-next-line require-atomic-updates
    client.data = { userId: user.id, username: user.username, role: user.role };

    // Personal room: how the server pushes notifications, wallet updates and
    // job-completion events to exactly one player across any replica.
    await client.join(SocketRoom.user(user.id));

    const alliance = await this.prisma.allianceMember.findUnique({
      where: { userId: user.id },
      select: { allianceId: true },
    });
    if (alliance) await client.join(SocketRoom.alliance(alliance.allianceId));

    client.emit(ServerEvent.CONNECTED, {
      userId: user.id,
      username: user.username,
      serverTime: new Date().toISOString(),
    });

    this.logger.debug(`socket connected: ${user.username} (${client.id})`);
  }

  handleDisconnect(client: AuthedSocket): void {
    if (client.data.username) {
      this.logger.debug(`socket disconnected: ${client.data.username} (${client.id})`);
    }
  }

  /** Round-trip probe. Also lets the client measure clock skew. */
  @SubscribeMessage(ClientEvent.PING)
  handlePing(@ConnectedSocket() client: AuthedSocket): { pong: true; serverTime: string } {
    void client;
    return { pong: true, serverTime: new Date().toISOString() };
  }

  /**
   * Subscribe to live updates for a slice of the world map (plot sales,
   * ownership changes). Rooms keep the fan-out proportional to what a player
   * is actually looking at instead of broadcasting the whole world.
   */
  @SubscribeMessage(ClientEvent.SUBSCRIBE_ZONE)
  async handleZoneSubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { zoneId?: string },
  ): Promise<{ subscribed: boolean }> {
    if (!client.data.userId || !body?.zoneId) return { subscribed: false };
    // Cap membership so one client cannot subscribe to the entire world.
    const zoneRooms = [...client.rooms].filter((r) => r.startsWith('zone:'));
    const oldest = zoneRooms[0];
    if (zoneRooms.length >= 12 && oldest !== undefined) {
      await client.leave(oldest);
    }
    await client.join(SocketRoom.zone(body.zoneId));
    return { subscribed: true };
  }

  @SubscribeMessage(ClientEvent.UNSUBSCRIBE_ZONE)
  async handleZoneUnsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { zoneId?: string },
  ): Promise<{ unsubscribed: boolean }> {
    if (!body?.zoneId) return { unsubscribed: false };
    await client.leave(SocketRoom.zone(body.zoneId));
    return { unsubscribed: true };
  }

  /* ---- server-side push API -------------------------------------------- */

  /** Emits to one player, wherever they are connected. */
  toUser(userId: string, event: string, payload: unknown): void {
    this.server.to(SocketRoom.user(userId)).emit(event, payload);
  }

  toAlliance(allianceId: string, event: string, payload: unknown): void {
    this.server.to(SocketRoom.alliance(allianceId)).emit(event, payload);
  }

  toZone(zoneId: string, event: string, payload: unknown): void {
    this.server.to(SocketRoom.zone(zoneId)).emit(event, payload);
  }

  /* ---- internals -------------------------------------------------------- */

  private extractToken(client: Socket): string | null {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');

    const header = client.handshake.headers.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');

    const query = client.handshake.query?.token;
    if (typeof query === 'string') return query;

    return null;
  }

  private reject(client: Socket, error: SocketErrorPayload): void {
    client.emit(ServerEvent.ERROR, error);
    client.disconnect(true);
  }
}
