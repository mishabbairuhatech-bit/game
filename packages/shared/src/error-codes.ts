/**
 * Canonical machine-readable error codes.
 *
 * Every API failure serialises as:
 *   { success: false, error: { code, message, details?, requestId, timestamp } }
 *
 * The frontend maps `code` -> localised copy; `message` is only a fallback.
 */
export const ErrorCode = {
  // --- generic ---------------------------------------------------------
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_REQUEST: 'BAD_REQUEST',
  IDEMPOTENCY_REPLAY: 'IDEMPOTENCY_REPLAY',

  // --- auth ------------------------------------------------------------
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  OAUTH_PROVIDER_DISABLED: 'OAUTH_PROVIDER_DISABLED',
  OAUTH_ACCOUNT_LINK_CONFLICT: 'OAUTH_ACCOUNT_LINK_CONFLICT',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',

  // --- economy ---------------------------------------------------------
  INSUFFICIENT_COINS: 'INSUFFICIENT_COINS',
  INSUFFICIENT_GEMS: 'INSUFFICIENT_GEMS',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  STORAGE_FULL: 'STORAGE_FULL',
  NEGATIVE_BALANCE: 'NEGATIVE_BALANCE',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',

  // --- world / land ----------------------------------------------------
  PLOT_NOT_FOUND: 'PLOT_NOT_FOUND',
  PLOT_NOT_AVAILABLE: 'PLOT_NOT_AVAILABLE',
  PLOT_NOT_OWNED: 'PLOT_NOT_OWNED',
  PLOT_NOT_ADJACENT: 'PLOT_NOT_ADJACENT',
  PLOT_LOCKED: 'PLOT_LOCKED',
  PLOT_PURCHASE_COOLDOWN: 'PLOT_PURCHASE_COOLDOWN',
  PLOT_LIMIT_REACHED: 'PLOT_LIMIT_REACHED',
  STARTER_PLOT_ALREADY_ASSIGNED: 'STARTER_PLOT_ALREADY_ASSIGNED',
  NO_STARTER_PLOT_AVAILABLE: 'NO_STARTER_PLOT_AVAILABLE',

  // --- buildings -------------------------------------------------------
  BUILDING_NOT_FOUND: 'BUILDING_NOT_FOUND',
  INVALID_PLACEMENT: 'INVALID_PLACEMENT',
  PLACEMENT_OVERLAP: 'PLACEMENT_OVERLAP',
  PLACEMENT_OUT_OF_BOUNDS: 'PLACEMENT_OUT_OF_BOUNDS',
  PLACEMENT_BLOCKED_TERRAIN: 'PLACEMENT_BLOCKED_TERRAIN',
  BUILD_LIMIT_REACHED: 'BUILD_LIMIT_REACHED',
  NO_BUILDER_AVAILABLE: 'NO_BUILDER_AVAILABLE',
  MAX_LEVEL_REACHED: 'MAX_LEVEL_REACHED',
  HQ_LEVEL_REQUIRED: 'HQ_LEVEL_REQUIRED',
  UPGRADE_IN_PROGRESS: 'UPGRADE_IN_PROGRESS',

  // --- army / battle ---------------------------------------------------
  UNIT_NOT_FOUND: 'UNIT_NOT_FOUND',
  POPULATION_CAP_REACHED: 'POPULATION_CAP_REACHED',
  TRAINING_QUEUE_FULL: 'TRAINING_QUEUE_FULL',
  BATTLE_NOT_FOUND: 'BATTLE_NOT_FOUND',
  BATTLE_ALREADY_FINISHED: 'BATTLE_ALREADY_FINISHED',
  BATTLE_IN_PROGRESS: 'BATTLE_IN_PROGRESS',
  TARGET_SHIELDED: 'TARGET_SHIELDED',
  CANNOT_ATTACK_SELF: 'CANNOT_ATTACK_SELF',
  NO_OPPONENT_FOUND: 'NO_OPPONENT_FOUND',
  INVALID_BATTLE_ACTION: 'INVALID_BATTLE_ACTION',

  // --- marketplace -----------------------------------------------------
  LISTING_NOT_FOUND: 'LISTING_NOT_FOUND',
  LISTING_NOT_ACTIVE: 'LISTING_NOT_ACTIVE',
  LISTING_EXPIRED: 'LISTING_EXPIRED',
  CANNOT_BUY_OWN_LISTING: 'CANNOT_BUY_OWN_LISTING',
  LISTING_ALREADY_SOLD: 'LISTING_ALREADY_SOLD',
  ASSET_NOT_SELLABLE: 'ASSET_NOT_SELLABLE',

  // --- payments --------------------------------------------------------
  PAYMENT_PROVIDER_DISABLED: 'PAYMENT_PROVIDER_DISABLED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PAYMENT_AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',

  // --- social ----------------------------------------------------------
  ALLIANCE_NOT_FOUND: 'ALLIANCE_NOT_FOUND',
  ALLIANCE_FULL: 'ALLIANCE_FULL',
  ALREADY_IN_ALLIANCE: 'ALREADY_IN_ALLIANCE',
  NOT_IN_ALLIANCE: 'NOT_IN_ALLIANCE',
  CHAT_MUTED: 'CHAT_MUTED',
  USER_BLOCKED: 'USER_BLOCKED',

  // --- anti-cheat ------------------------------------------------------
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  ACTION_TOO_FAST: 'ACTION_TOO_FAST',
  STATE_DESYNC: 'STATE_DESYNC',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Default human-readable copy. The client is free to override per locale. */
export const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.INTERNAL_ERROR]: 'Something went wrong on our side. Please try again.',
  [ErrorCode.VALIDATION_ERROR]: 'Some of the values you sent are not valid.',
  [ErrorCode.NOT_FOUND]: 'We could not find what you were looking for.',
  [ErrorCode.RATE_LIMITED]: 'You are doing that too quickly. Slow down a moment.',
  [ErrorCode.UNAUTHENTICATED]: 'Please sign in to continue.',
  [ErrorCode.INVALID_CREDENTIALS]: 'That email or password is not correct.',
  [ErrorCode.EMAIL_ALREADY_REGISTERED]: 'An account already exists for that email.',
  [ErrorCode.USERNAME_TAKEN]: 'That commander name is already taken.',
  [ErrorCode.EMAIL_NOT_VERIFIED]: 'Verify your email address before continuing.',
  [ErrorCode.ACCOUNT_BANNED]: 'This account has been suspended.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to do that.',
  [ErrorCode.INSUFFICIENT_COINS]: 'Not enough coins.',
  [ErrorCode.INSUFFICIENT_GEMS]: 'Not enough gems.',
  [ErrorCode.INSUFFICIENT_RESOURCES]: 'Not enough resources.',
  [ErrorCode.PLOT_NOT_AVAILABLE]: 'That territory is not available.',
  [ErrorCode.LISTING_ALREADY_SOLD]: 'This plot was just bought by someone else.',
  [ErrorCode.PAYMENT_VERIFICATION_FAILED]: 'We could not verify that payment.',
};

export function messageFor(code: string, fallback = 'Unexpected error.'): string {
  return ERROR_MESSAGES[code] ?? fallback;
}
