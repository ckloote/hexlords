// Cities in play: production, capture, and the capture choice (occupy, pillage, raze).

import type { ContentPack } from './content';
import { pillagedTier, pillageGold } from './economy';
import { type Hex, sameHex } from './hex';
import { cityAt } from './map';
import { RULES } from './rules';
import type { CaptureChoice, CityState, CommandResult, GameState, PlayerId, TurnEvent, Unit, World } from './types';

export function setProduction(
  state: GameState,
  content: ContentPack,
  playerId: PlayerId,
  siteId: string,
  unitTypeId: string | null,
): CommandResult {
  const site = state.map.sites.find((s) => s.id === siteId);
  const city = state.cities[siteId];
  if (!site || !city) return { error: 'No such city' };
  if (city.razed) return { error: 'That city has been razed' };
  if (city.owner !== playerId) return { error: 'You do not own that city' };
  let production: CityState['production'] = null;
  if (unitTypeId !== null) {
    const type = content.units[unitTypeId];
    if (!type || !site.builds.includes(unitTypeId) || type.cost === undefined || type.buildTurns === undefined) {
      return { error: `${site.name} cannot build that` };
    }
    // Picking the unit already in production keeps its progress.
    production = city.production?.unitTypeId === unitTypeId ? city.production : { unitTypeId, progress: 0 };
  }
  return { state: { ...state, cities: { ...state.cities, [siteId]: { ...city, production } } }, events: [] };
}

/** A city whose owner just changed: its production stops and its hold starts over. */
function taken(city: CityState, owner: PlayerId): CityState {
  return { ...city, owner, production: null, heldSince: null, secured: false };
}

/**
 * Takes the city on `hex` for the owner of `stackId` if it is a standing city
 * someone else holds (or nobody does). With `choose`, the capture joins the
 * current player's pending captures, to resolve before ending the turn;
 * without it (a defender falling back into an empty city during the enemy's
 * turn) the city is simply occupied.
 */
export function captureAt(
  state: GameState,
  stackId: string,
  hex: Hex,
  choose: boolean,
): { state: GameState; events: TurnEvent[] } {
  const stack = state.stacks[stackId];
  const city = cityAt(state, hex);
  if (!stack || !sameHex(stack.pos, hex) || !city || city.state.razed || city.state.owner === stack.owner) {
    return { state, events: [] };
  }
  const next: GameState = { ...state, cities: { ...state.cities, [city.site.id]: taken(city.state, stack.owner) } };
  if (choose) next.pendingCaptures = [...state.pendingCaptures, { siteId: city.site.id, stackId }];
  const event: TurnEvent = { kind: 'captured', playerId: stack.owner, siteId: city.site.id, from: city.state.owner, stackId };
  return { state: next, events: [event] };
}

export function resolveCapture(state: GameState, playerId: PlayerId, siteId: string, choice: CaptureChoice): CommandResult {
  if (!state.pendingCaptures.some((p) => p.siteId === siteId)) return { error: 'There is no capture to resolve there' };
  if (!['occupy', 'pillage', 'raze'].includes(choice)) return { error: 'Unknown capture choice' };
  const city = state.cities[siteId]!;
  let next: CityState = city;
  let gold = 0;
  const razed: CityState = { ...city, owner: null, razed: true, production: null, heldSince: null, secured: false };
  if (choice === 'pillage') {
    gold = pillageGold(city.tier);
    const tier = pillagedTier(city.tier);
    next = tier ? { ...city, tier } : razed;
  } else if (choice === 'raze') {
    next = razed;
  }
  const s: GameState = {
    ...state,
    cities: { ...state.cities, [siteId]: next },
    gold: { ...state.gold, [playerId]: (state.gold[playerId] ?? 0) + gold },
    pendingCaptures: state.pendingCaptures.filter((p) => p.siteId !== siteId),
  };
  return { state: s, events: [{ kind: 'capture-resolved', playerId, siteId, choice, gold }] };
}

/**
 * Why a finished unit cannot leave a city on `pos` now: 'full' when the hex
 * holds another player's stack or a full one, 'gold' when the treasury is
 * short of its cost; null when it can be built.
 */
export function productionBlocker(
  world: Pick<World, 'stacks'>,
  pos: Hex,
  playerId: PlayerId,
  cost: number,
  gold: number,
): 'full' | 'gold' | null {
  const here = Object.values(world.stacks).find((s) => sameHex(s.pos, pos));
  if (here && (here.owner !== playerId || here.unitIds.length >= RULES.maxStackSize)) return 'full';
  return gold < cost ? 'gold' : null;
}

/**
 * Advances production in `playerId`'s cities by one turn. A finished unit is
 * paid for now; if the treasury is short or the city's hex holds a full
 * stack, it waits, keeping its progress. New units join the stack in the
 * city or form a new one, at full health and movement.
 */
export function runProduction(state: GameState, content: ContentPack, playerId: PlayerId, events: TurnEvent[]): GameState {
  const cities = { ...state.cities };
  const units = { ...state.units };
  const stacks = { ...state.stacks };
  let gold = state.gold[playerId] ?? 0;
  let { nextId, nextUnitId } = state;
  for (const site of state.map.sites) {
    const city = cities[site.id]!;
    if (city.owner !== playerId || city.razed || !city.production) continue;
    const type = content.units[city.production.unitTypeId]!;
    const buildTurns = type.buildTurns ?? 1;
    const cost = type.cost ?? 0;
    const progress = Math.min(city.production.progress + 1, buildTurns);
    cities[site.id] = { ...city, production: { ...city.production, progress } };
    if (progress < buildTurns) continue;
    const blocker = productionBlocker({ stacks }, site.pos, playerId, cost, gold);
    if (blocker) {
      events.push({ kind: 'production-waiting', playerId, siteId: site.id, unitTypeId: type.id, reason: blocker });
      continue;
    }
    const here = Object.values(stacks).find((s) => sameHex(s.pos, site.pos));
    gold -= cost;
    const unit: Unit = { id: `u${nextUnitId++}`, typeId: type.id, hits: type.hits, moveLeft: type.move };
    units[unit.id] = unit;
    if (here) {
      stacks[here.id] = { ...here, unitIds: [...here.unitIds, unit.id] };
    } else {
      const id = `s${nextId++}`;
      stacks[id] = { id, owner: playerId, pos: { ...site.pos }, unitIds: [unit.id], stance: { kind: 'hold' } };
    }
    // The city starts on the next one of the same type.
    cities[site.id] = { ...city, production: { unitTypeId: type.id, progress: 0 } };
    events.push({ kind: 'unit-built', playerId, siteId: site.id, unitId: unit.id, unitTypeId: type.id, cost });
  }
  return { ...state, cities, units, stacks, nextId, nextUnitId, gold: { ...state.gold, [playerId]: gold } };
}
