import { create } from 'zustand';
import { api, ApiError } from '../lib/api';

export interface ResourceStock {
  amount: number;
  capacity: number;
}

export interface EmpireSummary {
  id: string;
  name: string;
  hqLevel: number;
  builders: number;
  empirePower: number;
  population: { used: number; cap: number };
  resources: Record<string, ResourceStock>;
  wallet: { coins: string; gems: string };
  plotCount: number;
  buildingCount: number;
  lastAccrualAt: string;
}

interface EmpireState {
  empire: EmpireSummary | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  /** Applied when the server pushes a wallet or resource change over the socket. */
  patch: (partial: Partial<EmpireSummary>) => void;
  reset: () => void;
}

/**
 * Mirror of the server's empire state.
 *
 * This store is strictly a *cache of what the server said*. Nothing in the
 * client ever increments a resource or spends a coin locally - every change
 * arrives either as the response to a mutation or as a socket push, both of
 * which originate from the database.
 */
export const useEmpireStore = create<EmpireState>((set) => ({
  empire: null,
  loading: false,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const empire = await api.get<EmpireSummary>('/players/me/empire');
      set({ empire, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof ApiError ? error.message : 'Could not load your empire.',
      });
    }
  },

  patch(partial) {
    set((state) => (state.empire ? { empire: { ...state.empire, ...partial } } : state));
  },

  reset() {
    set({ empire: null, loading: false, error: null });
  },
}));
