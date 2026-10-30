// Movement: per-hex costs (terrain, roads, traits, flying), the soft zone of
// control, reachable sets, and multi-turn pathfinding. Costs are doubled so a
// road costs 1 and plains 2. A stack moves at its slowest unit and pays, for
// each hex, the most any of its units would pay. Zone of control and blocking
// use only enemy stacks visible to the mover, so costs are fixed for the turn.

import { type ContentPack, TAGS } from './content';
import { type Hex, hexKey, neighbors, parseHexKey, sameHex } from './hex';
import { featureAt, terrainAt } from './map';
import { RULES } from './rules';
import type { PlayerId, Stack, World } from './types';
import { visibleEnemyStacks, visibleHexes } from './vision';

/** A group of units about to move: the whole stack or a split-off part. */
export interface Mover {
  owner: PlayerId;
  unitIds: string[];
  /** Per unit: its tags plus its faction's traits. */
  traits: string[][];
  /** Every unit flies: ignores zone of control. */
  flying: boolean;
  /** Every unit ignores zone of control in forest. */
  forestZocImmune: boolean;
}

export function moverFor(world: World, content: ContentPack, owner: PlayerId, unitIds: readonly string[]): Mover {
  const factionId = world.players.find((p) => p.id === owner)?.factionId;
  const factionTraits = (factionId && content.factions[factionId]?.traits) || [];
  const traits = unitIds.map((id) => [...content.units[world.units[id]!.typeId]!.tags, ...factionTraits]);
  return {
    owner,
    unitIds: [...unitIds],
    traits,
    flying: traits.every((t) => t.includes(TAGS.flying)),
    forestZocImmune: traits.every((t) => t.includes(TAGS.forestZocImmune)),
  };
}

export function stackMover(world: World, content: ContentPack, stack: Stack): Mover {
  return moverFor(world, content, stack.owner, stack.unitIds);
}

/** Cost for one unit with these traits to enter `h`; Infinity if it cannot. */
function unitHexCost(world: World, content: ContentPack, traits: readonly string[], h: Hex): number {
  const terrain = content.terrain[terrainAt(world.map, h) ?? ''];
  if (!terrain) return Infinity;
  const feature = featureAt(world.map, h);
  let cost: number;
  if (feature) {
    cost = content.features[feature].moveCost;
  } else {
    const overrides = Object.entries(terrain.traitCosts ?? {}).filter(([t]) => traits.includes(t));
    cost = overrides.length > 0 ? Math.min(...overrides.map(([, c]) => c)) : (terrain.moveCost ?? Infinity);
  }
  return traits.includes(TAGS.flying) ? Math.min(cost, RULES.flyingStepCost) : cost;
}

/** Cost for the mover to enter `h`, ignoring zone of control; Infinity if any unit cannot. */
export function hexCost(world: World, content: ContentPack, mover: Mover, h: Hex): number {
  return Math.max(0, ...mover.traits.map((t) => unitHexCost(world, content, t, h)));
}

/** Every unit of the mover can stand on `h`. */
export function canEnter(world: World, content: ContentPack, mover: Mover, h: Hex): boolean {
  return Number.isFinite(hexCost(world, content, mover, h));
}

/** hexKey -> ids of visible enemy stacks next to that hex. */
export type ZoneOfControl = Record<string, string[]>;

export function zoneOfControl(world: World, playerId: PlayerId, visible: Set<string>): ZoneOfControl {
  const zoc: ZoneOfControl = {};
  for (const enemy of visibleEnemyStacks(world, playerId, visible)) {
    for (const n of neighbors(enemy.pos)) (zoc[hexKey(n)] ??= []).push(enemy.id);
  }
  return zoc;
}

/** The +2 for sliding from one hex next to an enemy stack to another hex next to the same stack. */
export function zocTax(world: World, content: ContentPack, mover: Mover, zoc: ZoneOfControl, from: Hex, to: Hex): number {
  if (mover.flying) return 0;
  if (mover.forestZocImmune && content.terrain[terrainAt(world.map, to) ?? '']?.tags.includes('forest')) return 0;
  const a = zoc[hexKey(from)];
  const b = zoc[hexKey(to)];
  return a && b && a.some((id) => b.includes(id)) ? RULES.zocPenalty : 0;
}

