/**
 * Offline resource accrual.
 *
 * The client never advances a resource counter. Whenever the server touches an
 * empire it calls `accrue()` with the wall-clock delta since `lastCollectedAt`,
 * clamps to storage, and persists. Browser timers are display-only.
 */

export interface ProducerState {
  /** Units produced per hour at the producer's current level. */
  ratePerHour: number;
  /** Multiplier from biome, research, boosts. 1 = none. */
  multiplier: number;
}

export interface AccrualInput {
  producers: ProducerState[];
  /** Amount currently stored. */
  current: number;
  /** Storage ceiling for this resource. */
  capacity: number;
  /** Milliseconds since the last accrual for this empire. */
  elapsedMs: number;
  /** Hard cap on how much offline time counts (anti-idle-abuse). */
  maxOfflineHours: number;
}

export interface AccrualResult {
  /** New stored amount, clamped to capacity. */
  stored: number;
  /** How much was actually added. */
  gained: number;
  /** How much was produced but lost because storage was full. */
  wasted: number;
  /** True when the producer was capped for part of the window. */
  cappedOut: boolean;
}

export function accrue(input: AccrualInput): AccrualResult {
  const { producers, current, capacity, elapsedMs, maxOfflineHours } = input;

  if (elapsedMs <= 0 || producers.length === 0) {
    return {
      stored: Math.min(current, capacity),
      gained: 0,
      wasted: 0,
      cappedOut: current >= capacity,
    };
  }

  const hours = Math.min(elapsedMs / 3_600_000, Math.max(0, maxOfflineHours));
  const perHour = producers.reduce((sum, p) => sum + p.ratePerHour * p.multiplier, 0);
  const produced = perHour * hours;

  const headroom = Math.max(0, capacity - current);
  const gained = Math.floor(Math.min(produced, headroom));
  const wasted = Math.max(0, Math.floor(produced) - gained);

  return {
    stored: current + gained,
    gained,
    wasted,
    cappedOut: gained < Math.floor(produced),
  };
}

/**
 * Seconds until the given resource fills its storage at the current rate.
 * Returned to the client purely so the HUD can render a countdown; the value
 * is advisory and is recomputed on every server response.
 */
export function secondsUntilFull(
  current: number,
  capacity: number,
  perHour: number,
): number | null {
  if (perHour <= 0) return null;
  if (current >= capacity) return 0;
  return Math.ceil(((capacity - current) / perHour) * 3600);
}
