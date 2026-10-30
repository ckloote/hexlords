// The move preview's numbers: turns, this turn's cost split by terrain and
// zone of control ("8 move: road 6, enemy zone +2"), and a warning when a turn
// ends next to an enemy stack.

import type { ContentPack } from '../engine/content';
import { hexDistance, type Hex } from '../engine/hex';
import { featureAt, terrainAt } from '../engine/map';
import { hexCost, moverFor, type PathStep, zocTax, zoneOfControl } from '../engine/movement';
import type { PlayerView } from '../engine/vision';
import { visibleEnemyStacks } from '../engine/vision';

export interface PathSummary {
  turns: number;
  /** Movement spent this turn. */
  cost: number;
  /** e.g. "8 move: road 6, enemy zone +2" */
  costLine: string;
  /** e.g. "Turn 1 ends next to an Orc Horde stack" */
  warning: string | null;
  /** Index in the path of the last step of each turn. */
  turnEnds: number[];
}

export function summarizePath(
  view: PlayerView,
  content: ContentPack,
  stackId: string,
  unitIds: readonly string[] | undefined,
  path: readonly PathStep[],
): PathSummary {
  const stack = view.stacks[stackId]!;
  const mover = moverFor(view, content, stack.owner, unitIds ?? stack.unitIds);
  const visible = new Set(view.visible);
  const zoc = zoneOfControl(view, stack.owner, visible);
  const parts = new Map<string, number>();
  let zone = 0;
  let cost = 0;
  let from: Hex = stack.pos;
  for (const step of path) {
    if (step.turn > 0) break;
    const feature = featureAt(view.map, step.hex);
    const label = feature ? content.features[feature].name : content.terrain[terrainAt(view.map, step.hex)!]!.name;
    const c = hexCost(view, content, mover, step.hex);
    const tax = zocTax(view, content, mover, zoc, from, step.hex);
    parts.set(label.toLowerCase(), (parts.get(label.toLowerCase()) ?? 0) + c);
    zone += tax;
    cost += c + tax;
    from = step.hex;
  }
  const bits = [...parts].map(([label, n]) => `${label} ${n}`);
  if (zone > 0) bits.push(`enemy zone +${zone}`);

  const turnEnds = path.flatMap((step, k) => (k === path.length - 1 || path[k + 1]!.turn !== step.turn ? [k] : []));
  const enemies = visibleEnemyStacks(view, stack.owner, visible);
  let warning: string | null = null;
  for (const k of turnEnds) {
    const near = enemies.find((e) => hexDistance(e.pos, path[k]!.hex) === 1);
    if (near) {
      const faction = view.players.find((p) => p.id === near.owner)?.factionId;
      const name = (faction && content.factions[faction]?.name) || 'enemy';
      warning = `Turn ${path[k]!.turn + 1} ends next to ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} stack`;
      break;
    }
  }
  return {
    turns: path.length ? path[path.length - 1]!.turn + 1 : 0,
    cost,
    costLine: bits.length ? `${cost} move: ${bits.join(', ')}` : 'No movement',
    warning,
    turnEnds,
  };
}
