// The engine's core: applyCommand(state, command) → { state } | { error }.
// Pure and deterministic: every random draw comes from state.rng.

import { type BattleOutcome, resolveBattle } from './battle';
import { canAdvance, planAttack } from './combat';
import { applyMove, restoreMovement } from './move';
import type { ContentPack } from './content';
import { type Hex, hexKey, sameHex } from './hex';
import { inBounds, type MapState } from './map';
import { attackCost, canEnter, moverFor, movesLeft, stackMover } from './movement';
import { visibleHexes } from './vision';
import { type BattleContext, battleModifiers, type Combatant } from './modifiers';
import { seedRng } from './rng';
import { RULES } from './rules';
import type { BattleReport, Command, CommandResult, GameState, Stack, Stance, Unit } from './types';

export interface GameSetup {
  seed: number | string;
  map: MapState;
  players: { id: string; factionId: string }[];
  stacks: {
    owner: string;
    pos: Hex;
    /** Unit type ids, or { typeId, hits } for wounded units. */
    units: (string | { typeId: string; hits: number })[];
    stance?: Stance;
  }[];
}

/** Builds the initial state. Throws on an invalid setup, which is a programming error. */
export function createGame(setup: GameSetup, content: ContentPack): GameState {
  const state: GameState = {
    version: 1,
    contentId: content.id,
    seed: setup.seed,
    rng: seedRng(setup.seed),
    turn: 1,
    currentPlayer: 0,
    players: setup.players.map((p) => {
      if (!content.factions[p.factionId]) throw new Error(`Unknown faction "${p.factionId}"`);
      return { id: p.id, factionId: p.factionId, eliminated: false };
    }),
    map: setup.map,
    stacks: {},
    units: {},
    explored: {},
    nextId: 1,
  };
  if (state.players.length === 0) throw new Error('A game needs players');
  let nextUnit = 1;
  for (const s of setup.stacks) {
    if (!state.players.some((p) => p.id === s.owner)) throw new Error(`Unknown owner "${s.owner}"`);
    if (s.units.length === 0 || s.units.length > RULES.maxStackSize) throw new Error('Stacks hold 1 to 8 units');
    const id = `s${state.nextId++}`;
    const unitIds = s.units.map((u) => {
      const { typeId, hits } = typeof u === 'string' ? { typeId: u, hits: undefined } : u;
      const type = content.units[typeId];
      if (!type) throw new Error(`Unknown unit type "${typeId}"`);
      const unit: Unit = { id: `u${nextUnit++}`, typeId, hits: hits ?? type.hits, moveLeft: type.move };
      if (unit.hits < 1 || unit.hits > type.hits) throw new Error(`Bad hits for ${typeId}`);
      state.units[unit.id] = unit;
      return unit.id;
    });
    if (!inBounds(state.map, s.pos)) throw new Error(`Stack ${id} is off the map`);
    if (Object.values(state.stacks).some((o) => hexKey(o.pos) === hexKey(s.pos))) {
      throw new Error(`Two stacks on ${hexKey(s.pos)}`);
    }
    state.stacks[id] = { id, owner: s.owner, pos: { ...s.pos }, unitIds, stance: s.stance ?? { kind: 'hold' } };
    if (!canEnter(state, content, moverFor(state, content, s.owner, unitIds), s.pos)) {
      throw new Error(`Stack ${id} stands on terrain it cannot enter`);
    }
  }
  return refreshExplored(state, content);
}

const validThreshold = (t: unknown) => typeof t === 'number' && t >= 0 && t <= 1;

export function applyCommand(state: GameState, command: Command, content: ContentPack): CommandResult {
  const player = state.players[state.currentPlayer];
  if (!player || command.playerId !== player.id) return { error: `It is not ${command.playerId}'s turn` };

  switch (command.type) {
    case 'EndTurn':
      return endTurn(state, content);
    case 'SetStance': {
      const stack = state.stacks[command.stackId];
      if (!stack || stack.owner !== player.id) return { error: 'You do not own that stack' };
      const { stance } = command;
      if (stance.kind === 'fall-back' && !validThreshold(stance.threshold)) return { error: 'Threshold must be 0..1' };
      if (!['hold', 'fall-back', 'evade'].includes(stance.kind)) return { error: 'Unknown stance' };
      return { state: { ...state, stacks: { ...state.stacks, [stack.id]: { ...stack, stance } } }, events: [] };
    }
    case 'Attack':
      return attack(state, command, content);
    case 'Move':
      return withExplored(applyMove(state, command, content), content);
    case 'SetProduction':
    case 'Explore':
      return { error: `${command.type} is not implemented yet` };
    default:
      return { error: `Unknown command ${(command as { type: string }).type}` };
  }
}

/** Adds every player's currently visible hexes to their explored set. */
export function refreshExplored(state: GameState, content: ContentPack): GameState {
  const explored = { ...state.explored };
  for (const p of state.players) {
    const mine = { ...explored[p.id] };
    for (const key of visibleHexes(state, content, p.id)) mine[key] = true;
    explored[p.id] = mine;
  }
  return { ...state, explored };
}

