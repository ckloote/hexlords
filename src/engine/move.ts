// The Move command: walk a path, paying terrain and zone-of-control costs,
// splitting off units and merging onto a friendly stack as needed. A move goes
// as far as movement allows and saves the path's end as the stack's
// destination; it stops early when a step brings a new enemy stack into view.

import type { ContentPack } from './content';
import { hexDistance, hexesWithin, hexKey, type Hex, sameHex } from './hex';
import { canStopAt, hexCost, moverFor, movesLeft, stepCost, zoneOfControl } from './movement';
import { RULES } from './rules';
import type { Command, CommandResult, GameState, MoveReport, Stack } from './types';
import { visibleEnemyStacks, visibleHexes, visionRadius } from './vision';

type MoveCommand = Extract<Command, { type: 'Move' }>;

export function applyMove(state: GameState, command: MoveCommand, content: ContentPack): CommandResult {
  const stack = state.stacks[command.stackId];
  if (!stack || stack.owner !== command.playerId) return { error: 'You do not own that stack' };
  const unitIds = command.unitIds ?? stack.unitIds;
  if (unitIds.length === 0 || new Set(unitIds).size !== unitIds.length) return { error: 'unitIds must be distinct and non-empty' };
  if (unitIds.some((id) => !stack.unitIds.includes(id))) return { error: 'Some units are not in that stack' };
  const path = command.path;
  if (path.length === 0) return { error: 'The path is empty' };

  const mover = moverFor(state, content, stack.owner, unitIds);
  const visible = visibleHexes(state, content, stack.owner);
  const zoc = zoneOfControl(state, stack.owner, visible);
  const seen = new Set(visibleEnemyStacks(state, stack.owner, visible).map((s) => s.id));
  const enemies = Object.values(state.stacks).filter((s) => s.owner !== stack.owner);
  const budget = movesLeft(state, unitIds);
  const last = path[path.length - 1]!;
  const host = Object.values(state.stacks).find((s) => s !== stack && s.owner === stack.owner && sameHex(s.pos, last));
  if (host && host.unitIds.length + unitIds.length > RULES.maxStackSize) {
    return { error: `The move cannot end there: a stack holds at most ${RULES.maxStackSize} units` };
  }

  let pos = stack.pos;
  let spent = 0;
  let stop = { index: -1, spent: 0 };
  let stopped: MoveReport['stopped'];
  for (let k = 0; k < path.length; k++) {
    const next = path[k]!;
    if (hexDistance(pos, next) !== 1) return { error: `Step ${k + 1} is not adjacent` };
    const enemy = enemies.find((e) => sameHex(e.pos, next));
    if (enemy && seen.has(enemy.id)) return { error: 'The path runs into an enemy stack; attack it instead' };
    if (enemy) {
      stopped = 'spotted'; // unseen until now; cannot happen with vision of 1 or more
      break;
    }
    if (!Number.isFinite(hexCost(state, content, mover, next))) return { error: `Step ${k + 1}: cannot enter that hex` };
    const cost = stepCost(state, content, mover, zoc, pos, next);
    if (spent + cost > budget) {
      stopped = 'movement';
      break;
    }
    spent += cost;
    pos = next;
    if (canStopAt(state, mover, pos, unitIds.length === stack.unitIds.length ? stack : undefined)) {
      stop = { index: k, spent };
    }
    // Did this step reveal an enemy stack?
    const around = new Set(hexesWithin(pos, visionRadius(state, content, unitIds, pos)).map(hexKey));
    if (enemies.some((e) => !seen.has(e.id) && around.has(hexKey(e.pos)))) {
      stopped = 'spotted';
      break;
    }
  }
  if (stop.index < 0) {
    if (stopped === 'movement' && spent === 0) return { error: 'Not enough movement for the first step' };
    return { error: 'The move cannot end there: a stack holds at most 8 units' };
  }
  const unfinished = stop.index < path.length - 1;
  if (unfinished) stopped ??= 'blocked';
  const end = path[stop.index]!;

  const units = { ...state.units };
  for (const id of unitIds) units[id] = { ...units[id]!, moveLeft: units[id]!.moveLeft - stop.spent, acted: true };

  const stacks = { ...state.stacks };
  let nextId = state.nextId;
  let moving: Stack;
  if (unitIds.length === stack.unitIds.length) {
    moving = { ...stack, pos: end };
  } else {
    stacks[stack.id] = { ...stack, unitIds: stack.unitIds.filter((id) => !unitIds.includes(id)) };
    moving = { id: `s${nextId++}`, owner: stack.owner, pos: end, unitIds: [...unitIds], stance: { ...stack.stance } };
  }
  delete moving.destination;
  if (unfinished) moving.destination = last;

  const report: MoveReport = { kind: 'moved', stackId: moving.id, from: stack.pos, path: path.slice(0, stop.index + 1) };
  if (stopped) report.stopped = stopped;
  // A split that loops back to its start rejoins the stack it left.
  const joined = Object.values(stacks).find((s) => s.id !== moving.id && sameHex(s.pos, end));
  if (joined) {
    stacks[joined.id] = { ...joined, unitIds: [...joined.unitIds, ...moving.unitIds] };
    if (moving.id === stack.id) delete stacks[stack.id];
    report.mergedInto = joined.id;
  } else {
    stacks[moving.id] = moving;
  }
  return { state: { ...state, units, stacks, nextId }, events: [report] };
}

/** Restores movement for `playerId`'s units at the start of their turn; units that retreated get half. */
export function restoreMovement(state: GameState, content: ContentPack, playerId: string, penaltyPct: number): GameState {
  const units = { ...state.units };
  for (const stack of Object.values(state.stacks)) {
    if (stack.owner !== playerId) continue;
    for (const id of stack.unitIds) {
      const unit = units[id]!;
      const full = content.units[unit.typeId]!.move;
      const restored = { ...unit, moveLeft: unit.retreated ? Math.floor((full * (100 - penaltyPct)) / 100) : full };
      delete restored.retreated;
      units[id] = restored;
    }
  }
  return { ...state, units };
}

