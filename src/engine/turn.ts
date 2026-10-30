// The turn cycle. At the start of each player's turn, in order: elimination,
// income, upkeep, desertion, production, healing, securing cities, and the
// domination check; then movement is restored. The first round runs only the
// securing and the movement restore, so every player starts on equal terms.

import { runProduction } from './cities';
import { TAGS, type ContentPack } from './content';
import { armyValue, chooseDeserter, dominationTarget, incomeOf, securedScore, totalIncome, upkeepOf } from './economy';
import { cityAt } from './map';
import { restoreMovement } from './move';
import { RULES } from './rules';
import type { GameState, PlayerId, TurnEvent, Winner } from './types';

const alive = (state: GameState) => state.players.filter((p) => !p.eliminated);

function setWinner(state: GameState, winner: Winner, events: TurnEvent[]): GameState {
  events.push({ kind: 'game-over', winner });
  return { ...state, winner };
}

/** Removes a player who holds no city, disbanding their units. */
function eliminate(state: GameState, playerId: PlayerId, events: TurnEvent[]): GameState {
  const stacks = { ...state.stacks };
  const units = { ...state.units };
  for (const s of Object.values(stacks)) {
    if (s.owner !== playerId) continue;
    for (const id of s.unitIds) delete units[id];
    delete stacks[s.id];
  }
  events.push({ kind: 'eliminated', playerId });
  const players = state.players.map((p) => (p.id === playerId ? { ...p, eliminated: true } : p));
  let s: GameState = { ...state, players, stacks, units };
  const left = alive(s);
  if (left.length === 1) s = setWinner(s, { playerId: left[0]!.id, reason: 'last-standing' }, events);
  return s;
}

function collect(state: GameState, content: ContentPack, playerId: PlayerId, events: TurnEvent[]): GameState {
  const income = incomeOf(state, playerId);
  const upkeep = upkeepOf(state, content, playerId);
  let gold = (state.gold[playerId] ?? 0) + income - upkeep;
  let s = state;
  // Short of gold: production waits (it checks the treasury), and the costliest unit deserts.
  if (gold < 0) {
    gold = 0;
    const deserter = chooseDeserter(s, content, playerId);
    if (deserter) {
      const typeId = s.units[deserter]!.typeId;
      const units = { ...s.units };
      delete units[deserter];
      const stacks = { ...s.stacks };
      const stack = Object.values(stacks).find((st) => st.unitIds.includes(deserter))!;
      const rest = stack.unitIds.filter((id) => id !== deserter);
      if (rest.length) stacks[stack.id] = { ...stack, unitIds: rest };
      else delete stacks[stack.id];
      s = { ...s, units, stacks };
      events.push({ kind: 'deserted', playerId, unitId: deserter, unitTypeId: typeId });
    }
  }
  events.push({ kind: 'income', playerId, income, upkeep, gold });
  return { ...s, gold: { ...s.gold, [playerId]: gold } };
}

/** Heals 2 hits in a friendly city, 1 in the field if the unit neither moved nor fought, and at least 1 for regenerating units. */
function heal(state: GameState, content: ContentPack, playerId: PlayerId, events: TurnEvent[]): GameState {
  const units = { ...state.units };
  let healed = 0;
  for (const stack of Object.values(state.stacks)) {
    if (stack.owner !== playerId) continue;
    const city = cityAt(state, stack.pos);
    const inCity = city !== undefined && !city.state.razed && city.state.owner === playerId;
    for (const id of stack.unitIds) {
      const unit = units[id]!;
      const type = content.units[unit.typeId]!;
      let amount = inCity ? RULES.healCity : unit.acted ? 0 : RULES.healField;
      if (type.tags.includes(TAGS.regenerates)) amount = Math.max(amount, RULES.healRegenerates);
      const hits = Math.min(type.hits, unit.hits + amount);
      if (hits !== unit.hits) {
        healed += hits - unit.hits;
        units[id] = { ...unit, hits };
      }
    }
  }
  if (healed > 0) events.push({ kind: 'healed', playerId, hits: healed });
  return { ...state, units };
}

/** A city held from the start of one of its owner's turns to the start of the next becomes secured. */
function secure(state: GameState, playerId: PlayerId, events: TurnEvent[]): GameState {
  const cities = { ...state.cities };
  for (const [id, c] of Object.entries(cities)) {
    if (c.owner !== playerId || c.razed) continue;
    if (c.heldSince === null) cities[id] = { ...c, heldSince: state.turn };
    else if (!c.secured && c.heldSince < state.turn) {
      cities[id] = { ...c, secured: true };
      events.push({ kind: 'secured', playerId, siteId: id });
    }
  }
  return { ...state, cities };
}

function clearActed(state: GameState, playerId: PlayerId): GameState {
  const units = { ...state.units };
  for (const stack of Object.values(state.stacks)) {
    if (stack.owner !== playerId) continue;
    for (const id of stack.unitIds) {
      if (!units[id]!.acted) continue;
      const u = { ...units[id]! };
      delete u.acted;
      units[id] = u;
    }
  }
  return { ...state, units };
}

/** Runs the start of the current player's turn. May eliminate them or end the game. */
export function startTurn(state: GameState, content: ContentPack, events: TurnEvent[]): GameState {
  const playerId = state.players[state.currentPlayer]!.id;
  let s = state;
  // Round 1 runs no turn-start checks, so every player starts on equal terms.
  const checks = s.turn > 1;
  // Elimination needs a standing city somewhere: a test board with no cities,
  // or a map where every city is razed, eliminates nobody (the turn limit decides).
  if (checks && totalIncome(s) > 0 && incomeOf(s, playerId) === 0) return eliminate(s, playerId, events);
  events.push({ kind: 'turn-started', playerId, turn: s.turn });
  if (checks) {
    s = collect(s, content, playerId, events);
    s = runProduction(s, content, playerId, events);
    s = heal(s, content, playerId, events);
  }
  s = secure(s, playerId, events);
  if (checks && totalIncome(s) > 0 && securedScore(s, playerId) >= dominationTarget(s)) {
    s = setWinner(s, { playerId, reason: 'domination' }, events);
  }
  return clearActed(restoreMovement(s, content, playerId, RULES.retreatMovePenaltyPct), playerId);
}

/** The winner when the last turn ends: highest secured score, then the larger army by gold value; null on a full tie. */
export function turnLimitWinner(state: GameState, content: ContentPack): PlayerId | null {
  const ranked = alive(state)
    .map((p) => ({ id: p.id, score: securedScore(state, p.id), army: armyValue(state, content, p.id) }))
    .sort((a, b) => b.score - a.score || b.army - a.army);
  const [first, second] = ranked;
  if (!first) return null;
  if (second && second.score === first.score && second.army === first.army) return null;
  return first.id;
}

/** Passes the turn to the next player still in the game, running their turn start; ends the game after the last turn. */
export function endTurn(state: GameState, content: ContentPack): { state: GameState; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  const n = state.players.length;
  let s = state;
  for (let k = 0; k < n; k++) {
    const next = (s.currentPlayer + 1) % n;
    const turn = next === 0 ? s.turn + 1 : s.turn;
    if (turn > s.map.victory.turnLimit) {
      s = setWinner(s, { playerId: turnLimitWinner(s, content), reason: 'turn-limit' }, events);
      break;
    }
    s = { ...s, currentPlayer: next, turn };
    if (s.players[next]!.eliminated) continue;
    s = startTurn(s, content, events);
    if (s.winner || !s.players[next]!.eliminated) break;
  }
  return { state: s, events };
}
