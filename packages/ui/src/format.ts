/** Presentation helpers shared by the game client and the admin panel. */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

/** 12345 -> "12.3K". Used in the HUD where space is tight. */
export function formatCompact(n: number): string {
  return compact.format(n);
}

export function formatNumber(n: number): string {
  return plain.format(n);
}

/** Coins/gems are integers; never show fractional currency. */
export function formatCurrency(n: number): string {
  return plain.format(Math.trunc(n));
}

/** Minor units (paise / cents) -> localised money string. */
export function formatMoney(minorUnits: number, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/** 3725 -> "1h 2m 5s". Used for build / training countdowns. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s === 0) return 'ready';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && !d) parts.push(`${m}m`);
  if (sec && !d && !h) parts.push(`${sec}s`);
  return parts.join(' ');
}

export function formatRelativeTime(iso: string | Date, now = new Date()): string {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const deltaSec = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (abs < 60) return rtf.format(deltaSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(deltaSec / 86400), 'day');
  return then.toLocaleDateString();
}

/** Basis points -> "5%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
