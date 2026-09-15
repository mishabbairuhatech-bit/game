import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Panel, Spinner } from '@empire/ui';
import { ROLE_RANK, type UserRole } from '@empire/shared';
import { api, ApiError } from '../lib/api';
import { PageHeader } from './DashboardPage';

interface ConfigEntry {
  key: string;
  value: string;
  valueType: string;
  description: string;
  group: string;
  defaultValue: string | null;
  overridden: boolean;
  updatedAt: string | null;
}

const GROUP_LABELS: Record<string, string> = {
  economy: 'Economy & starting grants',
  land: 'Land & expansion',
  marketplace: 'Marketplace',
  combat: 'Combat balance',
  anticheat: 'Anti-cheat thresholds',
  progression: 'Progression curve',
  chat: 'Chat limits',
  general: 'General',
};

/**
 * Live game tuning.
 *
 * These values are read through the API's ConfigService on every gameplay
 * decision, so a change here takes effect across every replica without a
 * deploy. Each save is validated server-side against the key's declared type
 * and recorded in the audit log with the before/after values.
 */
export function GameConfigPage({ role }: { role: UserRole }) {
  const canEdit = ROLE_RANK[role] >= ROLE_RANK.ADMIN;

  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ConfigEntry[]>('/admin/config');
      setEntries(result);
      setDrafts({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ConfigEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const save = async (entry: ConfigEntry) => {
    const value = drafts[entry.key];
    if (value === undefined || value === entry.value) return;

    setSaving(entry.key);
    setRowError((prev) => ({ ...prev, [entry.key]: '' }));
    try {
      const updated = await api.patch<ConfigEntry>(`/admin/config/${entry.key}`, { value });
      setEntries((prev) => prev.map((e) => (e.key === updated.key ? updated : e)));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[entry.key];
        return next;
      });
      setSaved(entry.key);
      window.setTimeout(() => setSaved(null), 2200);
    } catch (e) {
      setRowError((prev) => ({
        ...prev,
        [entry.key]: e instanceof ApiError ? e.message : 'Could not save.',
      }));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Game configuration"
        subtitle="Balance values read by the server on every gameplay decision."
        action={
          <Button size="sm" variant="secondary" onClick={() => void load()} loading={loading}>
            Reload
          </Button>
        }
      />

      {!canEdit && (
        <Alert tone="info" title="Read-only">
          Editing configuration requires the ADMIN role. Your current role can view these
          values but not change them.
        </Alert>
      )}

      {error && (
        <Alert tone="error" title="Could not load configuration">
          {error}
        </Alert>
      )}

      {loading && entries.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-parchment-500">
          <Spinner className="h-4 w-4" /> Loading values…
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {grouped.map(([group, groupEntries]) => (
          <Panel key={group} title={GROUP_LABELS[group] ?? group} flush>
            <div className="divide-y divide-ink-800">
              {groupEntries.map((entry) => {
                const draft = drafts[entry.key] ?? entry.value;
                const dirty = draft !== entry.value;

                return (
                  <div
                    key={entry.key}
                    className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-xs font-semibold text-brass-200">{entry.key}</code>
                        <Badge tone="neutral">{entry.valueType}</Badge>
                        {entry.overridden && <Badge tone="gold">overridden</Badge>}
                        {saved === entry.key && <Badge tone="success">saved</Badge>}
                      </div>
                      <p className="mt-1 text-xs leading-snug text-parchment-500">
                        {entry.description}
                      </p>
                      {entry.defaultValue !== null && entry.overridden && (
                        <p className="mt-1 text-[11px] text-parchment-600">
                          Shipped default:{' '}
                          <code className="text-parchment-400">{entry.defaultValue}</code>
                        </p>
                      )}
                      {rowError[entry.key] && (
                        <p className="mt-1 text-[11px] text-ember-400">{rowError[entry.key]}</p>
                      )}
                    </div>

                    <div className="flex items-start gap-2">
                      {entry.valueType === 'boolean' ? (
                        <select
                          disabled={!canEdit}
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))
                          }
                          className="h-9 flex-1 rounded-md border border-ink-600 bg-ink-950/70 px-2 text-sm text-parchment-100 disabled:opacity-50"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          disabled={!canEdit}
                          type={entry.valueType === 'number' ? 'number' : 'text'}
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))
                          }
                          className="h-9 flex-1 rounded-md border border-ink-600 bg-ink-950/70 px-2 font-mono text-sm tabular-nums text-parchment-100 focus:border-brass-500 focus:outline-none focus:ring-1 focus:ring-brass-400 disabled:opacity-50"
                        />
                      )}
                      <Button
                        size="sm"
                        disabled={!canEdit || !dirty}
                        loading={saving === entry.key}
                        onClick={() => void save(entry)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      {entries.length > 0 && (
        <p className="mt-5 text-[11px] leading-relaxed text-parchment-600">
          Changes propagate to every API replica within the configuration cache TTL (60
          seconds). In-flight jobs — construction, upgrades, training queues — keep the cost
          and duration that were snapshotted when they started, so a balance change never
          retroactively alters something a player already paid for.
        </p>
      )}
    </div>
  );
}
