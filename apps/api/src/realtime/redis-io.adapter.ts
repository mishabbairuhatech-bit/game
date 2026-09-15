import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Socket.IO over a Redis pub/sub adapter.
 *
 * Without this, `server.to(room).emit()` only reaches sockets connected to the
 * *same* API process - so the moment you run more than one backend replica,
 * half your players stop receiving notifications. The adapter fans emits out
 * across every node, which is what makes the API horizontally scalable.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisService,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  connect(): void {
    // Dedicated pub/sub connections - a subscribed client cannot run commands.
    this.adapterConstructor = createAdapter(this.redis.publisher, this.redis.subscriber);
    this.logger.log('socket.io redis adapter ready');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: {
        origin: this.corsOrigins,
        credentials: true,
      },
      // Long-poll fallback keeps the game usable behind proxies that block
      // websockets; NGINX is configured to upgrade properly either way.
      transports: ['websocket', 'polling'],
      pingInterval: 25_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 1e6,
      connectionStateRecovery: {
        // Brief network drops (lift, tunnel) resume the session and replay
        // missed events instead of dropping the player out of a raid.
        maxDisconnectionDuration: 60_000,
        skipMiddlewares: false,
      },
    });

    if (this.adapterConstructor) {
      (server as { adapter: (a: unknown) => void }).adapter(this.adapterConstructor);
    }

    return server;
  }
}
