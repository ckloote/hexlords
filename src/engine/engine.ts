// The engine's core: applyCommand(state, command) → { state } | { error }.
// Pure and deterministic: every random draw comes from state.rng.

import { resolveBattle } from './battle';
import type { ContentPack } from './content';
import { hexDistance, type Hex } from './hex';
import { type BattleContext, battleModifiers, type Combatant } from './modifiers';
import { seedRng } from './rng';
import { RULES } from './rules';
import type { Command, CommandResult, GameState, Stack, Stance, Unit } from './types';

export interface GameSetup {
  seed: number | string;
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
    stacks: {},
    units: {},
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
      const unit: Unit = { id: `u${nextUnit++}`, typeId, hits: hits ?? type.hits };
      if (unit.hits < 1 || unit.hits > type.hits) throw new Error(`Bad hits for ${typeId}`);
      state.units[unit.id] = unit;
      return unit.id;
    });
    state.stacks[id] = { id, owner: s.owner, pos: { ...s.pos }, unitIds, stance: s.stance ?? { kind: 'hold' } };
  }
  return state;
}

const validThreshold = (t: unknown) => typeof t === 'number' && t >= 0 && t <= 1;

export function applyCommand(state: GameState, command: Command, content: ContentPack): CommandResult {
  const player = state.players[state.currentPlayer];
  if (!player || command.playerId !== player.id) return { error: `It is not ${command.playerId}'s turn` };

  switch (command.type) {
    case 'EndTurn':
      return endTurn(state);
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
    case 'Split':
    case 'Merge':
    case 'SetProduction':
    case 'Explore':
      return { error: `${command.type} is not implemented yet` };
    default:
      return { error: `Unknown command ${(command as { type: string }).type}` };
  }
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

function endTurn(state: GameState): CommandResult {
  const n = state.players.length;
  let next = state.currentPlayer;
  let turn = state.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (next === 0) turn++;
    if (!state.players[next]!.eliminated) break;
  }
  const s = { ...state, currentPlayer: next, turn };
  return { state: s, events: [{ kind: 'turn-started', playerId: s.players[next]!.id, turn }] };
}

/**
 * Terrain and city around the defender. There is no map until milestone 2 and
 * no cities until milestone 4, so every battle is on open plains for now.
 */
function battleContextAt(_state: GameState, _pos: Hex): BattleContext {
  return { terrainDefensePct: 0 };
}

function attack(
  state: GameState,
  command: Extract<Command, { type: 'Attack' }>,
  content: ContentPack,
): CommandResult {
  const own = state.stacks[command.stackId];
  const target = state.stacks[command.targetStackId];
  if (!own || own.owner !== command.playerId) return { error: 'You do not own that stack' };
  if (!target) return { error: 'No such target stack' };
  if (target.owner === own.owner) return { error: 'Cannot attack your own stack' };
  if (hexDistance(own.pos, target.pos) !== 1) return { error: 'Target is not adjacent' };
  if (command.withdrawBelow !== undefined && !validThreshold(command.withdrawBelow)) {
    return { error: 'withdrawBelow must be 0..1' };
  }

  const combatants = (stack: Stack): Combatant[] =>
    stack.unitIds.map((id) => {
      const unit = state.units[id]!;
      return { id, type: content.units[unit.typeId]!, hits: unit.hits };
    });

  const ctx = battleContextAt(state, target.pos);
  const mods = battleModifiers(combatants(own), combatants(target), ctx);
  // City garrisons never retreat; field stacks follow their standing order.
  // Evade needs the map (milestone 2), so it fights like Hold for now.
  const defenderThreshold = !ctx.city && target.stance.kind === 'fall-back' ? target.stance.threshold : undefined;
  const result = resolveBattle(state.rng, mods.attackers, mods.defenders, {
    attackerThreshold: command.withdrawBelow,
    defenderThreshold,
  });

  const units = { ...state.units };
  const stacks = { ...state.stacks };
  const settle = (stack: Stack, hits: number[]) => {
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
  };
  // Retreating stacks stay in place until milestone 2 adds retreat hexes.
  settle(own, result.attackerHits);
  settle(target, result.defenderHits);

  return {
    state: { ...state, rng: result.rng, units, stacks },
    events: [
      {
        kind: 'battle',
        attackerStackId: own.id,
        defenderStackId: target.id,
        attackerUnitIds: [...own.unitIds],
        defenderUnitIds: [...target.unitIds],
        modifiers: mods.lines,
        outcome: result.outcome,
        events: result.events,
      },
    ],
  };
}
