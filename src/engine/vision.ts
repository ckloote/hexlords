// Vision and fog of war. Each unit sees RULES.defaultVision hexes unless its
// type says otherwise; a stack on terrain with a vision bonus (hills) sees
// farther. Cities see for their owner.

import type { ContentPack } from './content';
import { hexesWithin, hexKey } from './hex';
import { inBounds, terrainAt } from './map';
import { RULES } from './rules';
import type { PlayerId, Stack, World } from './types';

/** Vision radius of a stack where it stands. */
export function stackVision(world: World, content: ContentPack, stack: Stack): number {
  const unitVision = Math.max(
    0,
    ...stack.unitIds.map((id) => content.units[world.units[id]!.typeId]!.vision ?? RULES.defaultVision),
  );
  const terrain = content.terrain[terrainAt(world.map, stack.pos) ?? ''];
  return unitVision + (terrain?.visionBonus ?? 0);
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
  for (const site of world.map.sites) if (site.owner === playerId) add(site.pos, RULES.cityVision);
  return seen;
}

/** Enemy stacks of `playerId` standing on a visible hex. */
export function visibleEnemyStacks(world: World, playerId: PlayerId, visible: Set<string>): Stack[] {
  return Object.values(world.stacks).filter((s) => s.owner !== playerId && visible.has(hexKey(s.pos)));
}
