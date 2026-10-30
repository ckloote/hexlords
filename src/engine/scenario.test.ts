import { describe, expect, it } from 'vitest';
import { fantasy, testMapJson } from '../content/fantasy';
import { previewAttack } from './combat';
import { applyCommand, createGame, type GameSetup, replay } from './engine';
import { siteAt } from './map';
import { findPath } from './movement';
import { at } from './test-fixtures';
import { loadTiledMap } from './tiled';
import type { Command, GameState } from './types';
import { viewFor } from './vision';

const map = loadTiledMap(testMapJson, fantasy);
const setup: GameSetup = {
  seed: 'gravelmaw',
  map,
  players: [
    { id: 'p1', factionId: 'dwarves' },
    { id: 'p2', factionId: 'orc-horde' },
  ],
  stacks: [
    // Borin's Host on the road just south of Gravelmaw.
    {
      owner: 'p1',
      pos: at(6, 3),
      units: ['siege-engine', 'infantry', { typeId: 'infantry', hits: 1 }, 'ironguard', 'hero'],
    },
    // The Gravelmaw garrison.
    { owner: 'p2', pos: at(6, 2), units: ['militia', 'militia', 'infantry', 'infantry', 'trolls'] },
    // A dwarf column south of the river, and an orc patrol in the east.
    { owner: 'p1', pos: at(6, 14), units: ['infantry', 'infantry'] },
    { owner: 'p2', pos: at(11, 5), units: ['cavalry'] },
  ],
};

describe('the test map', () => {
  it('reproduces the mockup\'s attack on Gravelmaw from the map, the content, and the view', () => {
    const s = createGame(setup, fantasy);
    expect(siteAt(map, at(6, 2))).toMatchObject({ name: 'Gravelmaw', tier: 'city' });
    const view = viewFor(s, fantasy, 'p1');
    const hold = previewAttack(view, fantasy, 's1', 's2');
    const careful = previewAttack(view, fantasy, 's1', 's2', 0.3);
    if ('error' in hold || hold.evades || 'error' in careful || careful.evades) throw new Error('unexpected');
    expect(hold.modifiers.lines).toEqual([
      { side: 'attacker', source: 'leadership', pct: 25 },
      { side: 'defender', source: 'city', pct: 25 },
      { side: 'defender', source: 'siege', pct: -25 },
    ]);
    expect(hold.odds.win).toBeCloseTo(0.8062, 4);
    expect(careful.odds.win).toBeCloseTo(0.7891, 4);
    expect(careful.odds.withdraw).toBeCloseTo(0.0738, 4);
    expect(careful.odds.expectedAttackers).toBeCloseTo(1.494, 3);
  });

  it('plays a scripted turn sequence that replays identically and survives JSON', () => {
    // The orcs also hold Hollow Pine, so losing Gravelmaw does not eliminate them.
    const begin = () => createGame(setup, fantasy);
    expect(begin().cities.site2).toMatchObject({ owner: 'p2', secured: true });
    const start = begin();
    const route = findPath(start, fantasy, 's3', at(6, 7))!;
    expect(route.some((p) => p.hex.q === at(6, 8).q && p.hex.r === at(6, 8).r)).toBe(true); // over the bridge
    const commands: Command[] = [
      { type: 'Attack', playerId: 'p1', stackId: 's1', targetStackId: 's2', withdrawBelow: 0.3 },
      // This seed wins: the host advances into Gravelmaw and takes it.
      { type: 'ResolveCapture', playerId: 'p1', siteId: 'site1', choice: 'occupy' },
      { type: 'Move', playerId: 'p1', stackId: 's3', path: route.map((p) => p.hex) },
      { type: 'EndTurn', playerId: 'p1' },
      { type: 'SetStance', playerId: 'p2', stackId: 's4', stance: { kind: 'evade' } },
      { type: 'EndTurn', playerId: 'p2' },
    ];
    const a = replay(begin(), commands, fantasy);
    const b = replay(begin(), commands, fantasy);
    expect(a).toEqual(b);
    const roundTrip = JSON.parse(JSON.stringify(a)) as GameState;
    expect(roundTrip).toEqual(a);
    // Play continues from the deserialized state exactly as from the original.
    const next: Command = { type: 'EndTurn', playerId: 'p1' };
    expect(applyCommand(roundTrip, next, fantasy)).toEqual(applyCommand(a, next, fantasy));
    expect(a.turn).toBe(2);
    expect(a.cities.site1).toMatchObject({ owner: 'p1', secured: false });
    expect(Object.keys(a.explored.p1!).length).toBeGreaterThan(Object.keys(start.explored.p1!).length);
  });
});
