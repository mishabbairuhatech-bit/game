import type { PlotStatus } from '@empire/shared';

/**
 * Plot lifecycle.
 *
 * Ownership is the most attackable surface in the game: it is worth real
 * money once the land marketplace opens. Rather than scattering ad-hoc
 * `if (plot.status === ...)` checks across services, every status change goes
 * through this table, so an illegal transition is impossible to express
 * rather than merely unlikely.
 */

/** Why a plot is changing state. Recorded on the ownership trail. */
export type PlotTransitionReason =
  | 'STARTER_GRANT'
  | 'WORLD_PURCHASE'
  | 'MARKETPLACE_LIST'
  | 'MARKETPLACE_DELIST'
  | 'MARKETPLACE_PURCHASE'
  | 'ADMIN_GRANT'
  | 'ADMIN_LOCK'
  | 'ADMIN_UNLOCK'
  | 'ABANDON'
  | 'EVENT_START'
  | 'EVENT_END'
  | 'SHIELD_APPLIED'
  | 'SHIELD_EXPIRED';

/**
 * Allowed transitions, keyed by the current status.
 *
 * Notable omissions are deliberate:
 *   * FREE -> FOR_SALE   : the world does not list its own land; a player
 *                          must own a plot before selling it.
 *   * STARTER -> FOR_SALE: a player cannot sell the ground their keep stands
 *                          on, which would otherwise strand their buildings.
 *   * UNAVAILABLE -> *   : water and mountain are scenery, not inventory.
 */
export const PLOT_TRANSITIONS: Record<PlotStatus, readonly PlotStatus[]> = {
  FREE: ['OWNED', 'STARTER', 'LOCKED', 'PROTECTED', 'EVENT', 'UNAVAILABLE'],
  STARTER: ['OWNED', 'PROTECTED', 'LOCKED'],
  OWNED: ['FOR_SALE', 'FREE', 'PROTECTED', 'LOCKED', 'EVENT'],
  FOR_SALE: ['OWNED', 'FREE', 'LOCKED'],
  LOCKED: ['FREE', 'OWNED', 'PROTECTED', 'UNAVAILABLE'],
  PROTECTED: ['OWNED', 'FREE', 'LOCKED'],
  EVENT: ['FREE', 'OWNED', 'LOCKED'],
  UNAVAILABLE: [],
};

/** Which reasons may drive a given transition. Empty means "any". */
const REASON_GUARDS: Partial<Record<`${PlotStatus}->${PlotStatus}`, PlotTransitionReason[]>> = {
  'FREE->STARTER': ['STARTER_GRANT', 'ADMIN_GRANT'],
  'FREE->OWNED': ['WORLD_PURCHASE', 'ADMIN_GRANT', 'EVENT_END'],
  'OWNED->FOR_SALE': ['MARKETPLACE_LIST'],
  'FOR_SALE->OWNED': ['MARKETPLACE_PURCHASE', 'MARKETPLACE_DELIST', 'ADMIN_GRANT'],
  'OWNED->FREE': ['ABANDON', 'ADMIN_GRANT'],
  'FOR_SALE->FREE': ['ABANDON', 'ADMIN_GRANT'],
};

export interface TransitionCheck {
  allowed: boolean;
  /** Machine-readable reason for a refusal, suitable for an error code. */
  refusal?: 'TERMINAL_STATE' | 'ILLEGAL_TRANSITION' | 'REASON_NOT_PERMITTED';
  message?: string;
}

/**
 * Is `from -> to` legal, optionally for a specific reason?
 *
 * A no-op transition (`from === to`) is allowed so an idempotent retry does
 * not fail; callers that care should compare statuses themselves.
 */
export function checkPlotTransition(
  from: PlotStatus,
  to: PlotStatus,
  reason?: PlotTransitionReason,
): TransitionCheck {
  if (from === to) return { allowed: true };

  const allowedTargets = PLOT_TRANSITIONS[from];
  if (!allowedTargets) {
    return {
      allowed: false,
      refusal: 'ILLEGAL_TRANSITION',
      message: `Unknown plot status "${from}".`,
    };
  }

  if (allowedTargets.length === 0) {
    return {
      allowed: false,
      refusal: 'TERMINAL_STATE',
      message: `${from} is a terminal state; this land can never change hands.`,
    };
  }

  if (!allowedTargets.includes(to)) {
    return {
      allowed: false,
      refusal: 'ILLEGAL_TRANSITION',
      message: `A plot cannot go from ${from} to ${to}.`,
    };
  }

  if (reason) {
    const guard = REASON_GUARDS[`${from}->${to}` as keyof typeof REASON_GUARDS];
    if (guard && !guard.includes(reason)) {
      return {
        allowed: false,
        refusal: 'REASON_NOT_PERMITTED',
        message: `"${reason}" cannot drive a ${from} -> ${to} transition.`,
      };
    }
  }

  return { allowed: true };
}

export function canTransition(
  from: PlotStatus,
  to: PlotStatus,
  reason?: PlotTransitionReason,
): boolean {
  return checkPlotTransition(from, to, reason).allowed;
}

/* -------------------------------------------------------------------------- */
/* Derived predicates                                                          */
/* -------------------------------------------------------------------------- */

/** Statuses a plot can be in while belonging to a player. */
export const OWNED_STATUSES: readonly PlotStatus[] = ['STARTER', 'OWNED', 'FOR_SALE', 'PROTECTED'];

/** Statuses that permit a purchase directly from the world. */
export const WORLD_PURCHASABLE_STATUSES: readonly PlotStatus[] = ['FREE'];

export function isOwnedStatus(status: PlotStatus): boolean {
  return OWNED_STATUSES.includes(status);
}

/** Can this plot be bought from the world (as opposed to from a player)? */
export function isWorldPurchasable(status: PlotStatus): boolean {
  return WORLD_PURCHASABLE_STATUSES.includes(status);
}

/** Human-readable, non-colour label for the map legend. */
export const PLOT_STATUS_LABEL: Record<PlotStatus, string> = {
  FREE: 'Unclaimed',
  STARTER: 'Starter holding',
  OWNED: 'Claimed',
  FOR_SALE: 'For sale',
  LOCKED: 'Locked',
  PROTECTED: 'Protected',
  EVENT: 'Event ground',
  UNAVAILABLE: 'Impassable',
};
