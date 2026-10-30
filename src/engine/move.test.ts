import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { applyCommand, createGame, type GameSetup } from './engine';
import type { Hex } from './hex';
import type { MapState } from './map';
import { asciiMap, at, plainsMap } from './test-fixtures';
import type { Command, GameState } from './types';

const players = [
  { id: 'dw', factionId: 'dwarves' },
  { id: 'orc', factionId: 'orc-horde' },
];
const game = (map: MapState, stacks: GameSetup['stacks']) => createGame({ seed: 1, map, players, stacks }, fantasy);

function run(s: GameState, c: Command) {
  const r = applyCommand(s, c, fantasy);
  if ('error' in r) throw new Error(r.error);
  return r;
}
const move = (stackId: string, path: Hex[], unitIds?: string[]): Command => ({ type: 'Move', playerId: 'dw', stackId, path, unitIds });
const err = (s: GameState, c: Command) => {
  const r = applyCommand(s, c, fantasy);
  return 'error' in r ? r.error : null;
};

describe('Move', () => {
  it('moves along the path and spends movement', () => {
    const s = game(asciiMap(['..f...']), [{ owner: 'dw', pos: at(0, 0), units: ['infantry'] }]);
    const { state, events } = run(s, move('s1', [at(1, 0), at(2, 0)]));
    expect(state.stacks.s1!.pos).toEqual(at(2, 0));
    expect(state.units.u1!.moveLeft).toBe(2); // 8 - plains 2 - forest 4
    expect(events).toEqual([{ kind: 'moved', stackId: 's1', from: at(0, 0), path: [at(1, 0), at(2, 0)] }]);
    expect(s.stacks.s1!.pos).toEqual(at(0, 0)); // input untouched
  });

  it('goes as far as movement allows and saves the destination', () => {
    const s = game(plainsMap(8, 1), [{ owner: 'dw', pos: at(0, 0), units: ['infantry'] }]);
    const path = [1, 2, 3, 4, 5, 6].map((c) => at(c, 0));
    const { state, events } = run(s, move('s1', path));
    expect(state.stacks.s1!.pos).toEqual(at(4, 0));
    expect(state.stacks.s1!.destination).toEqual(at(6, 0));
    expect(events[0]).toMatchObject({ stopped: 'movement' });
    expect(err(state, move('s1', [at(5, 0)]))).toMatch(/movement/i);
  });

  it('rejects bad paths', () => {
    const s = game(asciiMap(['.~....']), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
      { owner: 'orc', pos: at(3, 0), units: ['militia'] },
    ]);
    expect(err(s, move('s1', []))).toMatch(/empty/i);
    expect(err(s, move('s1', [at(2, 0)]))).toMatch(/adjacent/i);
    expect(err(s, move('s1', [at(1, 0)]))).toMatch(/cannot enter/i);
    expect(err(s, move('s2', [at(4, 0)]))).toMatch(/own/i);
    expect(err(s, move('s1', [at(0, 1)], ['u2']))).toMatch(/not in/i);
  });

  it('will not walk into a visible enemy (that is an Attack)', () => {
    const s = game(plainsMap(4, 1), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
      { owner: 'orc', pos: at(2, 0), units: ['militia'] },
    ]);
    expect(err(s, move('s1', [at(1, 0), at(2, 0)]))).toMatch(/attack/i);
  });

  it('stops when a step reveals a hidden enemy stack', () => {
    const s = game(plainsMap(9, 1), [
      { owner: 'dw', pos: at(0, 0), units: ['cavalry'] },
      { owner: 'orc', pos: at(5, 0), units: ['militia'] },
    ]);
    const { state, events } = run(s, move('s1', [1, 2, 3, 4].map((c) => at(c, 0))));
    // At (3,0) the orcs at (5,0) come into view: stop there, keeping the destination.
    expect(state.stacks.s1!.pos).toEqual(at(3, 0));
    expect(events[0]).toMatchObject({ stopped: 'spotted' });
    expect(state.stacks.s1!.destination).toEqual(at(4, 0));
    // Not spotted after the first step (they are 4 away), so it got that far.
    expect(state.units.u1!.moveLeft).toBe(12 - 6);
  });

  it('splits off units with unitIds and merges onto a friendly stack up to 8', () => {
    const s = game(plainsMap(6, 1), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry', 'militia', 'cavalry'] },
      { owner: 'dw', pos: at(3, 0), units: Array.from({ length: 6 }, () => 'militia') },
    ]);
    const split = run(s, move('s1', [at(1, 0)], ['u3'])).state;
    expect(split.stacks.s1!.unitIds).toEqual(['u1', 'u2']);
    const newStack = Object.values(split.stacks).find((st) => st.unitIds.includes('u3'))!;
    expect(newStack.pos).toEqual(at(1, 0));
    expect(newStack.id).not.toBe('s1');
    expect(split.units.u1!.moveLeft).toBe(8); // the units left behind keep their movement
    // The two left in s1 pass through the split-off stack and join the 6 at (3,0): 8 is fine.
    const merged = run(split, move('s1', [at(1, 0), at(2, 0), at(3, 0)]));
    expect(merged.state.stacks.s1).toBeUndefined();
    expect(merged.state.stacks.s2!.unitIds).toHaveLength(8);
    expect(merged.events[0]).toMatchObject({ kind: 'moved', mergedInto: 's2' });
    // A ninth unit cannot join.
    expect(err(merged.state, { type: 'Move', playerId: 'dw', stackId: newStack.id, path: [at(2, 0), at(3, 0)] })).toMatch(/8/);
  });

  it('a split that loops back to its start rejoins the stack', () => {
    const s = game(plainsMap(4, 1), [{ owner: 'dw', pos: at(0, 0), units: ['infantry', 'militia'] }]);
    const { state } = run(s, move('s1', [at(1, 0), at(0, 0)], ['u2']));
    expect(Object.keys(state.stacks)).toEqual(['s1']);
    expect(state.stacks.s1!.unitIds).toEqual(['u1', 'u2']);
  });

  it('a merged stack moves as far as its most-spent unit can', () => {
    const s = game(plainsMap(8, 1), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
      { owner: 'dw', pos: at(3, 0), units: ['infantry'] },
    ]);
    const merged = run(s, move('s1', [at(1, 0), at(2, 0), at(3, 0)])).state;
    expect(merged.stacks.s2!.unitIds).toEqual(['u2', 'u1']);
    // u1 has 2 left: one plains hex; the end of the path is saved as the destination.
    const moved = run(merged, move('s2', [at(4, 0), at(5, 0)]));
    expect(moved.state.stacks.s2!.pos).toEqual(at(4, 0));
    expect(moved.events[0]).toMatchObject({ stopped: 'movement' });
    expect(moved.state.stacks.s2!.destination).toEqual(at(5, 0));
    // Reaching it (next turn) clears it.
    const next = run(run(moved.state, { type: 'EndTurn', playerId: 'dw' }).state, { type: 'EndTurn', playerId: 'orc' }).state;
    expect(run(next, move('s2', [at(5, 0)])).state.stacks.s2!.destination).toBeUndefined();
  });

  it('pays the zone-of-control tax when sliding past a seen enemy', () => {
    // Road along row 2; orcs at (3,1) are in view from the start (2 hexes from (2,2)).
    const map = asciiMap(['........', '........', '========', '........']);
    const s = game(map, [
      { owner: 'dw', pos: at(2, 2), units: ['infantry'] },
      { owner: 'orc', pos: at(3, 1), units: ['militia'] },
    ]);
    // Approach (3,2) 1, slide to (4,2) 1+2, then 1 and 1.
    const { state } = run(s, move('s1', [3, 4, 5, 6].map((c) => at(c, 2))));
    expect(state.units.u1!.moveLeft).toBe(8 - (1 + 1 + 3 + 1));
  });
});

