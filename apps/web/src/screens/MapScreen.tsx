import { useCallback, useEffect, useMemo } from 'react';
import { Alert, Button, Panel, Spinner } from '@empire/ui';
import { ServerEvent } from '@empire/shared';
import { WorldMapScene } from '../game/map/WorldMapScene';
import { useWorldStore } from '../store/world.store';
import { useMapStore, type PlotTile } from '../store/map.store';
import { usePlotStore } from '../store/plot.store';
import { useTerritoryStore } from '../store/territory.store';
import { useEmpireStore } from '../store/empire.store';
import { getSocket } from '../lib/socket';
import { PlotPanel } from '../ui/map/PlotPanel';
import {
  MapLegend,
  MapStatusStrip,
  MapToolbar,
  TerritorySummary,
} from '../ui/map/MapControls';

/**
 * The world map.
 *
 * Owns the wiring between four stores and the 3D scene; the scene itself knows
 * nothing about the API. Everything rendered here came from the server - the
 * client never invents a plot, a price or an ownership.
 */
export function MapScreen({ showStats = false }: { showStats?: boolean }) {
  const { world, regions, loading: worldLoading, error: worldError, notGenerated, load: loadWorld } =
    useWorldStore();
  const { focusOn, patchTile, statusFilter, clearCache } = useMapStore();
  const { selectedId, detail, select, clear } = usePlotStore();
  const {
    territory,
    nearby,
    load: loadTerritory,
    loadNearby,
  } = useTerritoryStore();
  const reloadEmpire = useEmpireStore((s) => s.load);

  /* ---- initial load ----------------------------------------------------- */
  useEffect(() => {
    void loadWorld();
  }, [loadWorld]);

  useEffect(() => {
    if (!world) return;
    void loadTerritory();
    void loadNearby();
  }, [world, loadTerritory, loadNearby]);

  /* ---- frame the player's land on first arrival ------------------------- */
  useEffect(() => {
    if (!world || !territory?.home) return;
    focusOn(territory.home.x + 0.5, territory.home.y + 0.5, 34, false);
    // Only on the first territory load; later focus changes are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, territory?.home?.id]);

  /* ---- realtime plot updates -------------------------------------------- */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onPlotUpdated = (payload: {
      id: string;
      code: string;
      x: number;
      y: number;
      status: PlotTile['status'];
      ownerName: string | null;
    }) => {
      // Patch the tile in place rather than re-streaming: another player
      // claiming land two regions away should not cost this client a fetch.
      const existing = useMapStore.getState().tiles.get(`${payload.x}:${payload.y}`);
      if (!existing) return;
      patchTile({
        ...existing,
        status: payload.status,
        ownerName: payload.ownerName,
        isMine: existing.isMine,
      });
    };

    socket.on(ServerEvent.PLOT_UPDATED, onPlotUpdated);
    return () => {
      socket.off(ServerEvent.PLOT_UPDATED, onPlotUpdated);
    };
  }, [patchTile]);

  /* ---- refresh after a purchase ----------------------------------------- */
  const lastPurchase = usePlotStore((s) => s.lastPurchase);
  useEffect(() => {
    if (!lastPurchase) return;
    void loadTerritory();
    void loadNearby();
    void reloadEmpire();
  }, [lastPurchase, loadTerritory, loadNearby, reloadEmpire]);

  /* ---- actions ----------------------------------------------------------- */
  const handleSelect = useCallback(
    (tile: PlotTile) => {
      void select(tile.id);
    },
    [select],
  );

  const goHome = useCallback(() => {
    const home = territory?.home;
    if (home) focusOn(home.x + 0.5, home.y + 0.5, 34, true);
  }, [territory?.home, focusOn]);

  const resetView = useCallback(() => {
    const centre = (world?.counts.plotsPerSide ?? 100) / 2;
    clear();
    focusOn(centre, centre, 300, true);
  }, [world, focusOn, clear]);

  const jumpToPlot = useCallback(
    (tile: PlotTile) => {
      focusOn(tile.x + 0.5, tile.y + 0.5, 45, true);
      void select(tile.id);
    },
    [focusOn, select],
  );

  const visitPlot = useCallback(
    (x: number, y: number) => focusOn(x + 0.5, y + 0.5, 30, true),
    [focusOn],
  );

  /* ---- the region containing home, highlighted at far zoom --------------- */
  const homeRegionId = useMemo(() => {
    if (!world || !territory?.home) return null;
    const home = territory.home;
    const plotsPerRegionSide = world.regionSize / world.plotSize;
    const rx = Math.floor(home.x / plotsPerRegionSide);
    const ry = Math.floor(home.y / plotsPerRegionSide);
    return regions.find((r) => r.x === rx && r.y === ry)?.id ?? null;
  }, [world, territory?.home, regions]);

  // Drop the streamed cache on unmount so re-entering the map does not paint
  // stale ownership for a second before the first fetch lands.
  useEffect(() => () => clearCache(), [clearCache]);

  /* ---- states ------------------------------------------------------------ */
  if (worldLoading && !world) {
    return (
      <Centered>
        <Spinner className="h-5 w-5" />
        <p className="text-sm text-parchment-400">Surveying the frontier…</p>
      </Centered>
    );
  }

  if (notGenerated) {
    return (
      <Centered>
        <Panel title="No world yet" className="max-w-lg">
          <Alert tone="warning" title="The persistent world has not been generated">
            Run the database seed to build it:
            <code className="mt-2 block rounded bg-ink-950 px-2 py-1 font-mono text-[11px] text-parchment-300">
              docker compose exec backend npx prisma db seed
            </code>
          </Alert>
          <Button className="mt-3" size="sm" onClick={() => void loadWorld()}>
            Check again
          </Button>
        </Panel>
      </Centered>
    );
  }

  if (worldError) {
    return (
      <Centered>
        <Panel title="Could not load the world" className="max-w-lg">
          <Alert tone="error">{worldError}</Alert>
          <Button className="mt-3" size="sm" onClick={() => void loadWorld()}>
            Retry
          </Button>
        </Panel>
      </Centered>
    );
  }

  if (!world) return null;

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0">
        <WorldMapScene
          onSelect={handleSelect}
          selectedId={detail?.id ?? selectedId}
          homeRegionId={homeRegionId}
          showStats={showStats}
        />
      </div>

      {/* toolbar */}
      <div className="pointer-events-none absolute left-1/2 top-24 z-20 -translate-x-1/2">
        <MapToolbar
          onHome={goHome}
          onReset={resetView}
          hasTerritory={Boolean(territory?.home)}
          onJumpToPlot={jumpToPlot}
        />
      </div>

      {/* right rail */}
      <div className="pointer-events-none absolute right-3 top-24 z-20 flex w-64 flex-col gap-3">
        {territory && (
          <div className="pointer-events-auto">
            <TerritorySummary
              totalPlots={territory.totalPlots}
              maxPlots={territory.maxPlots}
              expansionBlockedReason={territory.expansionBlockedReason}
              nearbyCount={nearby.length}
            />
          </div>
        )}
        <MapLegend statusFilter={statusFilter} />
      </div>

      {/* selected plot */}
      {(selectedId || detail) && (
        <div className="pointer-events-none absolute bottom-16 left-3 z-20 w-80">
          <div className="pointer-events-auto">
            <PlotPanel onVisit={visitPlot} onClose={clear} />
          </div>
        </div>
      )}

      {/* status strip */}
      <div className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
        <MapStatusStrip />
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-frontier px-4">
      {children}
    </div>
  );
}
