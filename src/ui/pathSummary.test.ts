import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { createGame } from '../engine/engine';
import { findPath } from '../engine/movement';
import { asciiMap, at } from '../engine/test-fixtures';
import { viewFor } from '../engine/vision';
import { summarizePath } from './pathSummary';

describe('summarizePath', () => {
  // The mockup: along a road past an orc stack, 2 turns, "8 move: road 6, enemy zone +2".
  const map = asciiMap(['..........', '..........', '==========', '..........']);
  const s = createGame(
    {
      seed: 1,
      map,
      players: [
        { id: 'dw', factionId: 'dwarves' },
        { id: 'orc', factionId: 'orc-horde' },
      ],
      stacks: [
        { owner: 'dw', pos: at(2, 2), units: ['infantry'] },
        { owner: 'orc', pos: at(3, 1), units: ['militia'] },
      ],
    },
    fantasy,
  );
  const view = viewFor(s, fantasy, 'dw');

  it('splits this turn\'s cost into terrain and enemy zone', () => {
    const path = findPath(view, fantasy, 's1', at(9, 2), { visible: new Set(view.visible) })!;
    const sum = summarizePath(view, fantasy, 's1', undefined, path);
    expect(sum.turns).toBe(2);
    expect(sum.cost).toBe(8);
    expect(sum.costLine).toBe('8 move: road 6, enemy zone +2');
    expect(sum.turnEnds).toEqual([5, 6]);
  });

  it('warns when a turn ends next to an enemy stack', () => {
    const path = findPath(view, fantasy, 's1', at(3, 2), { visible: new Set(view.visible) })!;
    expect(summarizePath(view, fantasy, 's1', undefined, path).warning).toBe('Turn 1 ends next to an Orc Horde stack');
    const away = findPath(view, fantasy, 's1', at(1, 2), { visible: new Set(view.visible) })!;
    expect(summarizePath(view, fantasy, 's1', undefined, away).warning).toBeNull();
  });
});
