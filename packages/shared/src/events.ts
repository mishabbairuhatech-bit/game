/** Socket.IO channel names. Rooms are scoped so a node only pushes what matters. */
export const SocketRoom = {
  user: (userId: string) => `user:${userId}`,
  empire: (empireId: string) => `empire:${empireId}`,
  battle: (battleId: string) => `battle:${battleId}`,
  alliance: (allianceId: string) => `alliance:${allianceId}`,
  zone: (zoneId: string) => `zone:${zoneId}`,
  globalChat: () => 'chat:global',
} as const;

/** Server -> client events. */
export const ServerEvent = {
  CONNECTED: 'connected',
  ERROR: 'error',
  NOTIFICATION: 'notification',
  WALLET_UPDATED: 'wallet:updated',
  RESOURCES_UPDATED: 'resources:updated',
  BUILDING_UPDATED: 'building:updated',
  QUEUE_UPDATED: 'queue:updated',
  BATTLE_STATE: 'battle:state',
  BATTLE_EVENT: 'battle:event',
  BATTLE_RESULT: 'battle:result',
  CHAT_MESSAGE: 'chat:message',
  MARKET_UPDATED: 'market:updated',
  PLOT_UPDATED: 'plot:updated',
} as const;

/** Client -> server events. All of these are validated + authorised server side. */
export const ClientEvent = {
  PING: 'ping',
  SUBSCRIBE_ZONE: 'zone:subscribe',
  UNSUBSCRIBE_ZONE: 'zone:unsubscribe',
  BATTLE_JOIN: 'battle:join',
  BATTLE_DEPLOY: 'battle:deploy',
  BATTLE_LEAVE: 'battle:leave',
  CHAT_SEND: 'chat:send',
} as const;

export interface SocketErrorPayload {
  code: string;
  message: string;
}
