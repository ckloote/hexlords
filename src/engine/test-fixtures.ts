// Shared test fixtures. Not imported by game code.
import type { Fighter } from './fight';
import { fromOffset, type Hex, hexKey } from './hex';
import type { CityTier, Feature, MapState } from './map';

/** Offset (col, row) to axial, for readable tests. */
export const at = (col: number, row: number): Hex => fromOffset(col, row);

const LEGEND: Record<string, [string, Feature?]> = {
  '.': ['plains'],
  f: ['forest'],
  h: ['hills'],
  s: ['swamp'],
  m: ['mountains'],
  w: ['water'],
  '~': ['river'],
  '=': ['plains', 'road'],
  B: ['river', 'bridge'],
  F: ['river', 'ford'],
};

/**
 * Builds a map from rows of characters (one per hex, odd-r offset order):
 * . plains, f forest, h hills, s swamp, m mountains, w water, ~ river,
 * = road on plains, B bridge, F ford.
 */
export function asciiMap(
  rows: string[],
  cities: { at: Hex; tier: CityTier; owner?: string; name?: string }[] = [],
): MapState {
  const width = rows[0]!.length;
  const map: MapState = { width, height: rows.length, terrain: [], features: {}, sites: [] };
  rows.forEach((line, row) => {
    if (line.length !== width) throw new Error(`row ${row} has the wrong width`);
    [...line].forEach((ch, col) => {
      const [terrain, feature] = LEGEND[ch] ?? (() => { throw new Error(`unknown map char ${ch}`); })();
      map.terrain.push(terrain);
      if (feature) map.features[hexKey(fromOffset(col, row))] = feature;
    });
  });
  cities.forEach((c, k) =>
    map.sites.push({ id: `c${k}`, kind: 'city', name: c.name ?? `City ${k}`, pos: c.at, tier: c.tier, owner: c.owner ?? null }),
  );
  return map;
}

/** An all-plains map. */
export function plainsMap(width: number, height: number): MapState {
  return asciiMap(Array.from({ length: height }, () => '.'.repeat(width)));
}

/** Gravelmaw, with effective Strengths already applied (see modifiers.test.ts). */
export function gravelmaw(): { attackers: Fighter[]; defenders: Fighter[] } {
  return {
    attackers: [
      { strength: 2.5, hits: 2, move: 6 }, // siege engine
      { strength: 5, hits: 2, move: 8 }, // infantry
      { strength: 5, hits: 1, move: 8 }, // infantry, wounded
      { strength: 6.25, hits: 3, move: 6 }, // ironguard
      { strength: 6.25, hits: 3, move: 10 }, // hero
    ],
    defenders: [
      { strength: 2, hits: 2, move: 8 },
      { strength: 2, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 5, hits: 3, move: 8 },
    ],
  };
}
