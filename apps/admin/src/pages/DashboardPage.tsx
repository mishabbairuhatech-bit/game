import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Panel, Spinner, formatNumber } from '@empire/ui';
import { api, ApiError } from '../lib/api';

interface AdminOverview {
  users: {
    total: number;
    active: number;
    pendingVerification: number;
    banned: number;
    newToday: number;
  };
  empires: { total: number; totalPower: number };
  world: {
    worlds: number;
    regions: number;
    zones: number;
    plots: number;
    ownedPlots: number;
    freePlots: number;
  };
  catalogue: {
    buildings: number;
    buildingLevels: number;
    units: number;
    quests: number;
    achievements: number;
  };
  economy: { coinsInCirculation: string; gemsInCirculation: string; ledgerEntries: number };
  marketplace: { activeListings: number; settledTransactions: number };
  moderation: { openReports: number; unreviewedSuspicions: number };
  battles: { total: number; inProgress: number };
  generatedAt: string;
}

export function DashboardPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AdminOverview>('/admin/overview'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The API caches this for 15s; polling every 30s keeps the panel fresh
    // without generating load.
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          data ? `Counters as of ${new Date(data.generatedAt).toLocaleTimeString()}` : undefined
        }
        action={
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert tone="error" title="Could not load counters">
          {error}
        </Alert>
      )}

      {!data && loading && (
        <div className="flex items-center gap-2 text-sm text-parchment-500">
          <Spinner className="h-4 w-4" /> Reading aggregates…
        </div>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Panel title="Players">
            <StatGrid
              stats={[
                { label: 'Accounts', value: formatNumber(data.users.total) },
                { label: 'Active', value: formatNumber(data.users.active) },
                { label: 'Unverified', value: formatNumber(data.users.pendingVerification) },
                { label: 'Banned', value: formatNumber(data.users.banned) },
                { label: 'New today', value: formatNumber(data.users.newToday) },
                { label: 'Empires', value: formatNumber(data.empires.total) },
              ]}
            />
          </Panel>

          <Panel
            title="World"
            actions={
              data.world.worlds === 0 ? <Badge tone="danger">Not generated</Badge> : undefined
            }
          >
            {data.world.worlds === 0 ? (
              <Alert tone="warning" title="No world has been generated">
                The region/zone/plot grid is created by the Phase 2 world generator. Until then
                new accounts receive an empire and garrison but no territory.
              </Alert>
            ) : (
              <StatGrid
                stats={[
                  { label: 'Regions', value: formatNumber(data.world.regions) },
                  { label: 'Zones', value: formatNumber(data.world.zones) },
                  { label: 'Plots', value: formatNumber(data.world.plots) },
                  { label: 'Owned', value: formatNumber(data.world.ownedPlots) },
                  { label: 'Free', value: formatNumber(data.world.freePlots) },
                  {
                    label: 'Occupancy',
                    value:
                      data.world.plots > 0
                        ? `${((data.world.ownedPlots / data.world.plots) * 100).toFixed(1)}%`
                        : '—',
                  },
                ]}
              />
            )}
          </Panel>

          <Panel title="Economy">
            <StatGrid
              stats={[
                {
                  label: 'Coins in circulation',
                  value: formatNumber(Number(data.economy.coinsInCirculation)),
                },
                {
                  label: 'Gems in circulation',
                  value: formatNumber(Number(data.economy.gemsInCirculation)),
                },
                { label: 'Ledger entries', value: formatNumber(data.economy.ledgerEntries) },
                {
                  label: 'Active listings',
                  value: formatNumber(data.marketplace.activeListings),
                },
                {
                  label: 'Settled sales',
                  value: formatNumber(data.marketplace.settledTransactions),
                },
              ]}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-parchment-600">
              Every currency movement in the game appends one ledger row inside the same
              transaction as the balance change, so circulation is always reconcilable
              against the ledger.
            </p>
          </Panel>

          <Panel title="Catalogue">
            <StatGrid
              stats={[
                { label: 'Buildings', value: formatNumber(data.catalogue.buildings) },
                { label: 'Building levels', value: formatNumber(data.catalogue.buildingLevels) },
                { label: 'Units', value: formatNumber(data.catalogue.units) },
                { label: 'Quests', value: formatNumber(data.catalogue.quests) },
                { label: 'Achievements', value: formatNumber(data.catalogue.achievements) },
              ]}
            />
          </Panel>

          <Panel title="Combat">
            <StatGrid
              stats={[
                { label: 'Battles', value: formatNumber(data.battles.total) },
                { label: 'In progress', value: formatNumber(data.battles.inProgress) },
              ]}
            />
          </Panel>

          <Panel
            title="Moderation"
            actions={
              data.moderation.openReports + data.moderation.unreviewedSuspicions > 0 ? (
                <Badge tone="danger">Attention</Badge>
              ) : (
                <Badge tone="success">Clear</Badge>
              )
            }
          >
            <StatGrid
              stats={[
                { label: 'Open reports', value: formatNumber(data.moderation.openReports) },
                {
                  label: 'Unreviewed flags',
                  value: formatNumber(data.moderation.unreviewedSuspicions),
                },
              ]}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl text-parchment-100">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-parchment-500">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt className="text-[10px] uppercase tracking-wider text-parchment-600">
            {stat.label}
          </dt>
          <dd className="font-mono text-base font-semibold tabular-nums text-parchment-100">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
