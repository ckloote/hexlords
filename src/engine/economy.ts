// Gold and score: city income, upkeep, army value, pillage, and desertion.
// Everything reads a World, so it works on the full state and on a player's view.

import type { ContentPack } from './content';
import type { CityTier } from './map';
import { RULES } from './rules';
import type { PlayerId, World } from './types';

export function cityIncome(tier: CityTier): number {
  return RULES.cityIncome[tier];
}

/** Income of every city `playerId` holds now, secured or not. */
export function incomeOf(world: World, playerId: PlayerId): number {
  let total = 0;
  for (const c of Object.values(world.cities)) if (!c.razed && c.owner === playerId) total += cityIncome(c.tier);
  return total;
}

/** Score: income of the cities `playerId` holds secured. */
export function securedScore(world: World, playerId: PlayerId): number {
  let total = 0;
  for (const c of Object.values(world.cities)) if (!c.razed && c.secured && c.owner === playerId) total += cityIncome(c.tier);
  return total;
}

/** Income of every standing city on the map, whoever holds it. Razed cities drop out; pillaged ones count at their new tier. */
export function totalIncome(world: World): number {
  let total = 0;
  for (const c of Object.values(world.cities)) if (!c.razed) total += cityIncome(c.tier);
  return total;
}

/** Secured score needed to win by domination. */
export function dominationTarget(world: World): number {
  return Math.ceil(totalIncome(world) * world.map.victory.domination);
}

function unitsOf(world: World, playerId: PlayerId): string[] {
  return Object.values(world.stacks).flatMap((s) => (s.owner === playerId ? s.unitIds : []));
}

/** Gold per turn for `playerId`'s units. Commanders pay none. */
export function upkeepOf(world: World, content: ContentPack, playerId: PlayerId): number {
  let total = 0;
  for (const id of unitsOf(world, playerId)) total += content.units[world.units[id]!.typeId]!.upkeep ?? 0;
  return total;
}

/** Combat value in gold of `playerId`'s units, by purchase price; breaks turn-limit ties. */
export function armyValue(world: World, content: ContentPack, playerId: PlayerId): number {
  let total = 0;
  for (const id of unitsOf(world, playerId)) total += content.units[world.units[id]!.typeId]!.cost ?? 0;
  return total;
}

/** Gold from pillaging a city of `tier`. */
export function pillageGold(tier: CityTier): number {
  return RULES.pillageTurns * cityIncome(tier);
}

/** The tier a city drops to when pillaged; null means it is razed. */
export function pillagedTier(tier: CityTier): CityTier | null {
  return tier === 'capital' ? 'city' : tier === 'city' ? 'village' : null;
}

/** Ids compare by length, then text, so u9 sorts before u10. */
const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The unit that deserts when `playerId` cannot pay upkeep: the one with the
 * highest upkeep, then the highest price, then the newest. Units that pay no
 * upkeep (commanders) never desert.
 */
export function chooseDeserter(world: World, content: ContentPack, playerId: PlayerId): string | null {
  let best: { id: string; upkeep: number; cost: number } | null = null;
  for (const id of unitsOf(world, playerId)) {
    const type = content.units[world.units[id]!.typeId]!;
    const upkeep = type.upkeep ?? 0;
    if (upkeep <= 0) continue;
    const cost = type.cost ?? 0;
    if (!best || upkeep > best.upkeep || (upkeep === best.upkeep && (cost > best.cost || (cost === best.cost && byId(id, best.id) > 0)))) {
      best = { id, upkeep, cost };
    }
  }
  return best?.id ?? null;
}

/** The player whose current income passes the last-stand share of the total, if any. */
export function lastStandPlayer(world: World): PlayerId | null {
  const total = totalIncome(world);
  if (total === 0) return null;
  for (const p of world.players) {
    if (!p.eliminated && incomeOf(world, p.id) > total * RULES.lastStandShare) return p.id;
  }
  return null;
}
