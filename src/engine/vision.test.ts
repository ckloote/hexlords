import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { createGame, type GameSetup, refreshExplored } from './engine';
import { hexDistance, hexKey, parseHexKey } from './hex';
import type { MapState } from './map';
import { asciiMap, at, plainsMap } from './test-fixtures';
import { viewFor, visibleHexes } from './vision';

const players = [
  { id: 'dw', factionId: 'dwarves' },
  { id: 'orc', factionId: 'orc-horde' },
];
const game = (map: MapState, stacks: GameSetup['stacks']) => createGame({ seed: 1, map, players, stacks }, fantasy);
const radius = (keys: Iterable<string>, center: ReturnType<typeof at>) =>
  Math.max(...[...keys].map((k) => hexDistance(parseHexKey(k), center)));

describe('vision', () => {
  it('sees 2 hexes by default', () => {
    const s = game(plainsMap(11, 11), [{ owner: 'dw', pos: at(5, 5), units: ['infantry'] }]);
    const seen = visibleHexes(s, fantasy, 'dw');
    expect(seen.size).toBe(19);
    expect(radius(seen, at(5, 5))).toBe(2);
  });

  it('sees 1 farther from hills', () => {
    const rows = Array.from({ length: 11 }, (_, r) => (r === 5 ? '.....h.....' : '...........'));
    const s = game(asciiMap(rows), [{ owner: 'dw', pos: at(5, 5), units: ['infantry'] }]);
    expect(visibleHexes(s, fantasy, 'dw').size).toBe(37);
  });

  it('lets cities see for their owner, and clips to the map', () => {
    const map = asciiMap(['.....', '.....', '.....'], [{ at: at(0, 0), tier: 'village', owner: 'orc' }]);
    const s = game(map, [{ owner: 'dw', pos: at(4, 2), units: ['infantry'] }]);
    const orc = visibleHexes(s, fantasy, 'orc');
    expect(orc.has(hexKey(at(0, 0)))).toBe(true);
    expect([...orc].every((k) => hexDistance(parseHexKey(k), at(0, 0)) <= 2)).toBe(true);
    expect(visibleHexes(s, fantasy, 'dw').has(hexKey(at(0, 0)))).toBe(false);
  });

  it('remembers explored hexes after moving away', () => {
    const s = game(plainsMap(12, 3), [{ owner: 'dw', pos: at(1, 1), units: ['infantry'] }]);
    const moved = refreshExplored({ ...s, stacks: { s1: { ...s.stacks.s1!, pos: at(10, 1) } } }, fantasy);
    expect(moved.explored.dw![hexKey(at(1, 1))]).toBe(true);
    expect(moved.explored.dw![hexKey(at(10, 1))]).toBe(true);
    expect(visibleHexes(moved, fantasy, 'dw').has(hexKey(at(1, 1)))).toBe(false);
  });
});

describe('viewFor', () => {
  const s = game(plainsMap(12, 3), [
    { owner: 'dw', pos: at(1, 1), units: ['infantry'] },
    { owner: 'orc', pos: at(3, 1), units: ['militia'], stance: { kind: 'fall-back', threshold: 0.4 } },
    { owner: 'orc', pos: at(10, 1), units: ['trolls'] },
  ]);

  it('shows own stacks and visible enemies, with their stance, and hides the rest', () => {
    const view = viewFor(s, fantasy, 'dw');
    expect(Object.keys(view.stacks).sort()).toEqual(['s1', 's2']);
    expect(view.stacks.s2!.stance).toEqual({ kind: 'fall-back', threshold: 0.4 });
    expect(Object.keys(view.units).sort()).toEqual(['u1', 'u2']);
    expect('rng' in view).toBe(false);
    expect(view.explored.length).toBeGreaterThan(0);
    expect(view.visible).toContain(hexKey(at(3, 1)));
  });

  it('is plain data and leaves the state alone', () => {
    const before = JSON.stringify(s);
    const view = viewFor(s, fantasy, 'orc');
    view.stacks.s2!.unitIds.push('x');
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(Object.keys(view.stacks).sort()).toEqual(['s1', 's2', 's3']);
  });
});
