import { formatCompact, formatCurrency } from '@empire/ui';

export interface HudResource {
  key: string;
  label: string;
  color: string;
  amount: number;
  capacity: number;
}

export interface HudProps {
  empireName: string;
  commander: string;
  level: number;
  coins: string;
  gems: string;
  resources: HudResource[];
  onLogout: () => void;
  onToggleStats: () => void;
  statsVisible: boolean;
}

/**
 * Top HUD bar.
 *
 * Every number here comes from the server response - there is no client-side
 * timer ticking a resource counter upward. A bar that is visibly full is
 * actually full in the database, which is the only way the display can be
 * trusted for a spend decision.
 */
export function Hud({
  empireName,
  commander,
  level,
  coins,
  gems,
  resources,
  onLogout,
  onToggleStats,
  statsVisible,
}: HudProps) {
  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-20 p-3">
      <div className="pointer-events-auto mx-auto flex max-w-7xl flex-wrap items-center gap-3 rounded-xl border border-ink-700/80 bg-ink-900/85 px-3 py-2 shadow-panel backdrop-blur">
        {/* identity */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-brass-700 bg-gradient-to-b from-brass-400 to-brass-600 font-display text-sm font-bold text-ink-950">
            {level}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-brass-200">
              {empireName}
            </p>
            <p className="truncate text-[11px] text-parchment-500">{commander}</p>
          </div>
        </div>

        <div className="hidden h-8 w-px bg-ink-700 sm:block" />

        {/* hard currency */}
        <div className="flex items-center gap-3">
          <Currency label="Coins" value={formatCurrency(Number(coins))} color="var(--color-res-coins)" />
          <Currency label="Gems" value={formatCurrency(Number(gems))} color="var(--color-res-gems)" />
        </div>

        <div className="hidden h-8 w-px bg-ink-700 lg:block" />

        {/* stockpiles */}
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {resources.map((resource) => (
            <ResourceMeter key={resource.key} resource={resource} />
          ))}
        </div>

        {/* controls */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleStats}
            title="Toggle the renderer performance overlay"
            className="rounded border border-ink-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-parchment-400 transition-colors hover:bg-ink-700 hover:text-parchment-200"
          >
            {statsVisible ? 'FPS on' : 'FPS'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="rounded border border-ink-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-parchment-400 transition-colors hover:bg-ember-900 hover:text-ember-200"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function Currency({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span
        aria-hidden="true"
        className="h-3 w-3 rounded-full ring-1 ring-black/40"
        style={{ background: color }}
      />
      <span className="font-mono text-xs font-semibold text-parchment-100 tabular-nums">
        {value}
      </span>
    </div>
  );
}

function ResourceMeter({ resource }: { resource: HudResource }) {
  const ratio = resource.capacity > 0 ? Math.min(1, resource.amount / resource.capacity) : 0;
  const full = ratio >= 1;

  return (
    <div
      className="min-w-[86px]"
      title={`${resource.label}: ${resource.amount} / ${resource.capacity}${
        full ? ' — storage full, production is being wasted' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[9px] uppercase tracking-wider text-parchment-600">
          {resource.label}
        </span>
        <span
          className={`font-mono text-[11px] font-semibold tabular-nums ${
            full ? 'text-ember-300' : 'text-parchment-200'
          }`}
        >
          {formatCompact(resource.amount)}
        </span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-ink-950">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${ratio * 100}%`,
            background: full ? 'var(--color-ember-500)' : resource.color,
          }}
        />
      </div>
    </div>
  );
}
