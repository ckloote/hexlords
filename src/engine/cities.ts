// Cities in play: production, capture, and the capture choice (occupy, pillage, raze).

import type { ContentPack } from './content';
import { pillagedTier, pillageGold, treasuryAfterUpkeep, withoutDeserter } from './economy';
import { type Hex, sameHex } from './hex';
import { cityAt, siteById } from './map';
import { RULES } from './rules';
import type { CaptureChoice, CityState, CommandResult, GameState, PlayerId, TurnEvent, Unit, World } from './types';

/**
 * Whether a city held by `factionId` may build `unitTypeId`: the unit must be
 * priced, and a faction's unique unit is built only by that faction, even in a
 * captured city whose build list names it.
 */
export function canBuild(content: ContentPack, factionId: string, unitTypeId: string): boolean {
  const type = content.units[unitTypeId];
  if (!type || type.cost === undefined || type.buildTurns === undefined) return false;
  return Object.values(content.factions).every((f) => f.uniqueUnit !== unitTypeId || f.id === factionId);
}

export function setProduction(
  state: GameState,
  content: ContentPack,
  playerId: PlayerId,
  siteId: string,
  unitTypeId: string | null,
): CommandResult {
  const site = siteById(state.map, siteId);
  const city = state.cities[siteId];
  if (!site || !city) return { error: 'No such city' };
  if (city.razed) return { error: 'That city has been razed' };
  if (city.owner !== playerId) return { error: 'You do not own that city' };
  let production: CityState['production'] = null;
  if (unitTypeId !== null) {
    const factionId = state.players.find((p) => p.id === playerId)!.factionId;
    if (!site.builds.includes(unitTypeId) || !canBuild(content, factionId, unitTypeId)) {
      return { error: `${site.name} cannot build that` };
    }
    // Picking the unit already in production keeps its progress.
    production = city.production?.unitTypeId === unitTypeId ? city.production : { unitTypeId, progress: 0 };
  }
  return { state: { ...state, cities: { ...state.cities, [siteId]: { ...city, production } } }, events: [] };
}

/** A city whose owner just changed: its production stops and its hold starts over. */
function taken(city: CityState, owner: PlayerId): CityState {
  return { ...city, owner, production: null, held: false, secured: false };
}

/**
 * Takes the city the stack `stackId` stands on for its owner if it is a standing city
 * someone else holds (or nobody does). With `choose`, the capture joins the
 * current player's pending captures, to resolve before ending the turn;
 * without it (a defender falling back into an empty city during the enemy's
 * turn) the city is simply occupied.
 */
export function captureAt(state: GameState, stackId: string, choose: boolean): { state: GameState; events: TurnEvent[] } {
  const stack = state.stacks[stackId];
  const city = stack && cityAt(state, stack.pos);
  if (!stack || !city || city.state.razed || city.state.owner === stack.owner) {
    return { state, events: [] };
  }
  const siteId = city.site.id;
  // A city that changes hands again drops any earlier claim on it; the new owner's choice replaces it.
  const others = state.pendingCaptures.filter((p) => p.siteId !== siteId);
  const next: GameState = {
    ...state,
    cities: { ...state.cities, [siteId]: taken(city.state, stack.owner) },
    pendingCaptures: choose ? [...others, { siteId, from: city.state.owner }] : others,
  };
  const event: TurnEvent = { kind: 'captured', playerId: stack.owner, siteId, from: city.state.owner, tier: city.state.tier, stackId };
  return { state: next, events: [event] };
}

