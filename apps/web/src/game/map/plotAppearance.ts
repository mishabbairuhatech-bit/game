import type { Biome, PlotStatus } from '@empire/shared';
import { TERRAIN_RULES } from '@empire/game-data';
import { PLOT_STATUS_LABEL } from '@empire/game-engine';

/**
 * How a plot looks on the map.
 *
 * Status is encoded three ways on purpose - colour, height and edge - because
 * colour alone excludes players with a colour-vision deficiency, and a map
 * where "mine" and "someone else's" differ only in hue is unusable for them.
 * The detail panel adds the fourth encoding: a text label.
 */

export interface PlotAppearance {
  /** Base ground colour, from the biome. */
  color: string;
  /** Edge colour, from the status. */
  edge: string;
  /** Vertical offset in world units. Owned land stands proud of free land. */
  height: number;
  /** Non-colour glyph for the legend and for close-zoom labels. */
  glyph: string;
  label: string;
  /** Dimmed for ground nobody can ever claim. */
  opacity: number;
}

/** Status ring colours. Chosen to stay distinguishable in greyscale too. */
const STATUS_EDGE: Record<PlotStatus, string> = {
  FREE: '#3a4356',
  STARTER: '#f2cd6d',
  OWNED: '#e6b13f',
  FOR_SALE: '#4fc98a',
  LOCKED: '#6b7280',
  PROTECTED: '#7dd3fc',
  EVENT: '#c084fc',
  UNAVAILABLE: '#252b38',
};

/**
 * Relief by status, in world units.
 *
 * Claimed land is raised so ownership is legible from the silhouette at a
 * glance, before any colour is processed - which also means it survives a
 * screenshot in greyscale.
 */
const STATUS_HEIGHT: Record<PlotStatus, number> = {
  FREE: 0.08,
  STARTER: 0.55,
  OWNED: 0.42,
  FOR_SALE: 0.34,
  LOCKED: 0.12,
  PROTECTED: 0.3,
  EVENT: 0.3,
  UNAVAILABLE: 0.02,
};

const STATUS_GLYPH: Record<PlotStatus, string> = {
  FREE: '·',
  STARTER: '★',
  OWNED: '■',
  FOR_SALE: '$',
  LOCKED: '✕',
  PROTECTED: '⛨',
  EVENT: '✦',
  UNAVAILABLE: '≈',
};

export function plotAppearance(
  biome: Biome,
  status: PlotStatus,
  isMine: boolean,
): PlotAppearance {
  const rule = TERRAIN_RULES[biome];

  return {
    // Land the player owns is tinted towards brass so their empire reads as
    // one shape rather than as a scatter of individually-coloured biomes.
    color: isMine ? mix(rule.color, '#e6b13f', 0.38) : rule.color,
    edge: isMine ? '#f2cd6d' : STATUS_EDGE[status],
    height: STATUS_HEIGHT[status],
    glyph: status === 'FREE' ? rule.glyph : STATUS_GLYPH[status],
    label: `${rule.label} · ${PLOT_STATUS_LABEL[status]}`,
    opacity: status === 'UNAVAILABLE' ? 0.75 : 1,
  };
}

/** Linear blend of two hex colours. `t` is 0 (a) to 1 (b). */
export function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Legend entries for the map key. */
export const STATUS_LEGEND: {
  status: PlotStatus;
  label: string;
  glyph: string;
  edge: string;
}[] = (
  ['FREE', 'STARTER', 'OWNED', 'FOR_SALE', 'PROTECTED', 'LOCKED', 'UNAVAILABLE'] as PlotStatus[]
).map((status) => ({
  status,
  label: PLOT_STATUS_LABEL[status],
  glyph: STATUS_GLYPH[status],
  edge: STATUS_EDGE[status],
}));
