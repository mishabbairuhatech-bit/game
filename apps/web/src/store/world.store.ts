import { create } from 'zustand';
import type { Biome } from '@empire/shared';
import { api, ApiError } from '../lib/api';

/**
 * World state: the static shape of the map.
 *
 * Deliberately separate from map (camera/viewport), plot (selection) and
 * player (territory) state. The world's geometry changes once, at generation;
 * the camera changes sixty times a second. Putting both in one store means
 * every pan re-renders anything that reads the geometry.
 */

export interface WorldMeta {
  id: string;
  slug: string;
  name: string;
  seed: string;
  width: number;
  height: number;
  regionSize: number;
  zoneSize: number;
  plotSize: number;
  status: string;
  counts: {
    regionsPerSide: number;
    zonesPerSide: number;
    plotsPerSide: number;
    totalRegions: number;
    totalZones: number;
    totalPlots: number;
  };
  statistics: { claimedPlots: number; freePlots: number; unavailablePlots: number };
  generatedAt: string | null;
}

export interface RegionSummary {
  id: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  name: string;
  biome: Biome;
  priceModifierBps: number;
}

interface WorldState {
  world: WorldMeta | null;
  regions: RegionSummary[];
  loading: boolean;
  /** Null when the world simply has not been generated yet, which is not an error. */
  error: string | null;
  notGenerated: boolean;

  load: () => Promise<void>;
  reset: () => void;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  world: null,
  regions: [],
  loading: false,
  error: null,
  notGenerated: false,

  async load() {
    if (get().loading) return;
    set({ loading: true, error: null });

    try {
      // Regions are the far-zoom layer and there are only a hundred of them,
      // so they are fetched once alongside the world rather than streamed.
      const [world, regions] = await Promise.all([
        api.get<WorldMeta>('/world'),
        api.get<RegionSummary[]>('/world/regions'),
      ]);
      set({ world, regions, loading: false, notGenerated: false });
    } catch (error) {
      const missing = error instanceof ApiError && error.status === 404;
      set({
        loading: false,
        notGenerated: missing,
        error: missing
          ? null
          : error instanceof ApiError
            ? error.message
            : 'Could not load the world.',
      });
    }
  },

  reset() {
    set({ world: null, regions: [], loading: false, error: null, notGenerated: false });
  },
}));
