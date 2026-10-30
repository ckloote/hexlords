// Vision and fog of war. Each unit sees RULES.defaultVision hexes unless its
// type says otherwise; a stack on terrain with a vision bonus (hills) sees
// farther. Cities see for their owner.

import type { ContentPack } from './content';
import { type Hex, hexesWithin, hexKey } from './hex';
import { inBounds, terrainAt } from './map';
import { RULES } from './rules';
import type { CityState, GameState, PlayerId, Stack, Winner, World } from './types';

/** Vision radius of these units standing on `pos`: the best unit's vision plus the terrain bonus. */
export function visionRadius(world: World, content: ContentPack, unitIds: readonly string[], pos: Hex): number {
  const unitVision = Math.max(0, ...unitIds.map((id) => content.units[world.units[id]!.typeId]!.vision ?? RULES.defaultVision));
  const terrain = content.terrain[terrainAt(world.map, pos) ?? ''];
  return unitVision + (terrain?.visionBonus ?? 0);
}

export function stackVision(world: World, content: ContentPack, stack: Stack): number {
  return visionRadius(world, content, stack.unitIds, stack.pos);
}

/** hexKeys `playerId` can see right now. */
export function visibleHexes(world: World, content: ContentPack, playerId: PlayerId): Set<string> {
  const seen = new Set<string>();
  const add = (center: Stack['pos'], radius: number) => {
    for (const h of hexesWithin(center, radius)) if (inBounds(world.map, h)) seen.add(hexKey(h));
  };
  for (const stack of Object.values(world.stacks)) {
    if (stack.owner === playerId) add(stack.pos, stackVision(world, content, stack));
  }
  for (const site of world.map.sites) if (world.cities[site.id]?.owner === playerId) add(site.pos, RULES.cityVision);
  return seen;
}

/** Enemy stacks of `playerId` standing on a visible hex. */
export function visibleEnemyStacks(world: World, playerId: PlayerId, visible: Set<string>): Stack[] {
  return Object.values(world.stacks).filter((s) => s.owner !== playerId && visible.has(hexKey(s.pos)));
}

/**
 * What one player may know: the map, every player's public record, their own
 * stacks, and the enemy stacks they can see right now, stance included
 * (stances are public). No RNG state, so the future cannot be predicted.
 * The AI reads only this, as a multiplayer server would send it.
 */
export interface PlayerView extends World {
  viewer: PlayerId;
  contentId: string;
  turn: number;
  currentPlayer: number;
  /** hexKeys visible now. */
  visible: string[];
  /** hexKeys ever seen. */
  explored: string[];
  /** The viewer's own treasury; other players' gold is private. */
  gold: number;
  /** The viewer's captures awaiting a choice (empty unless it is their turn). */
  pendingCaptures: string[];
  winner?: Winner;
}

export function viewFor(state: GameState, content: ContentPack, playerId: PlayerId): PlayerView {
  const visible = visibleHexes(state, content, playerId);
  const stacks: World['stacks'] = {};
  const units: World['units'] = {};
  for (const stack of Object.values(state.stacks)) {
    if (stack.owner !== playerId && !visible.has(hexKey(stack.pos))) continue;
    stacks[stack.id] = cloneStack(stack);
    for (const id of stack.unitIds) units[id] = { ...state.units[id]! };
  }
  const view: PlayerView = {
    viewer: playerId,
    contentId: state.contentId,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    map: state.map,
    players: state.players.map((p) => ({ ...p })),
    cities: viewCities(state.cities, playerId),
    stacks,
    units,
    visible: [...visible].sort(),
    explored: Object.keys(state.explored[playerId] ?? {}).sort(),
    gold: state.gold[playerId] ?? 0,
    pendingCaptures: state.players[state.currentPlayer]?.id === playerId ? [...state.pendingCaptures] : [],
  };
  if (state.winner) view.winner = { ...state.winner };
  return view;
}

/** Ownership, tier, and secured status are public; only the owner sees what a city is building. */
function viewCities(cities: Record<string, CityState>, playerId: PlayerId): Record<string, CityState> {
  const out: Record<string, CityState> = {};
  for (const [id, c] of Object.entries(cities)) {
    out[id] = { ...c, production: c.owner === playerId && c.production ? { ...c.production } : null };
  }
  return out;
}

function cloneStack(stack: Stack): Stack {
  const copy: Stack = { ...stack, pos: { ...stack.pos }, unitIds: [...stack.unitIds], stance: { ...stack.stance } };
  if (stack.destination) copy.destination = { ...stack.destination };
  return copy;
}
