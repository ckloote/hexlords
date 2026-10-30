import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { createGame, type GameSetup } from './engine';
import { type Hex, hexDistance, hexKey, neighbors } from './hex';
import type { MapState } from './map';
import { findPath, hexCost, moverFor, reachable, stepCost, zoneOfControl } from './movement';
import { asciiMap, at, plainsMap } from './test-fixtures';
import type { GameState } from './types';
import { visibleHexes } from './vision';

const players = [
  { id: 'dw', factionId: 'dwarves' },
  { id: 'orc', factionId: 'orc-horde' },
  { id: 'elf', factionId: 'elves' },
];

function game(map: MapState, stacks: GameSetup['stacks']): GameState {
  return createGame({ seed: 1, map, players, stacks }, fantasy);
}

const costOf = (s: GameState, owner: string, typeIds: string[], h: Hex) => {
  const ids = Object.values(s.units)
    .filter((u) => typeIds.includes(u.typeId))
    .map((u) => u.id);
  return hexCost(s, fantasy, moverFor(s, fantasy, owner, ids.slice(0, typeIds.length)), h);
};

describe('hex costs', () => {
  const map = asciiMap(['=.fhs~BFmw']);
  const s = game(map, [
    { owner: 'orc', pos: at(1, 0), units: ['infantry'] },
  ]);
  const cost = (owner: string, units: string[], col: number) => {
    const st = game(map, [{ owner, pos: at(1, 0), units }]);
    const stack = Object.values(st.stacks)[0]!;
    return hexCost(st, fantasy, moverFor(st, fantasy, owner, stack.unitIds), at(col, 0));
  };

  it('uses the doubled terrain costs, with bridges and fords crossing rivers', () => {
    expect([0, 1, 2, 3, 4].map((c) => cost('orc', ['infantry'], c))).toEqual([1, 2, 4, 4, 6]);
    expect(cost('orc', ['infantry'], 5)).toBe(Infinity); // river
    expect(cost('orc', ['infantry'], 6)).toBe(1); // bridge
    expect(cost('orc', ['infantry'], 7)).toBe(4); // ford
    expect(cost('orc', ['infantry'], 8)).toBe(Infinity); // mountains
    expect(cost('orc', ['infantry'], 9)).toBe(Infinity); // water
    expect(costOf(s, 'orc', ['infantry'], at(1, 0))).toBe(2);
  });

  it('applies faction traits to every unit of the faction', () => {
    expect(cost('dw', ['infantry'], 8)).toBe(6); // mountain-walker
    expect(cost('dw', ['hero'], 8)).toBe(6);
    expect(cost('elf', ['infantry'], 2)).toBe(2); // forest-native
    expect(cost('elf', ['infantry'], 3)).toBe(4); // hills unchanged
  });

  it('lets fliers cross anything at 2, roads still 1', () => {
    expect([0, 2, 4, 5, 8, 9].map((c) => cost('orc', ['griffins'], c))).toEqual([1, 2, 2, 2, 2, 2]);
  });

  it('charges a mixed stack its most expensive unit', () => {
    expect(cost('orc', ['infantry', 'griffins'], 2)).toBe(4);
    expect(cost('orc', ['infantry', 'griffins'], 8)).toBe(Infinity);
    expect(cost('dw', ['ironguard', 'griffins'], 8)).toBe(6);
  });
});