/** Applies commands in order, throwing on the first error. Handy for replays and tests. */
export function replay(state: GameState, commands: readonly Command[], content: ContentPack): GameState {
  let s = state;
  for (const c of commands) {
    const r = applyCommand(s, c, content);
    if ('error' in r) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

function withExplored(result: CommandResult, content: ContentPack): CommandResult {
  return 'error' in result ? result : { ...result, state: refreshExplored(result.state, content) };
}

function endTurn(state: GameState, content: ContentPack): CommandResult {
  const n = state.players.length;
  let next = state.currentPlayer;
  let turn = state.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (next === 0) turn++;
    if (!state.players[next]!.eliminated) break;
  }
  const player = state.players[next]!.id;
  const s = restoreMovement({ ...state, currentPlayer: next, turn }, content, player, RULES.retreatMovePenaltyPct);
  return { state: s, events: [{ kind: 'turn-started', playerId: s.players[next]!.id, turn }] };
}

function attack(
  state: GameState,
  command: Extract<Command, { type: 'Attack' }>,
  content: ContentPack,
): CommandResult {
  const own = state.stacks[command.stackId];
  if (!own || own.owner !== command.playerId) return { error: 'You do not own that stack' };
  const plan = planAttack(state, content, command.stackId, command.targetStackId, command.withdrawBelow);
  if ('error' in plan) return plan;
  const { attacker, defender, retreatTo } = plan;
  const need = attackCost(state, content, stackMover(state, content, attacker), defender.pos);
  if (movesLeft(state, attacker.unitIds) < need) return { error: 'Not enough movement to attack' };

  const units = { ...state.units };
  const stacks = { ...state.stacks };
  let rng = state.rng;
  let outcome: BattleOutcome | 'evaded';
  let battleEvents: BattleReport['events'] = [];
  let attackerHits = attacker.unitIds.map((id) => units[id]!.hits);
  let defenderHits = defender.unitIds.map((id) => units[id]!.hits);

  if (plan.evades) {
    outcome = 'evaded';
  } else {
    const result = resolveBattle(state.rng, plan.modifiers.attackers, plan.modifiers.defenders, {
      attackerThreshold: plan.attackerThreshold,
      defenderThreshold: plan.defenderThreshold,
    });
    rng = result.rng;
    outcome = result.outcome;
    battleEvents = result.events;
    attackerHits = result.attackerHits;
    defenderHits = result.defenderHits;
  }

  /** Applies damage and deaths; returns the surviving unit ids. */
  const settle = (stack: Stack, hits: number[]): string[] => {
    const survivors: string[] = [];
    stack.unitIds.forEach((id, k) => {
      const h = hits[k]!;
      if (h > 0) {
        survivors.push(id);
        if (h !== units[id]!.hits) units[id] = { ...units[id]!, hits: h };
      } else {
        delete units[id];
      }
    });
    if (survivors.length > 0) stacks[stack.id] = { ...stack, unitIds: survivors };
    else delete stacks[stack.id];
    return survivors;
  };
  const attackers = settle(attacker, attackerHits);
  const defenders = settle(defender, defenderHits);

  // An attack ends the attacking stack's movement for the turn, whatever happens.
  for (const id of attackers) units[id] = { ...units[id]!, moveLeft: 0 };

  // A withdrawing or evading defender moves to its retreat hex, merging with a friendly stack there.
  let defenderRetreatTo: Hex | undefined;
  if ((outcome === 'defender-withdraw' || outcome === 'evaded') && defenders.length > 0 && retreatTo) {
    defenderRetreatTo = retreatTo;
    for (const id of defenders) units[id] = { ...units[id]!, retreated: true };
    const host = Object.values(stacks).find((s) => s.id !== defender.id && sameHex(s.pos, retreatTo));
    if (host) {
      stacks[host.id] = { ...host, unitIds: [...host.unitIds, ...defenders] };
      delete stacks[defender.id];
    } else {
      const moved: Stack = { ...stacks[defender.id]!, pos: retreatTo };
      delete moved.route;
      stacks[defender.id] = moved;
    }
  }

  // The winner advances for free if the hex is now empty and every unit can enter it.
  const vacated = !Object.values(stacks).some((s) => sameHex(s.pos, defender.pos));
  const attackerAdvanced =
    attackers.length > 0 && vacated && canAdvance(state, content, attacker, attackers, defender.pos);
  if (attackerAdvanced) {
    const moved: Stack = { ...stacks[attacker.id]!, pos: defender.pos };
    delete moved.route;
    stacks[attacker.id] = moved;
  }

  const report: BattleReport = {
    kind: 'battle',
    attackerStackId: attacker.id,
    defenderStackId: defender.id,
    attackerUnitIds: [...attacker.unitIds],
    defenderUnitIds: [...defender.unitIds],
    modifiers: plan.modifiers.lines,
    outcome,
    events: battleEvents,
    attackerAdvanced,
  };
  if (defenderRetreatTo) report.defenderRetreatTo = defenderRetreatTo;
  return { state: refreshExplored({ ...state, rng, units, stacks }, content), events: [report] };
}