export function resolveCapture(state: GameState, playerId: PlayerId, siteId: string, choice: CaptureChoice): CommandResult {
  const pending = state.pendingCaptures.find((p) => p.siteId === siteId);
  if (!pending) return { error: 'There is no capture to resolve there' };
  if (!['occupy', 'pillage', 'raze'].includes(choice)) return { error: 'Unknown capture choice' };
  const city = state.cities[siteId]!;
  if (city.owner !== playerId || city.razed) return { error: 'That city is no longer yours' };
  let next: CityState = city;
  let gold = 0;
  const razed: CityState = { ...city, owner: null, razed: true, production: null, held: false, secured: false };
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
  return { state: s, events: [{ kind: 'capture-resolved', playerId, siteId, from: pending.from, choice, gold }] };
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

/** What one of a player's cities does at their next turn start. */
export interface ProductionForecast {
  siteId: string;
  /** What it is building, or null. */
  unitTypeId: string | null;
  /** Progress after the turn start's work. */
  progress: number;
  /** The unit is finished then (built now or waiting). */
  finishes: boolean;
  /** Why a finished unit waits; null when it is built (or nothing finishes). */
  blocker: 'full' | 'gold' | null;
  /** Treasury when production reaches this city: cities earlier in map order pay first. */
  goldBefore: number;
}

/**
 * What production does for `playerId` at their next turn start, city by city
 * in map order, from `gold` (the treasury after income and upkeep). One entry
 * per standing city they hold. runProduction applies exactly this, and the UI
 * and the AI read it to predict the turn.
 */
export function forecastProduction(world: World, content: ContentPack, playerId: PlayerId, gold: number): ProductionForecast[] {
  const out: ProductionForecast[] = [];
  let left = gold;
  for (const site of world.map.sites) {
    const city = world.cities[site.id]!;
    if (city.owner !== playerId || city.razed) continue;
    if (!city.production) {
      out.push({ siteId: site.id, unitTypeId: null, progress: 0, finishes: false, blocker: null, goldBefore: left });
      continue;
    }
    const type = content.units[city.production.unitTypeId]!;
    const buildTurns = type.buildTurns ?? 1;
    const cost = type.cost ?? 0;
    const progress = Math.min(city.production.progress + 1, buildTurns);
    const finishes = progress >= buildTurns;
    // Each city spawns only on its own hex, so earlier cities' new units never block a later one.
    const blocker = finishes ? productionBlocker(world, site.pos, playerId, cost, left) : null;
    out.push({ siteId: site.id, unitTypeId: type.id, progress, finishes, blocker, goldBefore: left });
    if (finishes && !blocker) left -= cost;
  }
  return out;
}

/**
 * forecastProduction for `playerId`'s next turn start as it really runs, from
 * their treasury now: income and upkeep first, and when upkeep runs short the
 * deserter leaves before production (which may free a slot in a full city).
 * The UI and the AI read this.
 */
export function forecastTurnStart(world: World, content: ContentPack, playerId: PlayerId, gold: number): ProductionForecast[] {
  const after = treasuryAfterUpkeep(world, content, playerId, gold);
  const w = after.short ? withoutDeserter(world, content, playerId).world : world;
  return forecastProduction(w, content, playerId, after.gold);
}

/**
 * Advances production in `playerId`'s cities by one turn, as forecastProduction
 * predicts. A finished unit is paid for now; if the treasury is short or the
 * city's hex holds a full stack, it waits, keeping its progress. New units join
 * the stack in the city or form a new one, at full health and movement.
 */
export function runProduction(state: GameState, content: ContentPack, playerId: PlayerId, events: TurnEvent[]): GameState {
  const cities = { ...state.cities };
  const units = { ...state.units };
  const stacks = { ...state.stacks };
  let gold = state.gold[playerId] ?? 0;
  let { nextId, nextUnitId } = state;
  for (const f of forecastProduction(state, content, playerId, gold)) {
    if (!f.unitTypeId) continue;
    const city = cities[f.siteId]!;
    cities[f.siteId] = { ...city, production: { unitTypeId: f.unitTypeId, progress: f.progress } };
    if (!f.finishes) continue;
    if (f.blocker) {
      events.push({ kind: 'production-waiting', playerId, siteId: f.siteId, unitTypeId: f.unitTypeId, reason: f.blocker });
      continue;
    }
    const type = content.units[f.unitTypeId]!;
    const cost = type.cost ?? 0;
    const pos = siteById(state.map, f.siteId)!.pos;
    const here = Object.values(stacks).find((s) => sameHex(s.pos, pos));
    gold -= cost;
    const unit: Unit = { id: `u${nextUnitId++}`, typeId: type.id, hits: type.hits, moveLeft: type.move };
    units[unit.id] = unit;
    if (here) {
      stacks[here.id] = { ...here, unitIds: [...here.unitIds, unit.id] };
    } else {
      const id = `s${nextId++}`;
      stacks[id] = { id, owner: playerId, pos: { ...pos }, unitIds: [unit.id], stance: { kind: 'hold' } };
    }
    // The city starts on the next one of the same type.
    cities[f.siteId] = { ...city, production: { unitTypeId: type.id, progress: 0 } };
    events.push({ kind: 'unit-built', playerId, siteId: f.siteId, unitId: unit.id, unitTypeId: type.id, cost });
  }
  return { ...state, cities, units, stacks, nextId, nextUnitId, gold: { ...state.gold, [playerId]: gold } };
}
