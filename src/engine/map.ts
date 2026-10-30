// The map: terrain per hex, roads/bridges/fords, and sites. Plain JSON data.

import { type Hex, fromOffset, hexKey, toOffset } from './hex';
import type { CityState, PlayerId, World } from './types';

export type Feature = 'road' | 'bridge' | 'ford';
export type CityTier = 'village' | 'city' | 'capital';

export interface Site {
  id: string;
  kind: 'city';
  name: string;
  pos: Hex;
  /** Starting tier; the current tier lives in the game state (World.cities). */
  tier: CityTier;
  /**
   * Owner when the game begins; null for neutral. Current ownership lives in
   * the game state (World.cities); never read this during play.
   */
  startOwner: PlayerId | null;
  /** Unit type ids this city can build. */
  builds: string[];
}

/** How a map is won: domination share of the total income, and the last turn. */
export interface VictoryRules {
  turnLimit: number;
  /** Share of the map's total income a player must hold secured (0..1). */
  domination: number;
}

export interface MapState {
  width: number;
  height: number;
  /** Terrain ids, row-major in odd-r offset order: index = row * width + col. */
  terrain: string[];
  /** Keyed by hexKey. */
  features: Record<string, Feature>;
  sites: Site[];
  victory: VictoryRules;
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

/** hexKey of the hex at offset (col, row). */
export function hexKeyOf(col: number, row: number): string {
  return hexKey(fromOffset(col, row));
}

export function featureAt(map: MapState, h: Hex): Feature | undefined {
  return map.features[hexKey(h)];
}

/** The site with this id, or undefined. */
export function siteById(map: MapState, id: string): Site | undefined {
  return map.sites.find((s) => s.id === id);
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

/** The city on `h` with its play state, or undefined. Razed sites are returned too; check `state.razed`. */
export function cityAt(world: World, h: Hex): { site: Site; state: CityState } | undefined {
  const site = siteAt(world.map, h);
  const state = site && world.cities[site.id];
  return site && state ? { site, state } : undefined;
}
