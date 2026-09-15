import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Panel, Spinner } from '@empire/ui';
import type { PlotStatus } from '@empire/shared';
import { api } from '../../lib/api';
import { useMapStore, type PlotTile } from '../../store/map.store';
import { STATUS_LEGEND } from '../../game/map/plotAppearance';

/**
 * Map controls: navigation, search and the legend.
 *
 * Search resolves server-side because a plot code, a coordinate pair and a
 * commander name all have to be looked up against data the client does not
 * hold - it only ever has the viewport it streamed.
 */

interface MapControlsProps {
  onHome: () => void;
  onReset: () => void;
  hasTerritory: boolean;
  onJumpToPlot: (tile: PlotTile) => void;
}

export function MapToolbar({ onHome, onReset, hasTerritory, onJumpToPlot }: MapControlsProps) {
  const focusOn = useMapStore((s) => s.focusOn);
  const cameraTarget = useMapStore((s) => s.cameraTarget);

  const zoom = (factor: number) => {
    const current = cameraTarget?.distance ?? 90;
    const next = Math.max(14, Math.min(500, current * factor));
    focusOn(cameraTarget?.x ?? 50, cameraTarget?.y ?? 50, next, true);
  };

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-700/80 bg-ink-900/90 p-1.5 shadow-panel backdrop-blur">
      <Button
        size="sm"
        variant="gold"
        onClick={onHome}
        disabled={!hasTerritory}
        title={hasTerritory ? 'Fly to your territory' : 'You hold no land yet'}
      >
        My Empire
      </Button>
      <Button size="sm" variant="ghost" onClick={() => zoom(0.65)} title="Zoom in">
        +
      </Button>
      <Button size="sm" variant="ghost" onClick={() => zoom(1.55)} title="Zoom out">
        −
      </Button>
      <Button size="sm" variant="ghost" onClick={onReset} title="Reset the view">
        Reset
      </Button>
      <MapSearch onJumpToPlot={onJumpToPlot} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

function MapSearch({ onJumpToPlot }: { onJumpToPlot: (tile: PlotTile) => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PlotTile[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on an outside click, the way any dropdown is expected to behave.
  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = term.trim();
    if (trimmed.length < 2) return;

    setSearching(true);
    setMessage(null);
    try {
      const result = await api.get<{ plots: PlotTile[] }>('/world/search', {
        query: { q: trimmed },
      });
      setResults(result.plots);
      setOpen(true);
      if (result.plots.length === 0) setMessage('Nothing matched that.');
    } catch {
      setMessage('Search is unavailable right now.');
      setResults([]);
      setOpen(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <form onSubmit={submit} className="flex items-center gap-1">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Commander, code or x,y"
          aria-label="Search the map"
          className="h-8 w-44 rounded-md border border-ink-600 bg-ink-950/70 px-2 text-xs text-parchment-100 placeholder:text-parchment-600 focus:border-brass-500 focus:outline-none focus:ring-1 focus:ring-brass-400"
        />
        <Button size="sm" variant="secondary" type="submit" loading={searching}>
          Find
        </Button>
      </form>

      {open && (
        <div className="absolute right-0 top-10 z-30 w-72 rounded-lg border border-ink-700 bg-ink-900/97 p-1 shadow-panel backdrop-blur">
          {message && <p className="px-2 py-2 text-xs text-parchment-500">{message}</p>}
          {results.slice(0, 10).map((plot) => (
            <button
              key={plot.id}
              type="button"
              onClick={() => {
                onJumpToPlot(plot);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink-700"
            >
              <span className="truncate font-mono text-parchment-200">{plot.code}</span>
              <span className="shrink-0 text-[10px] text-parchment-500">
                {plot.ownerName ?? plot.biome.toLowerCase()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Map key.
 *
 * Lists the glyph next to the colour for every status, because the map encodes
 * status in colour, height *and* glyph - a legend that only showed swatches
 * would document one third of the encoding.
 */
export function MapLegend({ statusFilter }: { statusFilter: PlotStatus[] }) {
  const setStatusFilter = useMapStore((s) => s.setStatusFilter);
  const [open, setOpen] = useState(false);

  const toggle = (status: PlotStatus) => {
    const next = statusFilter.includes(status)
      ? statusFilter.filter((s) => s !== status)
      : [...statusFilter, status];
    setStatusFilter(next);
  };

  return (
    <div className="pointer-events-auto rounded-xl border border-ink-700/80 bg-ink-900/90 shadow-panel backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-parchment-400"
      >
        Map key
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-ink-700/70 p-2">
          <p className="px-1 pb-1.5 text-[10px] text-parchment-600">
            Click to filter. Claimed land also stands taller on the map.
          </p>
          {STATUS_LEGEND.map((entry) => {
            const active = statusFilter.length === 0 || statusFilter.includes(entry.status);
            return (
              <button
                key={entry.status}
                type="button"
                onClick={() => toggle(entry.status)}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-ink-800 ${
                  active ? 'text-parchment-200' : 'text-parchment-700'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-4 w-4 items-center justify-center rounded-sm border text-[9px]"
                  style={{ borderColor: entry.edge, color: entry.edge }}
                >
                  {entry.glyph}
                </span>
                {entry.label}
                {statusFilter.includes(entry.status) && (
                  <Badge tone="gold" className="ml-auto">
                    on
                  </Badge>
                )}
              </button>
            );
          })}
          {statusFilter.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              fullWidth
              className="mt-1"
              onClick={() => setStatusFilter([])}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status strip                                                                */
/* -------------------------------------------------------------------------- */

/** Tells the player when the map is loading or has been truncated. */
export function MapStatusStrip() {
  const loading = useMapStore((s) => s.loading);
  const truncated = useMapStore((s) => s.truncated);
  const error = useMapStore((s) => s.error);
  const count = useMapStore((s) => s.tiles.size);

  if (error) {
    return (
      <div className="pointer-events-auto rounded-md border border-ember-800 bg-ember-950/80 px-3 py-1.5 text-xs text-ember-200 backdrop-blur">
        {error}
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-ink-700/80 bg-ink-900/85 px-3 py-1.5 text-[11px] text-parchment-500 backdrop-blur">
      {loading && <Spinner className="h-3 w-3" />}
      <span>{count.toLocaleString()} plots loaded</span>
      <span id="map-fps" className="font-mono text-parchment-600" />
      {truncated && (
        <span className="text-brass-300">
          · viewport capped, zoom in for detail
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Territory summary                                                           */
/* -------------------------------------------------------------------------- */

export function TerritorySummary({
  totalPlots,
  maxPlots,
  expansionBlockedReason,
  nearbyCount,
}: {
  totalPlots: number;
  maxPlots: number;
  expansionBlockedReason: string | null;
  nearbyCount: number;
}) {
  return (
    <Panel title="My territory" className="w-64">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-parchment-600">Plots</dt>
          <dd className="font-mono text-base font-semibold text-parchment-100">
            {totalPlots}
            <span className="text-parchment-600">/{maxPlots}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-parchment-600">
            Claimable now
          </dt>
          <dd className="font-mono text-base font-semibold text-brass-200">{nearbyCount}</dd>
        </div>
      </dl>
      {expansionBlockedReason && (
        <p className="mt-2 text-[11px] leading-snug text-parchment-500">
          {expansionBlockedReason}
        </p>
      )}
    </Panel>
  );
}
