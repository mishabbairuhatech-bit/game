import { io, type Socket } from 'socket.io-client';
import { ServerEvent } from '@empire/shared';
import { getAccessToken } from './api';

let socket: Socket | null = null;

/**
 * Single shared Socket.IO connection.
 *
 * The handshake carries the same short-lived access token the REST client
 * uses; the server verifies it and re-checks the account, so a banned player's
 * socket is closed rather than lingering until the token expires.
 */
export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  socket?.disconnect();

  socket = io(
    (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? window.location.origin,
    {
      path: '/socket.io',
      // `auth` is re-evaluated on every reconnect attempt, so a token that was
      // refreshed while offline is picked up automatically.
      auth: (cb) => cb({ token: getAccessToken() ?? '' }),
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 8000,
      timeout: 12_000,
    },
  );

  socket.on(ServerEvent.ERROR, (payload: { code: string; message: string }) => {
     
    console.warn('[socket]', payload.code, payload.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
