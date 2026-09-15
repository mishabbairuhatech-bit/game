import { Alert, Badge, Button, Panel, Spinner, formatCurrency } from '@empire/ui';
import { usePlotStore } from '../../store/plot.store';
import { plotAppearance } from '../../game/map/plotAppearance';

/**
 * Detail panel for the selected plot.
 *
 * Every action shown here comes from the server's `actions` block. The client
 * never decides on its own that a Buy button should appear - if the API would
 * refuse the purchase, the button is absent and the reason is printed instead.
 * A button that fails is worse than no button.
 */
export function PlotPanel({
  onVisit,
  onClose,
}: {
  onVisit: (x: number, y: number) => void;
  onClose: () => void;
}) {
  const { detail, loading, error, purchasing, purchaseError, purchase } = usePlotStore();

  if (loading && !detail) {
    return (
      <Panel title="Plot">
        <div className="flex items-center gap-2 text-sm text-parchment-400">
          <Spinner className="h-4 w-4" /> Reading the survey…
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Plot" actions={<CloseButton onClose={onClose} />}>
        <Alert tone="error">{error}</Alert>
      </Panel>
    );
  }

  if (!detail) return null;

  const look = plotAppearance(detail.biome, detail.status, detail.isMine);
  const price = Number(detail.price);

  return (
    <Panel
      title={detail.code}
      subtitle={`${detail.regionName} · ${detail.width}×${detail.height} tiles`}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={detail.isMine ? 'gold' : detail.status === 'FREE' ? 'success' : 'neutral'}>
            {detail.statusLabel}
          </Badge>
          <CloseButton onClose={onClose} />
        </div>
      }
    >
      {/* Terrain. The glyph and the written buildability are the non-colour
          encodings - the swatch alone would exclude colour-blind players. */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-ink-600 text-lg"
          style={{ background: detail.terrain.color }}
          aria-hidden="true"
        >
          <span className="text-ink-950">{look.glyph}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-parchment-100">{detail.terrain.label}</p>
          <p className="text-xs leading-snug text-parchment-500">{detail.terrain.description}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Stat label="Coordinates" value={`${detail.x}, ${detail.y}`} />
        <Stat
          label="Buildable"
          value={
            detail.terrain.buildability === 'BUILDABLE'
              ? 'Yes'
              : detail.terrain.buildability === 'CONDITIONAL'
                ? 'With clearing'
                : 'No'
          }
        />
        <Stat label="Usable tiles" value={`${detail.terrain.usableTiles}`} />
        <Stat
          label="Unusable ground"
          value={`${(detail.terrain.unbuildableBps / 100).toFixed(0)}%`}
        />
        <Stat label="Owner" value={detail.ownerName ?? 'Unclaimed'} />
        <Stat label="Buildings" value={String(detail.buildingCount)} />
      </dl>

      {detail.isProtected && (
        <div className="mt-3">
          <Alert tone="info" title="Under new-settler protection">
            This holding cannot be raided until{' '}
            {new Date(detail.protectedUntil ?? '').toLocaleString()}.
          </Alert>
        </div>
      )}

      {/* Price only means something for land the world is still selling. */}
      {detail.status === 'FREE' && price > 0 && (
        <div className="mt-3 flex items-baseline justify-between rounded-md border border-ink-700 bg-ink-950/60 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-parchment-600">
            World price
          </span>
          <span className="font-mono text-base font-semibold tabular-nums text-brass-200">
            {formatCurrency(price)} coins
          </span>
        </div>
      )}

      {purchaseError && (
        <div className="mt-3">
          <Alert tone="error">{purchaseError}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {detail.actions.canBuy && (
          <Button variant="gold" loading={purchasing} onClick={() => void purchase()}>
            Claim for {formatCurrency(price)} coins
          </Button>
        )}

        {detail.actions.canVisit && (
          <Button variant="secondary" onClick={() => onVisit(detail.x, detail.y)}>
            Visit
          </Button>
        )}

        {!detail.actions.canBuy && detail.actions.buyBlockedReason && (
          <p className="self-center text-xs leading-snug text-parchment-500">
            {detail.actions.buyBlockedReason}
          </p>
        )}
      </div>
    </Panel>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close plot details"
      className="rounded border border-ink-600 px-1.5 py-0.5 text-xs text-parchment-400 transition-colors hover:bg-ink-700 hover:text-parchment-100"
    >
      ✕
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-parchment-600">{label}</dt>
      <dd className="font-medium text-parchment-200">{value}</dd>
    </div>
  );
}
