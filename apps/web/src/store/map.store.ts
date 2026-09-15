import { create } from 'zustand';
import type { Biome, PlotStatus } from '@empire/shared';
import { MAX_VIEWPORT_PLOTS, clampBounds, DEFAULT_WORLD_GEOMETRY } from '@empire/game-data';
import { api, ApiError } from '../lib/api';

/**
 * Map state: what the camera is looking at, and the plots streamed for it.
 *
 * The streaming rule is the important part. The world has 10 000 plots and the
 * server caps any single viewport query at 2 500, so the client must never ask
 * for "everything". Instead it asks for the rectangle the camera can see,
 * padded by one screen so a pan does not immediately hit an empty region, and
 * keeps a bounded cache of what it already has.
 */

export interface PlotTile {
  id: string;
  code: string;
  x: number;
  y: number;
  biome: Biome;
  status: PlotStatus;
  price: string;
  isForSale: boolean;
  isBuildable: boolean;
  ownerName: string | null;
  isMine: boolean;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Camera target in plot coordinates, plus its height. */
export interface CameraTarget {
  x: number;
  y: number;
  /** Orbit distance. Larger is further out. */
  distance: number;
  /** Set when the camera should animate to the target rather than jump. */
  animate: boolean;
  /** Bumped on every request so the scene can react to repeat targets. */
  nonce: number;
}

/**
 * Beyond this camera distance the plot layer is replaced by region tiles.
 * At that height individual 1-unit plots are sub-pixel anyway, so drawing
 * 2 500 of them buys nothing but draw calls.
 */
export const REGION_LOD_DISTANCE = 260;

/** How many plots of padding to stream beyond the visible rectangle. */
const VIEWPORT_PADDING = 4;

/** Cache ceiling. Older tiles are evicted once the map has been panned far. */
const MAX_CACHED_TILES = 12000;

interface MapState {
  /** Every tile currently held, keyed "x:y". */
  tiles: Map<string, PlotTile>;
  /** The last bounds actually fetched, so a small pan does not refetch. */
  loadedBounds: Bounds | null;
  loading: boolean;
  error: string | null;
  /** True when the server narrowed the request - the client should zoom out. */
  truncated: boolean;

  cameraTarget: CameraTarget | null;
  /** Filters applied to the streamed tiles. */
  statusFilter: PlotStatus[];
  biomeFilter: Biome[];

  /**
   * Streams the plots for a viewport.
   *
   * Resolves `true` when the viewport is now covered (either it was fetched,
   * or it already sat inside the last fetch), and `false` when the request was
   * dropped because another was in flight. The caller must not treat a dropped
   * request as handled, or a camera that stops at that moment leaves a
   * permanent hole in the map.
   */
  streamViewport: (bounds: Bounds, force?: boolean) => Promise<boolean>;
  /** Replaces one tile in place, e.g. after a purchase or a socket push. */
  patchTile: (tile: PlotTile) => void;
  focusOn: (x: number, y: number, distance?: number, animate?: boolean) => void;
  setStatusFilter: (statuses: PlotStatus[]) => void;
  setBiomeFilter: (biomes: Biome[]) => void;
  clearCache: () => void;
}

const key = (x: number, y: number) => `${x}:${y}`;

/** Does `outer` fully contain `inner`? */
function covers(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

export const useMapStore = create<MapState>((set, get) => ({
  tiles: new Map(),
  loadedBounds: null,
  loading: false,
  error: null,
  truncated: false,
  cameraTarget: null,
  statusFilter: [],
  biomeFilter: [],

  async streamViewport(bounds, force = false) {
    const state = get();

    // Already covered by the last fetch, and nothing has changed.
    if (!force && state.loadedBounds && covers(state.loadedBounds, bounds)) return true;

    // A fetch is already in flight. Report the drop so the caller retries.
    if (state.loading) return false;

    // Pad so a small pan does not immediately hit unloaded ground, then clamp
    // with the same function the server uses. Sending a window the server
    // would only narrow makes `truncated` fire on every request and turns a
    // real "you are zoomed too far out" signal into noise.
    const { bounds: padded } = clampBounds(
      DEFAULT_WORLD_GEOMETRY,
      {
        minX: Math.max(0, Math.floor(bounds.minX) - VIEWPORT_PADDING),
        minY: Math.max(0, Math.floor(bounds.minY) - VIEWPORT_PADDING),
        maxX: Math.ceil(bounds.maxX) + VIEWPORT_PADDING,
        maxY: Math.ceil(bounds.maxY) + VIEWPORT_PADDING,
      },
      MAX_VIEWPORT_PLOTS,
    );

    set({ loading: true, error: null });

    try {
      const result = await api.get<{
        plots: PlotTile[];
        bounds: Bounds;
        total: number;
        truncated: boolean;
      }>('/world/plots', {
        query: {
          minX: padded.minX,
          minY: padded.minY,
          maxX: padded.maxX,
          maxY: padded.maxY,
          status: state.statusFilter.length ? state.statusFilter.join(',') : undefined,
          biome: state.biomeFilter.length ? state.biomeFilter.join(',') : undefined,
        },
      });

      set((current) => {
        const tiles = new Map(current.tiles);

        // Evict before inserting, so a long pan session cannot grow without
        // bound. Tiles inside the new viewport are always kept.
        if (tiles.size > MAX_CACHED_TILES) {
          for (const [k, tile] of tiles) {
            const inside =
              tile.x >= result.bounds.minX &&
              tile.x <= result.bounds.maxX &&
              tile.y >= result.bounds.minY &&
              tile.y <= result.bounds.maxY;
            if (!inside) tiles.delete(k);
            if (tiles.size <= MAX_CACHED_TILES / 2) break;
          }
        }

        for (const plot of result.plots) tiles.set(key(plot.x, plot.y), plot);

        return {
          tiles,
          loadedBounds: result.bounds,
          truncated: result.truncated,
          loading: false,
        };
      });
      return true;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof ApiError ? error.message : 'Could not load the map.',
      });
      return false;
    }
  },

  patchTile(tile) {
    set((current) => {
      const tiles = new Map(current.tiles);
      tiles.set(key(tile.x, tile.y), tile);
      return { tiles };
    });
  },

  focusOn(x, y, distance, animate = true) {
    set((current) => ({
      cameraTarget: {
        x,
        y,
        distance: distance ?? current.cameraTarget?.distance ?? 60,
        animate,
        nonce: (current.cameraTarget?.nonce ?? 0) + 1,
      },
    }));
  },

  setStatusFilter(statuses) {
    // Filters change what the server returns, so the cache is no longer valid.
    set({ statusFilter: statuses, loadedBounds: null, tiles: new Map() });
  },

  setBiomeFilter(biomes) {
    set({ biomeFilter: biomes, loadedBounds: null, tiles: new Map() });
  },

  clearCache() {
    set({ tiles: new Map(), loadedBounds: null, truncated: false });
  },
}));
