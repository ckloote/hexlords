// The city panel's model: tier, walls, income, what it is building and when it
// will be ready, the build list, and the garrison. Reads only the player's view.

import { productionBlocker } from '../engine/cities';
import type { ContentPack, UnitType } from '../engine/content';
import { cityIncome, incomeOf, upkeepOf } from '../engine/economy';
import { hexKey, sameHex } from '../engine/hex';
import { RULES } from '../engine/rules';
import type { PlayerId } from '../engine/types';
import type { PlayerView } from '../engine/vision';
import type { Strings } from './strings';

export interface BuildOption {
  unitTypeId: string;
  name: string;
  stats: string;
  cost: number;
  turns: number;
  upkeep: number;
  current: boolean;
  affordable: boolean;
}

export interface CityCard {
  siteId: string;
  name: string;
  owner: PlayerId | null;
  mine: boolean;
  razed: boolean;
  /** "City · walls +25% · 10 gold a turn". */
  subtitle: string;
  /** "Secured", or when it will be; empty for neutral and razed cities. */
  holding: string;
  building: { name: string; progress: number; turns: number; status: string } | null;
  options: BuildOption[];
  /** "2 Archers, 1 Militia", "Empty", or "Not in sight". */
  garrison: string;
}

export function unitStats(type: UnitType, strings: Strings): string {
  const specials = type.tags.map((t) => strings.tags[t]).filter((t): t is string => Boolean(t));
  return [`Str ${type.strength}`, `${type.hits} hits`, `Move ${type.move}`, ...specials].join(' · ');
}

/** "2 Archers, 1 Militia". */
export function countNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, k]) => `${k} ${n}`).join(', ');
}

/**
 * Gold left for `siteId` at the next turn start: production pays city by city
 * in map order, so cities earlier in the order that finish a unit then (and
 * are not blocked) spend first.
 */
export function goldWhenReached(view: PlayerView, content: ContentPack, siteId: string, nextGold: number): number {
  let gold = nextGold;
  for (const site of view.map.sites) {
    if (site.id === siteId) break;
    const city = view.cities[site.id]!;
    if (city.owner !== view.viewer || city.razed || !city.production) continue;
    const type = content.units[city.production.unitTypeId]!;
    if (city.production.progress + 1 < (type.buildTurns ?? 1)) continue;
    const cost = type.cost ?? 0;
    if (!productionBlocker(view, site.pos, view.viewer, cost, gold)) gold -= cost;
  }
  return gold;
}

export function cityCard(view: PlayerView, content: ContentPack, strings: Strings, siteId: string): CityCard {
  const site = view.map.sites.find((s) => s.id === siteId)!;
  const city = view.cities[siteId]!;
  const mine = city.owner === view.viewer && !city.razed;
  const defense = RULES.cityDefensePct[city.tier];
  const subtitle = city.razed
    ? 'Razed: nobody can use it'
    : [strings.tiers[city.tier], defense ? `walls +${defense}%` : 'no walls', `${cityIncome(city.tier)} gold a turn`].join(' · ');
  const holding = city.razed || city.owner === null ? '' : city.secured ? 'Secured' : 'Not yet secured: counts toward victory after a full round';

  // Production runs after next turn's income and upkeep, so judge gold against that treasury.
  const nextGold = Math.max(0, view.gold + incomeOf(view, view.viewer) - upkeepOf(view, content, view.viewer));

  let building: CityCard['building'] = null;
  if (mine && city.production) {
    const type = content.units[city.production.unitTypeId]!;
    const turns = type.buildTurns ?? 1;
    const { progress } = city.production;
    const cost = type.cost ?? 0;
    // A unit that finishes at the next turn start leaves then unless something blocks it.
    const finishing = progress + 1 >= turns;
    const blocker = finishing ? productionBlocker(view, site.pos, view.viewer, cost, goldWhenReached(view, content, siteId, nextGold)) : null;
    const status =
      blocker === 'full' ? 'Waiting: the stack in the city is full'
      : blocker === 'gold' ? `Waiting for gold: needs ${cost}`
      : `Ready on turn ${view.turn + Math.max(1, turns - progress)}`;
    building = { name: type.name, progress, turns, status };
  }

  const options: BuildOption[] = mine
    ? site.builds.map((id) => {
        const type = content.units[id]!;
        return {
          unitTypeId: id,
          name: type.name,
          stats: unitStats(type, strings),
          cost: type.cost ?? 0,
          turns: type.buildTurns ?? 1,
          upkeep: type.upkeep ?? 0,
          current: city.production?.unitTypeId === id,
          affordable: nextGold >= (type.cost ?? 0),
        };
      })
    : [];

  const stack = Object.values(view.stacks).find((s) => sameHex(s.pos, site.pos));
  const seen = view.visible.includes(hexKey(site.pos));
  const garrison = stack
    ? countNames(stack.unitIds.map((id) => content.units[view.units[id]!.typeId]!.name))
    : mine || seen
      ? 'Empty'
      : 'Not in sight';

  return { siteId, name: site.name, owner: city.owner, mine, razed: city.razed, subtitle, holding, building, options, garrison };
}
