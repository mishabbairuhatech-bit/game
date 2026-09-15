import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import type { PlotTile } from './map.store';

/** Player territory state: what this commander holds, and where "home" is. */

export interface TerritoryView {
  empire: { id: string; name: string } | null;
  plots: PlotTile[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  home: PlotTile | null;
  totalPlots: number;
  maxPlots: number;
  canExpand: boolean;
  expansionBlockedReason: string | null;
}

interface TerritoryState {
  territory: TerritoryView | null;
  nearby: PlotTile[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  loadNearby: () => Promise<void>;
  reset: () => void;
}

export const useTerritoryStore = create<TerritoryState>((set) => ({
  territory: null,
  nearby: [],
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const territory = await api.get<TerritoryView>('/player/territory');
      set({ territory, loading: false });
    } catch (error) {
      // A player with no world yet is a normal state, not a failure to report.
      const missing = error instanceof ApiError && error.status === 404;
      set({
        loading: false,
        territory: null,
        error: missing
          ? null
          : error instanceof ApiError
            ? error.message
            : 'Could not load your territory.',
      });
    }
  },

  /**
   * The expansion shortlist.
   *
   * The server returns exactly the plots its purchase endpoint would accept,
   * so anything shown here is genuinely claimable - no Buy button that fails.
   */
  async loadNearby() {
    try {
      const nearby = await api.get<PlotTile[]>('/player/territory/nearby');
      set({ nearby });
    } catch {
      set({ nearby: [] });
    }
  },

  reset() {
    set({ territory: null, nearby: [], loading: false, error: null });
  },
}));
