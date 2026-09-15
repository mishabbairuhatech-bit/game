import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Panel, formatNumber } from '@empire/ui';
import { ServerEvent } from '@empire/shared';
import { RESOURCE_BY_KEY } from '@empire/game-data';
import { EmpireScene, type SceneBuilding } from '../game/EmpireScene';
import { MapScreen } from './MapScreen';
import { useAuthStore } from '../store/auth.store';
import { useEmpireStore } from '../store/empire.store';
import { useTerritoryStore } from '../store/territory.store';
import { api } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import { Hud } from '../ui/Hud';
import { SideMenu, type MenuKey } from '../ui/SideMenu';

interface PlotView {
  id: string;
  code: string;
  biome: string;
  width: number;
  height: number;
  status: string;
}

interface BuildingView {
  id: string;
  buildingKey: string;
  level: number;
  tileX: number;
  tileY: number;
  rotation: number;
  state: string;
}

/**
 * The main game surface: 3D canvas with the HUD layered over it.
 *
 * Everything shown here is state the server sent. The socket connection exists
 * so that a build finishing, a raid landing, or a wallet change arrives without
 * the client polling - the payload still originates from the database.
 */
export function GameScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { empire, loading, error, load, patch } = useEmpireStore();
  const { territory, load: loadTerritory } = useTerritoryStore();

  const [activeMenu, setActiveMenu] = useState<MenuKey>('empire');
  const [plot, setPlot] = useState<PlotView | null>(null);
  const [buildings, setBuildings] = useState<BuildingView[]>([]);
  const [worldReady, setWorldReady] = useState<boolean | null>(null);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---- realtime --------------------------------------------------------- */
  useEffect(() => {
    if (!user) return;
    const socket = connectSocket();

    const onWallet = (payload: { coins?: string; gems?: string }) => {
      if (!payload) return;
      patch({
        wallet: {
          coins: payload.coins ?? empire?.wallet.coins ?? '0',
          gems: payload.gems ?? empire?.wallet.gems ?? '0',
        },
      });
    };

    // A completed job changes derived state in ways the client cannot compute,
    // so re-read from the server rather than guessing.
    const onRefresh = () => void load();

    socket.on(ServerEvent.WALLET_UPDATED, onWallet);
    socket.on(ServerEvent.RESOURCES_UPDATED, onRefresh);
    socket.on(ServerEvent.BUILDING_UPDATED, onRefresh);
    socket.on(ServerEvent.QUEUE_UPDATED, onRefresh);

    return () => {
      socket.off(ServerEvent.WALLET_UPDATED, onWallet);
      socket.off(ServerEvent.RESOURCES_UPDATED, onRefresh);
      socket.off(ServerEvent.BUILDING_UPDATED, onRefresh);
      socket.off(ServerEvent.QUEUE_UPDATED, onRefresh);
    };
  }, [user, load, patch, empire?.wallet.coins, empire?.wallet.gems]);

  useEffect(() => () => disconnectSocket(), []);

  /* ---- territory -------------------------------------------------------- */
  //
  // The empire view renders the player's home plot. Territory itself is owned
  // by the map's territory store, so both screens read one source rather than
  // each fetching their own copy.
  useEffect(() => {
    if (empire === null) return;
    void loadTerritory();
  }, [empire, loadTerritory]);

  useEffect(() => {
    if (!territory) return;

    const home = territory.home;
    if (!home) {
      setWorldReady(false);
      setPlot(null);
      setBuildings([]);
      return;
    }

    setWorldReady(true);
    setPlot({
      id: home.id,
      code: home.code,
      biome: home.biome,
      width: 10,
      height: 10,
      status: home.status,
    });
  }, [territory]);

  // Buildings on the home plot, for the empire view's 3D scene.
  useEffect(() => {
    if (!plot) {
      setBuildings([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api.get<{ buildingCount: number }>(
          `/plots/${encodeURIComponent(plot.id)}`,
        );
        // Building placement lands in the next phase; until then the count is
        // shown in the HUD and the scene renders the terrain only.
        if (!cancelled) void detail;
      } catch {
        /* the panel already reports territory problems */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plot]);

  const sceneBuildings = useMemo<SceneBuilding[]>(
    () =>
      buildings
        .filter((b) => b.state !== 'DESTROYED')
        .map((b) => ({
          id: b.id,
          buildingKey: b.buildingKey,
          level: b.level,
          tileX: b.tileX,
          tileY: b.tileY,
          rotation: b.rotation,
        })),
    [buildings],
  );

  const resourceRow = useMemo(() => {
    if (!empire) return [];
    return (['WOOD', 'STONE', 'FOOD', 'IRON', 'GOLD'] as const).map((key) => {
      const stock = empire.resources[key] ?? { amount: 0, capacity: 0 };
      const definition = RESOURCE_BY_KEY.get(key);
      return {
        key,
        label: definition?.name ?? key,
        color: definition?.color ?? '#9ca3af',
        amount: stock.amount,
        capacity: stock.capacity,
      };
    });
  }, [empire]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-frontier">
      {/* ---- map takes over the whole surface when selected ---- */}
      {activeMenu === 'map' ? (
        <MapScreen showStats={showStats} />
      ) : (
        <>
      {/* ---- 3D world ---- */}
      <div className="absolute inset-0">
        {worldReady && plot ? (
          <EmpireScene
            seed={plot.code}
            biome={plot.biome as never}
            buildings={sceneBuildings}
            showStats={showStats}
          />
        ) : (
          // No territory yet: a neutral demo terrain so the renderer is
          // visibly working, clearly labelled as not being the player's land.
          <EmpireScene seed="unclaimed-frontier" biome="GRASSLAND" buildings={[]} />
        )}
      </div>

      {/* ---- HUD ---- */}
      <Hud
        empireName={empire?.name ?? user?.profile?.empireName ?? 'Unnamed Empire'}
        commander={user?.username ?? ''}
        level={user?.profile?.level ?? 1}
        coins={empire?.wallet.coins ?? '0'}
        gems={empire?.wallet.gems ?? '0'}
        resources={resourceRow}
        onLogout={logout}
        onToggleStats={() => setShowStats((v) => !v)}
        statsVisible={showStats}
      />

      <SideMenu active={activeMenu} onSelect={setActiveMenu} />

      {/* ---- context panel ---- */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4">
        <div className="pointer-events-auto">
          {loading && !empire ? (
            <Panel>
              <p className="text-sm text-parchment-400">Reading your empire from the server…</p>
            </Panel>
          ) : error ? (
            <Panel title="Could not load your empire">
              <Alert tone="error">{error}</Alert>
              <Button className="mt-3" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </Panel>
          ) : worldReady === false ? (
            <Panel title="Territory not assigned yet">
              <Alert tone="warning" title="The persistent world has not been generated">
                Your account, empire, garrison and treasury are live in PostgreSQL — the HUD
                above is reading real server state. Land, plots and the building editor arrive
                with the world grid in the next phase, and your starter plot is claimed
                automatically the first time you load your empire after that.
              </Alert>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                <Stat label="Headquarters" value={`Lv ${empire?.hqLevel ?? 1}`} />
                <Stat label="Builders" value={String(empire?.builders ?? 1)} />
                <Stat
                  label="Garrison"
                  value={`${empire?.population.used ?? 0} / ${empire?.population.cap ?? 0}`}
                />
                <Stat label="Buildings" value={String(empire?.buildingCount ?? 0)} />
              </dl>
            </Panel>
          ) : plot ? (
            <Panel
              title={`${plot.code}`}
              subtitle={`${plot.width}×${plot.height} tiles · ${plot.biome.toLowerCase()}`}
              actions={<Badge tone="gold">{plot.status}</Badge>}
            >
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                <Stat label="Headquarters" value={`Lv ${empire?.hqLevel ?? 1}`} />
                <Stat label="Builders" value={String(empire?.builders ?? 1)} />
                <Stat
                  label="Garrison"
                  value={`${empire?.population.used ?? 0} / ${empire?.population.cap ?? 0}`}
                />
                <Stat label="Power" value={formatNumber(empire?.empirePower ?? 0)} />
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>

        </>
      )}

      {/* ---- bottom action bar ---- */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex justify-center pb-1">
        <div className="pointer-events-auto flex gap-1 rounded-t-lg border border-b-0 border-ink-700/80 bg-ink-900/90 px-2 py-1.5 backdrop-blur">
          {(
            [
              { key: 'buildings', label: 'Build' },
              { key: 'army', label: 'Army' },
              { key: 'battle', label: 'Attack' },
              { key: 'map', label: 'Map' },
            ] as const
          ).map((action) => (
            <Button
              key={action.key}
              size="sm"
              variant={activeMenu === action.key ? 'primary' : 'ghost'}
              onClick={() => setActiveMenu(action.key as MenuKey)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-parchment-600">{label}</dt>
      <dd className="font-semibold text-parchment-200">{value}</dd>
    </div>
  );
}