describe('ClearDestination', () => {
  it('drops a saved destination, for the owner only', () => {
    const s = game(plainsMap(8, 1), [{ owner: 'dw', pos: at(0, 0), units: ['infantry'] }]);
    const moved = run(s, move('s1', [1, 2, 3, 4, 5, 6].map((c) => at(c, 0)))).state;
    expect(moved.stacks.s1!.destination).toEqual(at(6, 0));
    const cleared = run(moved, { type: 'ClearDestination', playerId: 'dw', stackId: 's1' }).state;
    expect(cleared.stacks.s1!.destination).toBeUndefined();
    expect(moved.stacks.s1!.destination).toEqual(at(6, 0));
    expect(err(moved, { type: 'ClearDestination', playerId: 'dw', stackId: 'nope' })).toMatch(/own/);
  });
});

describe('turn start', () => {
  it('restores movement for the player whose turn begins', () => {
    const s = game(plainsMap(6, 3), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
      { owner: 'orc', pos: at(5, 2), units: ['militia'] },
    ]);
    let st = run(s, move('s1', [at(1, 0)])).state;
    expect(st.units.u1!.moveLeft).toBe(6);
    st = run(st, { type: 'EndTurn', playerId: 'dw' }).state;
    expect(st.units.u1!.moveLeft).toBe(6); // not dw's turn yet
    st = run(st, { type: 'EndTurn', playerId: 'orc' }).state;
    expect(st.units.u1!.moveLeft).toBe(8);
  });

  it('halves movement for units that retreated, once', () => {
    const s = game(plainsMap(6, 3), [
      { owner: 'dw', pos: at(0, 0), units: ['infantry'] },
      { owner: 'orc', pos: at(5, 2), units: ['cavalry'] },
    ]);
    const marked: GameState = { ...s, units: { ...s.units, u2: { ...s.units.u2!, retreated: true } } };
    let st = run(marked, { type: 'EndTurn', playerId: 'dw' }).state;
    expect(st.units.u2!.moveLeft).toBe(6);
    expect(st.units.u2!.retreated).toBeUndefined();
    st = run(run(st, { type: 'EndTurn', playerId: 'orc' }).state, { type: 'EndTurn', playerId: 'dw' }).state;
    expect(st.units.u2!.moveLeft).toBe(12);
  });
});
