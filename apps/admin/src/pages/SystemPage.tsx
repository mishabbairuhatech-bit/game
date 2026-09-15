import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Panel, Spinner, formatDuration } from '@empire/ui';
import { api, ApiError } from '../lib/api';
import { PageHeader } from './DashboardPage';

interface SystemStatus {
  api: { version: string; env: string; uptimeSeconds: number };
  database: {
    reachable: boolean;
    latencyMs: number | null;
    migrations: number;
    sizeBytes: string | null;
  };
  redis: {
    reachable: boolean;
    latencyMs: number | null;
    usedMemory: string | null;
    keys: number | null;
  };
  features: {
    googleOAuth: boolean;
    paymentProvider: string;
    swagger: boolean;
    requireVerifiedEmail: boolean;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function SystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.get<SystemStatus>('/admin/system'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read system status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="System health"
        subtitle="Live status of the API and its backing services."
        action={
          <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert tone="error" title="Could not read status">
          {error}
        </Alert>
      )}

      {!status && loading && (
        <div className="flex items-center gap-2 text-sm text-parchment-500">
          <Spinner className="h-4 w-4" /> Probing services…
        </div>
      )}

      {status && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="API"
            actions={<Badge tone={status.api.env === 'production' ? 'gold' : 'info'}>{status.api.env}</Badge>}
          >
            <Row label="Version" value={status.api.version} />
            <Row label="Uptime" value={formatDuration(status.api.uptimeSeconds)} />
          </Panel>

          <Panel
            title="PostgreSQL"
            actions={
              <Badge tone={status.database.reachable ? 'success' : 'danger'}>
                {status.database.reachable ? 'reachable' : 'down'}
              </Badge>
            }
          >
            <Row
              label="Round trip"
              value={status.database.latencyMs === null ? '—' : `${status.database.latencyMs} ms`}
            />
            <Row label="Applied migrations" value={String(status.database.migrations)} />
            <Row
              label="Database size"
              value={
                status.database.sizeBytes === null
                  ? '—'
                  : formatBytes(Number(status.database.sizeBytes))
              }
            />
            {status.database.migrations === 0 && (
              <Alert tone="warning" title="No migration history">
                The schema was applied with <code>prisma db push</code> rather than a
                migration. Generate a migration before deploying to production.
              </Alert>
            )}
          </Panel>

          <Panel
            title="Redis"
            actions={
              <Badge tone={status.redis.reachable ? 'success' : 'danger'}>
                {status.redis.reachable ? 'reachable' : 'down'}
              </Badge>
            }
          >
            <Row
              label="Round trip"
              value={status.redis.latencyMs === null ? '—' : `${status.redis.latencyMs} ms`}
            />
            <Row
              label="Memory used"
              value={
                status.redis.usedMemory === null ? '—' : formatBytes(Number(status.redis.usedMemory))
              }
            />
            <Row label="Keys" value={status.redis.keys === null ? '—' : String(status.redis.keys)} />
          </Panel>

          <Panel title="Enabled features" className="lg:col-span-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Feature
                label="Google OAuth"
                on={status.features.googleOAuth}
                offHint="Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable."
              />
              <Feature
                label="Email verification required"
                on={status.features.requireVerifiedEmail}
                offHint="Players can play before confirming their address (dev default)."
              />
              <Feature
                label="OpenAPI docs"
                on={status.features.swagger}
                offHint="Disabled — set SWAGGER_ENABLED=true to expose /docs."
              />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-parchment-600">
                  Payment provider
                </p>
                <p className="mt-0.5">
                  <Badge tone={status.features.paymentProvider === 'none' ? 'neutral' : 'gold'}>
                    {status.features.paymentProvider}
                  </Badge>
                </p>
                {status.features.paymentProvider === 'none' && (
                  <p className="mt-1 text-[11px] text-parchment-600">
                    Premium purchases are disabled until a provider is configured.
                  </p>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-800 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-parchment-600">{label}</span>
      <span className="font-mono text-sm tabular-nums text-parchment-100">{value}</span>
    </div>
  );
}

function Feature({ label, on, offHint }: { label: string; on: boolean; offHint: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-parchment-600">{label}</p>
      <p className="mt-0.5">
        <Badge tone={on ? 'success' : 'neutral'}>{on ? 'enabled' : 'disabled'}</Badge>
      </p>
      {!on && <p className="mt-1 text-[11px] text-parchment-600">{offHint}</p>}
    </div>
  );
}
