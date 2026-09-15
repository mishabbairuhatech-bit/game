import { create } from 'zustand';
import type { Biome, PlotStatus } from '@empire/shared';
import { api, ApiError } from '../lib/api';
import { useMapStore, type PlotTile } from './map.store';

/**
 * Plot state: the one plot the player has selected, and the actions on it.
 *
 * Kept apart from map state because selecting a plot must not invalidate the
 * streamed tile cache, and a viewport stream must not disturb an open detail
 * panel.
 */

export interface PlotDetail extends PlotTile {
  regionId: string;
  zoneId: string;
  regionName: string;
  width: number;
  height: number;
  tileX: number;
  tileY: number;
  terrain: {
    label: string;
    description: string;
    buildability: string;
    glyph: string;
    pattern: string;
    color: string;
    unbuildableBps: number;
    usableTiles: number;
  };
  statusLabel: string;
  isProtected: boolean;
  protectedUntil: string | null;
  buildingCount: number;
  actions: {
    canView: boolean;
    canVisit: boolean;
    canBuy: boolean;
    buyBlockedReason: string | null;
  };
}

interface PlotState {
  selectedId: string | null;
  detail: PlotDetail | null;
  loading: boolean;
  error: string | null;

  /** Set while a purchase is in flight, so the button cannot be double-fired. */
  purchasing: boolean;
  purchaseError: string | null;
  lastPurchase: { code: string; pricePaid: string; coinsRemaining: string } | null;

  select: (idOrCode: string) => Promise<void>;
  clear: () => void;
  purchase: () => Promise<boolean>;
}

export const usePlotStore = create<PlotState>((set, get) => ({
  selectedId: null,
  detail: null,
  loading: false,
  error: null,
  purchasing: false,
  purchaseError: null,
  lastPurchase: null,

  async select(idOrCode) {
    set({ selectedId: idOrCode, loading: true, error: null, purchaseError: null });
    try {
      const detail = await api.get<PlotDetail>(`/plots/${encodeURIComponent(idOrCode)}`);
      // Guard against a slow response for a plot the player has since
      // deselected or replaced with another.
      if (get().selectedId !== idOrCode) return;
      set({ detail, loading: false });
    } catch (error) {
      if (get().selectedId !== idOrCode) return;
      set({
        loading: false,
        detail: null,
        error: error instanceof ApiError ? error.message : 'Could not load that plot.',
      });
    }
  },

  clear() {
    set({ selectedId: null, detail: null, error: null, purchaseError: null });
  },

  /**
   * Claims the selected plot.
   *
   * The request carries only the plot id - price and eligibility are the
   * server's to decide. On success the map tile is patched in place so the
   * new ownership shows immediately without re-streaming the viewport.
   */
  async purchase() {
    const detail = get().detail;
    if (!detail || get().purchasing) return false;

    set({ purchasing: true, purchaseError: null });
    try {
      const result = await api.post<{
        plot: PlotTile;
        pricePaid: string;
        coinsRemaining: string;
        transactionId: string;
      }>('/player/territory/purchase', { plotId: detail.id });

      useMapStore.getState().patchTile({ ...result.plot, isMine: true });

      set({
        purchasing: false,
        lastPurchase: {
          code: result.plot.code,
          pricePaid: result.pricePaid,
          coinsRemaining: result.coinsRemaining,
        },
      });

      // Re-read the plot so the panel shows its new status and action set.
      await get().select(detail.id);
      return true;
    } catch (error) {
      set({
        purchasing: false,
        purchaseError:
          error instanceof ApiError ? error.message : 'Could not claim that plot.',
      });
      return false;
    }
  },
}));

/** Convenience for components that only need to know if a tile is selected. */
export function isSelected(tile: { id: string }, selectedId: string | null): boolean {
  return selectedId !== null && tile.id === selectedId;
}

export type { Biome, PlotStatus };