describe('soft zone of control', () => {
  const s = game(plainsMap(9, 7), [
    { owner: 'orc', pos: at(4, 3), units: ['infantry'] },
    { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
    { owner: 'dw', pos: at(8, 6), units: ['griffins'] },
  ]);
  const enemy = at(4, 3);
  const ring = neighbors(enemy);
  // The dwarves' own scouts are far away; use the orcs' view so the orc stack counts as seen.
  const fullZoc = zoneOfControl(s, 'dw', visibleHexes(s, fantasy, 'orc'));
  const foot = moverFor(s, fantasy, 'dw', s.stacks.s2!.unitIds);
  const flier = moverFor(s, fantasy, 'dw', s.stacks.s3!.unitIds);
  const away = (h: Hex) => ({ q: h.q + (h.q - enemy.q), r: h.r + (h.r - enemy.r) });

  it('taxes only sliding past: approach and back away cost normal movement', () => {
    expect(fullZoc[hexKey(ring[0]!)]).toEqual(['s1']);
    expect(stepCost(s, fantasy, foot, fullZoc, away(ring[0]!), ring[0]!)).toBe(2); // approach
    expect(stepCost(s, fantasy, foot, fullZoc, ring[0]!, ring[1]!)).toBe(4); // slide past
    expect(stepCost(s, fantasy, foot, fullZoc, ring[0]!, away(ring[0]!))).toBe(2); // back away
  });

  it('ignores zone of control for fliers', () => {
    expect(stepCost(s, fantasy, flier, fullZoc, ring[0]!, ring[1]!)).toBe(2);
  });

  it('counts only visible enemies', () => {
    expect(stepCost(s, fantasy, foot, zoneOfControl(s, 'dw', new Set()), ring[0]!, ring[1]!)).toBe(2);
  });

  it('Rangers ignore it when stepping into forest', () => {
    const map = asciiMap(['.....', '.f...', '.....']);
    const st = game(map, [
      { owner: 'orc', pos: at(2, 0), units: ['infantry'] },
      { owner: 'elf', pos: at(1, 0), units: ['rangers'] },
      { owner: 'dw', pos: at(1, 2), units: ['infantry'] },
    ]);
    const z = zoneOfControl(st, 'elf', new Set(Object.keys(st.explored.elf!)));
    const rangers = moverFor(st, fantasy, 'elf', st.stacks.s2!.unitIds);
    // (1,0) and (1,1) are both next to the orcs at (2,0); (1,1) is forest.
    expect(hexDistance(at(1, 0), at(1, 1))).toBe(1);
    expect(hexDistance(at(2, 0), at(1, 1))).toBe(1);
    expect(stepCost(st, fantasy, rangers, z, at(1, 0), at(1, 1))).toBe(2); // forest-native 2, no tax
    const dwarves = moverFor(st, fantasy, 'dw', st.stacks.s3!.unitIds);
    const zd = zoneOfControl(st, 'dw', new Set(Object.keys(st.explored.elf!)));
    expect(stepCost(st, fantasy, dwarves, zd, at(1, 0), at(1, 1))).toBe(6); // forest 4 + 2
  });
});

describe('reachable', () => {
  it('matches the mockup: road 6 + enemy zone 2 = 8', () => {
    // Road along row 2; the orc stack at (3,1) touches road hexes (3,2) and (4,2).
    const map = asciiMap(['........', '........', '========', '........']);
    const s = game(map, [
      { owner: 'dw', pos: at(0, 2), units: ['infantry'] },
      { owner: 'orc', pos: at(3, 1), units: ['militia'] },
    ]);
    // The orcs are 3 hexes away, outside default vision: unseen, they cost nothing extra.
    expect(reachable(s, fantasy, 's1').hexes[hexKey(at(6, 2))]!.cost).toBe(6);
    // Once seen (here: everything visible), sliding past them costs +2.
    const visible = new Set(Object.keys(s.explored.dw!).concat(Object.keys(s.explored.orc!)));
    const reach = reachable(s, fantasy, 's1', { visible });
    expect(reach.budget).toBe(8);
    expect(reach.hexes[hexKey(at(6, 2))]!.cost).toBe(8);
    expect(reach.hexes[hexKey(at(7, 2))]).toBeUndefined();
    expect(reach.contested).toContain(hexKey(at(3, 2)));
    expect(reach.contested).toContain(hexKey(at(4, 2)));
    expect(reach.hexes[hexKey(at(3, 1))]).toBeUndefined(); // enemy hex is not a move target
    expect(reach.attacks.s2).toEqual({ from: hexKey(at(3, 2)), cost: 5 }); // road 1+1+1, then plains 2
  });

  it('reaches 4 plains hexes with 8 movement, and nothing needs a partial step', () => {
    const s = game(plainsMap(11, 11), [{ owner: 'orc', pos: at(5, 5), units: ['infantry'] }]);
    const reach = reachable(s, fantasy, 's1');
    const dist = Object.keys(reach.hexes).map((k) => hexDistance(JSON.parse(`{"q":${k.split(',')[0]},"r":${k.split(',')[1]}}`), at(5, 5)));
    expect(Math.max(...dist)).toBe(4);
    expect(Object.keys(reach.hexes)).toHaveLength(61);
    // With 3 left, a forest hex (4) is out of reach and a plains hex (2) is not.
    const forest = game(asciiMap(['.f.']), [{ owner: 'orc', pos: at(0, 0), units: ['infantry'] }]);
    const tired = { ...forest, units: { ...forest.units, u1: { ...forest.units.u1!, moveLeft: 3 } } };
    expect(reachable(tired, fantasy, 's1').hexes[hexKey(at(1, 0))]).toBeUndefined();
  });

  it('moves at the slowest unit, and a full friendly stack can be passed but not joined', () => {
    const s = game(plainsMap(9, 3), [
      { owner: 'dw', pos: at(0, 1), units: ['infantry', 'siege-engine'] },
      { owner: 'dw', pos: at(1, 1), units: Array.from({ length: 8 }, () => 'militia') },
    ]);
    const reach = reachable(s, fantasy, 's1');
    expect(reach.budget).toBe(6);
    expect(reach.hexes[hexKey(at(1, 1))]!.canStop).toBe(false);
    expect(reach.hexes[hexKey(at(3, 1))]!.cost).toBe(6);
    // A split of just the infantry has 8 movement.
    expect(reachable(s, fantasy, 's1', { unitIds: ['u1'] }).budget).toBe(8);
  });
});

describe('findPath', () => {
  const map = asciiMap([
    '..........',
    '..........',
    '~~~~~~~~B~',
    '..........',
    '..........',
  ]);

  it('crosses at the bridge and spreads the route over turns', () => {
    const s = game(map, [{ owner: 'orc', pos: at(1, 0), units: ['infantry'] }]);
    const path = findPath(s, fantasy, 's1', at(1, 4))!;
    expect(path).not.toBeNull();
    expect(path.some((p) => hexKey(p.hex) === hexKey(at(8, 2)))).toBe(true);
    expect(path.at(-1)!.hex).toEqual(at(1, 4));
    // Turns never decrease and each turn spends at most 8.
    path.forEach((p, k) => {
      expect(p.used).toBeLessThanOrEqual(8);
      if (k > 0) expect(p.turn).toBeGreaterThanOrEqual(path[k - 1]!.turn);
    });
    expect(path.at(-1)!.turn).toBeGreaterThan(0);
  });

  it('a flier goes straight over the river', () => {
    const s = game(map, [{ owner: 'orc', pos: at(1, 0), units: ['griffins'] }]);
    const path = findPath(s, fantasy, 's1', at(1, 4))!;
    expect(path).toHaveLength(4);
    expect(path.every((p) => p.turn === 0)).toBe(true);
  });

  it('returns null with no crossing', () => {
    const closed = asciiMap(['.....', '~~~~~', '.....']);
    const s = game(closed, [{ owner: 'orc', pos: at(0, 0), units: ['infantry'] }]);
    expect(findPath(s, fantasy, 's1', at(0, 2))).toBeNull();
  });

  it('waits for the next turn rather than taking a partial step', () => {
    // 8 movement: plains 2, forest 4 (6 used); the next forest (4) does not fit
    // in the 2 left, so it starts turn 1 and those 2 points are lost.
    const s = game(asciiMap(['..ff']), [{ owner: 'orc', pos: at(0, 0), units: ['infantry'] }]);
    const path = findPath(s, fantasy, 's1', at(3, 0))!;
    expect(path.map((p) => [p.turn, p.used])).toEqual([
      [0, 2],
      [0, 6],
      [1, 4],
    ]);
  });

  it('can end on a visible enemy as an attack', () => {
    const s = game(plainsMap(6, 1), [
      { owner: 'orc', pos: at(0, 0), units: ['infantry'] },
      { owner: 'dw', pos: at(2, 0), units: ['infantry'] },
    ]);
    const path = findPath(s, fantasy, 's1', at(2, 0))!;
    expect(path.map((p) => p.hex)).toEqual([at(1, 0), at(2, 0)]);
    // An enemy it cannot see is just an occupied hex: no route to it.
    const far = game(plainsMap(6, 1), [
      { owner: 'orc', pos: at(0, 0), units: ['infantry'] },
      { owner: 'dw', pos: at(3, 0), units: ['infantry'] },
    ]);
    expect(findPath(far, fantasy, 's1', at(3, 0))).toBeNull();
  });
});