export function stepCost(world: World, content: ContentPack, mover: Mover, zoc: ZoneOfControl, from: Hex, to: Hex): number {
  return hexCost(world, content, mover, to) + zocTax(world, content, mover, zoc, from, to);
}

/** Movement left this turn: the least any moving unit has. */
export function movesLeft(world: World, unitIds: readonly string[]): number {
  return Math.min(...unitIds.map((id) => world.units[id]!.moveLeft));
}

/** Full movement per turn: the slowest moving unit's speed. */
export function fullMove(world: World, content: ContentPack, unitIds: readonly string[]): number {
  return Math.min(...unitIds.map((id) => content.units[world.units[id]!.typeId]!.move));
}

/** What the mover would find on `h`: an enemy stack, a friendly stack, or nothing. */
function occupant(world: World, h: Hex): Stack | undefined {
  return Object.values(world.stacks).find((s) => sameHex(s.pos, h));
}

/** The mover may end its move on `h`: no other stack there, or a friendly one with room to merge. */
export function canStopAt(world: World, mover: Mover, h: Hex, movingFrom?: Stack): boolean {
  const there = occupant(world, h);
  if (!there || there === movingFrom) return true;
  if (there.owner !== mover.owner) return false;
  return there.unitIds.length + mover.unitIds.length <= RULES.maxStackSize;
}

export interface ReachEntry {
  cost: number;
  /** hexKey of the previous hex on the cheapest path; null at the start. */
  prev: string | null;
  /** The move may end here (see canStopAt). */
  canStop: boolean;
}

export interface Reach {
  budget: number;
  /** Hexes reachable this turn, keyed by hexKey. */
  hexes: Record<string, ReachEntry>;
  /** hexKeys under a visible enemy zone of control, for the overlay. */
  contested: string[];
  /** Visible enemy stacks attackable this turn: the hex to attack from and the total cost. */
  attacks: Record<string, { from: string; cost: number }>;
}

export interface MoveQuery {
  /** Move only these units (a split); default the whole stack. */
  unitIds?: string[];
  /** Hexes the mover's owner sees; computed when omitted. */
  visible?: Set<string>;
}

function setup(world: World, content: ContentPack, stackId: string, query: MoveQuery) {
  const stack = world.stacks[stackId];
  if (!stack) throw new Error(`No stack ${stackId}`);
  const unitIds = query.unitIds ?? stack.unitIds;
  const mover = moverFor(world, content, stack.owner, unitIds);
  const visible = query.visible ?? visibleHexes(world, content, stack.owner);
  const zoc = zoneOfControl(world, stack.owner, visible);
  const enemyAt = new Map(visibleEnemyStacks(world, stack.owner, visible).map((s) => [hexKey(s.pos), s]));
  return { stack, unitIds, mover, zoc, enemyAt };
}

/** Dijkstra over hexes; `relax` returns the new label or null. Labels compare by `less`. */
function dijkstra<L>(
  start: Hex,
  startLabel: L,
  less: (a: L, b: L) => boolean,
  relax: (label: L, from: Hex, to: Hex) => L | null,
): Map<string, { label: L; prev: string | null }> {
  const best = new Map<string, { label: L; prev: string | null }>([[hexKey(start), { label: startLabel, prev: null }]]);
  const done = new Set<string>();
  const frontier = [hexKey(start)];
  while (frontier.length > 0) {
    let k = 0;
    for (let x = 1; x < frontier.length; x++) {
      if (less(best.get(frontier[x]!)!.label, best.get(frontier[k]!)!.label)) k = x;
    }
    const key = frontier.splice(k, 1)[0]!;
    if (done.has(key)) continue;
    done.add(key);
    const here = parseHexKey(key);
    const label = best.get(key)!.label;
    for (const n of neighbors(here)) {
      const nk = hexKey(n);
      if (done.has(nk)) continue;
      const next = relax(label, here, n);
      if (next === null) continue;
      const old = best.get(nk);
      if (!old || less(next, old.label)) {
        best.set(nk, { label: next, prev: key });
        frontier.push(nk);
      }
    }
  }
  return best;
}

