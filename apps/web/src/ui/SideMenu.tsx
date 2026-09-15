import clsx from 'clsx';

export type MenuKey =
  | 'empire'
  | 'map'
  | 'army'
  | 'buildings'
  | 'research'
  | 'marketplace'
  | 'land'
  | 'alliance'
  | 'quests'
  | 'achievements'
  | 'battle'
  | 'settings';

interface MenuEntry {
  key: MenuKey;
  label: string;
  icon: string;
  /** Phase in which this screen becomes functional. */
  availableIn: number;
}

/**
 * Each entry is labelled with the phase that makes it functional, and entries
 * that are not wired up yet are visibly disabled. A button that looks live but
 * does nothing is worse than one that honestly says "not yet" - so nothing
 * here silently no-ops.
 */
const ENTRIES: MenuEntry[] = [
  { key: 'empire', label: 'Empire', icon: '⌂', availableIn: 1 },
  { key: 'map', label: 'Map', icon: '⊞', availableIn: 2 },
  { key: 'buildings', label: 'Buildings', icon: '⌂', availableIn: 3 },
  { key: 'army', label: 'Army', icon: '⚔', availableIn: 4 },
  { key: 'battle', label: 'Attack', icon: '✖', availableIn: 5 },
  { key: 'land', label: 'My Land', icon: '▣', availableIn: 6 },
  { key: 'marketplace', label: 'Market', icon: '⚖', availableIn: 6 },
  { key: 'research', label: 'Research', icon: '✦', availableIn: 8 },
  { key: 'alliance', label: 'Alliance', icon: '⚑', availableIn: 8 },
  { key: 'quests', label: 'Quests', icon: '✓', availableIn: 8 },
  { key: 'achievements', label: 'Awards', icon: '★', availableIn: 8 },
  { key: 'settings', label: 'Settings', icon: '⚙', availableIn: 1 },
];

const CURRENT_PHASE = 2;

export function SideMenu({
  active,
  onSelect,
}: {
  active: MenuKey;
  onSelect: (key: MenuKey) => void;
}) {
  return (
    <nav
      aria-label="Empire navigation"
      className="pointer-events-none absolute left-3 top-24 z-20 flex flex-col gap-1"
    >
      <div className="pointer-events-auto flex flex-col gap-0.5 rounded-xl border border-ink-700/80 bg-ink-900/85 p-1.5 shadow-panel backdrop-blur">
        {ENTRIES.map((entry) => {
          const enabled = entry.availableIn <= CURRENT_PHASE;
          const selected = active === entry.key;

          return (
            <button
              key={entry.key}
              type="button"
              disabled={!enabled}
              aria-current={selected ? 'page' : undefined}
              onClick={() => enabled && onSelect(entry.key)}
              title={enabled ? entry.label : `${entry.label} — arrives in phase ${entry.availableIn}`}
              className={clsx(
                'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold transition-colors',
                selected
                  ? 'bg-brass-500 text-ink-950'
                  : enabled
                    ? 'text-parchment-300 hover:bg-ink-700 hover:text-parchment-100'
                    : 'cursor-not-allowed text-parchment-700',
              )}
            >
              <span aria-hidden="true" className="w-4 text-center text-sm">
                {entry.icon}
              </span>
              <span className="hidden sm:inline">{entry.label}</span>
              {!enabled && (
                <span className="ml-auto hidden text-[9px] font-normal uppercase tracking-wider sm:inline">
                  P{entry.availableIn}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
