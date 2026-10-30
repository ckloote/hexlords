// The map: terrain per hex, roads/bridges/fords, and sites. Plain JSON data.

import { type Hex, fromOffset, hexKey, toOffset } from './hex';
import type { PlayerId } from './types';

export type Feature = 'road' | 'bridge' | 'ford';
export type CityTier = 'village' | 'city' | 'capital';

export interface Site {
  id: string;
  kind: 'city';
  name: string;
  pos: Hex;
  tier: CityTier;
  /** Owner at the start of the game; null for neutral. Capture comes in milestone 4. */
  owner: PlayerId | null;
}

export interface MapState {
  width: number;
  height: number;
  /** Terrain ids, row-major in odd-r offset order: index = row * width + col. */
  terrain: string[];
  /** Keyed by hexKey. */
  features: Record<string, Feature>;
  sites: Site[];
}

export function inBounds(map: MapState, h: Hex): boolean {
  const { col, row } = toOffset(h);
  return col >= 0 && row >= 0 && col < map.width && row < map.height;
}

/** Terrain id at `h`, or undefined off the map. */
export function terrainAt(map: MapState, h: Hex): string | undefined {
  if (!inBounds(map, h)) return undefined;
  const { col, row } = toOffset(h);
  return map.terrain[row * map.width + col];
}

export function featureAt(map: MapState, h: Hex): Feature | undefined {
  return map.features[hexKey(h)];
}

export function siteAt(map: MapState, h: Hex): Site | undefined {
  return map.sites.find((s) => s.pos.q === h.q && s.pos.r === h.r);
}

/** Every hex on the map, in row-major order. */
export function allHexes(map: MapState): Hex[] {
  const out: Hex[] = [];
  for (let row = 0; row < map.height; row++) for (let col = 0; col < map.width; col++) out.push(fromOffset(col, row));
  return out;
}