/** Hexes the stack (or the units in `query.unitIds`) can reach this turn. */
export function reachable(world: World, content: ContentPack, stackId: string, query: MoveQuery = {}): Reach {
  const { stack, unitIds, mover, zoc, enemyAt } = setup(world, content, stackId, query);
  const budget = movesLeft(world, unitIds);
  const found = dijkstra(
    stack.pos,
    0,
    (a, b) => a < b,
    (cost, from, to) => {
      if (enemyAt.has(hexKey(to))) return null;
      const c = cost + stepCost(world, content, mover, zoc, from, to);
      return c <= budget ? c : null;
    },
  );
  const hexes: Record<string, ReachEntry> = {};
  const attacks: Reach['attacks'] = {};
  for (const [key, { label, prev }] of found) {
    const h = parseHexKey(key);
    const canStop = canStopAt(world, mover, h, stack);
    hexes[key] = { cost: label, prev, canStop };
    // Attack from hexes the mover could hold on its own.
    const there = occupant(world, h);
    if (there && there !== stack) continue;
    for (const n of neighbors(h)) {
      const enemy = enemyAt.get(hexKey(n));
      if (!enemy) continue;
      const cost = label + hexCost(world, content, mover, n);
      if (cost <= budget && (!attacks[enemy.id] || cost < attacks[enemy.id]!.cost)) attacks[enemy.id] = { from: key, cost };
    }
  }
  const contested = Object.keys(zoc).filter((k) => found.has(k));
  return { budget, hexes, contested, attacks };
}

/** Steps from the reach result back to the start (excluding it). */
export function pathTo(reach: Reach, goal: Hex): Hex[] | null {
  let key: string | null = hexKey(goal);
  if (!reach.hexes[key]) return null;
  const path: Hex[] = [];
  while (key !== null && reach.hexes[key]!.prev !== null) {
    path.unshift(parseHexKey(key));
    key = reach.hexes[key]!.prev;
  }
  return path;
}

export interface PathStep {
  hex: Hex;
  /** 0 = reached this turn, 1 = next turn, ... */
  turn: number;
  /** Movement spent within that turn after this step. */
  used: number;
}

/**
 * Cheapest route over several turns. A step must fit in the movement left in
 * the current turn, otherwise it waits for the next turn. The first turn uses
 * the movement left now, later turns full movement. If the goal holds a visible
 * enemy, the last step is the attack (no zone-of-control cost). Returns null
 * when there is no route.
 */
export function findPath(world: World, content: ContentPack, stackId: string, goal: Hex, query: MoveQuery = {}): PathStep[] | null {
  const { stack, unitIds, mover, zoc, enemyAt } = setup(world, content, stackId, query);
  const now = movesLeft(world, unitIds);
  const full = fullMove(world, content, unitIds);
  const goalKey = hexKey(goal);
  type Label = { turn: number; used: number };
  const found = dijkstra<Label>(
    stack.pos,
    { turn: 0, used: 0 },
    (a, b) => a.turn < b.turn || (a.turn === b.turn && a.used < b.used),
    (label, from, to) => {
      const key = hexKey(to);
      const attack = enemyAt.has(key);
      if (attack && key !== goalKey) return null;
      const c = attack ? hexCost(world, content, mover, to) : stepCost(world, content, mover, zoc, from, to);
      if (!Number.isFinite(c) || c > full) return null;
      const budget = label.turn === 0 ? now : full;
      return label.used + c <= budget ? { turn: label.turn, used: label.used + c } : { turn: label.turn + 1, used: c };
    },
  );
  const end = found.get(goalKey);
  if (!end || sameHex(goal, stack.pos)) return null;
  if (!enemyAt.has(goalKey) && !canStopAt(world, mover, goal, stack)) return null;
  const steps: PathStep[] = [];
  let key: string | null = goalKey;
  while (key !== null && found.get(key)!.prev !== null) {
    const entry: { label: Label; prev: string | null } = found.get(key)!;
    const { label, prev } = entry;
    steps.unshift({ hex: parseHexKey(key), turn: label.turn, used: label.used });
    key = prev;
  }
  return steps;
}
