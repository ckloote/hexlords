// UI colors and banner shapes from the content pack, so a reskin restyles the
// interface without code changes. Checked against the pack it decorates.

import type { ContentPack } from '../engine/content';
import { FEATURES } from '../engine/content';

export const BANNER_SHAPES = ['rounded-square', 'diamond', 'circle', 'triangle'] as const;
export type BannerShape = (typeof BANNER_SHAPES)[number];

export interface Theme {
  terrain: Record<string, string>;
  features: Record<(typeof FEATURES)[number], string>;
  factions: Record<string, { color: string; shape: BannerShape }>;
  ui: { background: string; text: string; path: string; good: string; danger: string; neutral: string };
}

const COLOR = /^#[0-9a-f]{6}$/i;

function color(v: unknown, where: string): string {
  if (typeof v !== 'string' || !COLOR.test(v)) throw new Error(`Invalid theme: ${where} must be a #RRGGBB color`);
  return v;
}

export function loadTheme(raw: unknown, content: ContentPack): Theme {
  const r = raw as Partial<Record<keyof Theme, Record<string, unknown>>>;
  const theme: Theme = {
    terrain: {},
    features: {} as Theme['features'],
    factions: {},
    ui: {} as Theme['ui'],
  };
  for (const id of Object.keys(content.terrain)) theme.terrain[id] = color(r.terrain?.[id], `terrain.${id}`);
  for (const f of FEATURES) theme.features[f] = color(r.features?.[f], `features.${f}`);
  for (const id of Object.keys(content.factions)) {
    const f = r.factions?.[id] as { color?: unknown; shape?: unknown } | undefined;
    const shape = f?.shape as BannerShape;
    if (!BANNER_SHAPES.includes(shape)) throw new Error(`Invalid theme: factions.${id}.shape "${String(f?.shape)}"`);
    theme.factions[id] = { color: color(f?.color, `factions.${id}.color`), shape };
  }
  for (const k of ['background', 'text', 'path', 'good', 'danger', 'neutral'] as const) {
    theme.ui[k] = color(r.ui?.[k], `ui.${k}`);
  }
  return theme;
}
