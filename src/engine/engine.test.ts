import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { applyCommand, createGame, type GameSetup, replay } from './engine';
import { plainsMap } from './test-fixtures';
import type { Command, GameState } from './types';

const setup: GameSetup = {
  seed: 'test',
  map: plainsMap(10, 10),
  players: [
    { id: 'p1', factionId: 'dwarves' },
    { id: 'p2', factionId: 'orc-horde' },
  ],
  stacks: [
    { owner: 'p1', pos: { q: 0, r: 0 }, units: ['siege-engine', 'infantry', { typeId: 'infantry', hits: 1 }, 'ironguard', 'hero'] },
    { owner: 'p2', pos: { q: 1, r: 0 }, units: ['militia', 'militia', 'infantry', 'infantry', 'trolls'] },
    { owner: 'p2', pos: { q: 5, r: 5 }, units: ['militia'] },
  ],
};

function ok(result: ReturnType<typeof applyCommand>): GameState {
  if ('error' in result) throw new Error(result.error);
  return result.state;
}

describe('createGame', () => {
  it('builds a JSON-safe state', () => {
    const state = createGame(setup, fantasy);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(Object.keys(state.stacks)).toHaveLength(3);
    expect(Object.keys(state.units)).toHaveLength(11);
    expect(state.units[state.stacks.s1!.unitIds[2]!]!.hits).toBe(1);
  });

  it('rejects unknown unit types, factions, and oversize stacks', () => {
    expect(() => createGame({ ...setup, stacks: [{ owner: 'p1', pos: { q: 0, r: 0 }, units: ['nope'] }] }, fantasy)).toThrow();
    expect(() => createGame({ ...setup, players: [{ id: 'p1', factionId: 'nope' }] }, fantasy)).toThrow();
    const nine = Array.from({ length: 9 }, () => 'militia');
    expect(() => createGame({ ...setup, stacks: [{ owner: 'p1', pos: { q: 0, r: 0 }, units: nine }] }, fantasy)).toThrow();
  });
});

describe('applyCommand: Attack', () => {
  const attack: Command = { type: 'Attack', playerId: 'p1', stackId: 's1', targetStackId: 's2', withdrawBelow: 0.3 };

  it('resolves a battle, removes the dead, keeps wounds, and does not mutate the input', () => {
    const state = createGame(setup, fantasy);
    const before = JSON.stringify(state);
    const result = applyCommand(state, attack, fantasy);
    expect(JSON.stringify(state)).toBe(before);
    if ('error' in result) throw new Error(result.error);
    const next = result.state;
    expect(next.rng).not.toEqual(state.rng);
    const report = result.events[0]!;
    expect(report.kind).toBe('battle');
    for (const stack of Object.values(next.stacks)) {
      for (const id of stack.unitIds) expect(next.units[id]!.hits).toBeGreaterThan(0);
    }
    // Dead units are gone from the unit table too.
    const listed = Object.values(next.stacks).flatMap((s) => s.unitIds);
    expect(Object.keys(next.units).sort()).toEqual(listed.sort());
    // A destroyed side's stack is removed.
    if (report.kind === 'battle' && report.outcome === 'win') expect(next.stacks.s2).toBeUndefined();
    if (report.kind === 'battle' && report.outcome === 'destroyed') expect(next.stacks.s1).toBeUndefined();
  });

  it('applies modifiers from the content pack (hero leadership)', () => {
    const result = applyCommand(createGame(setup, fantasy), attack, fantasy);
    if ('error' in result) throw new Error(result.error);
    const report = result.events[0]!;
    expect(report.kind === 'battle' && report.modifiers).toEqual([{ side: 'attacker', source: 'leadership', pct: 25 }]);
  });

  it('replays identically from the seed and the command log', () => {
    const commands: Command[] = [attack, { type: 'EndTurn', playerId: 'p1' }];
    const a = replay(createGame(setup, fantasy), commands, fantasy);
    const b = replay(createGame(setup, fantasy), commands, fantasy);
    expect(a).toEqual(b);
    // Different seeds diverge somewhere across many battles.
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const r = applyCommand(createGame({ ...setup, seed }, fantasy), attack, fantasy);
      if (!('error' in r)) outcomes.add(JSON.stringify(r.state.units));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('a defender on fall-back can withdraw; one on hold never does', () => {
    let fellBack = 0;
    for (let seed = 0; seed < 200; seed++) {
      const base = createGame({ ...setup, seed }, fantasy);
      const s = ok(
        applyCommand(base, { type: 'SetStance', playerId: 'p1', stackId: 's1', stance: { kind: 'hold' } }, fantasy),
      );
      // Give the defender a fall-back order directly (it's p1's turn).
      s.stacks.s2 = { ...s.stacks.s2!, stance: { kind: 'fall-back', threshold: 0.5 } };
      const r = applyCommand(s, { ...attack, withdrawBelow: undefined }, fantasy);
      if ('error' in r) throw new Error(r.error);
      const report = r.events[0]!;
      if (report.kind === 'battle' && report.outcome === 'defender-withdraw') fellBack++;
      const held = applyCommand(base, { ...attack, withdrawBelow: undefined }, fantasy);
      if ('error' in held) throw new Error(held.error);
      expect(held.events[0]!.kind === 'battle' && (held.events[0] as { outcome: string }).outcome).not.toBe(
        'defender-withdraw',
      );
    }
    expect(fellBack).toBeGreaterThan(0);
  });

  it('rejects invalid attacks', () => {
    const state = createGame(setup, fantasy);
    const err = (c: Command) => {
      const r = applyCommand(state, c, fantasy);
      expect('error' in r).toBe(true);
    };
    err({ ...attack, playerId: 'p2' }); // not p2's turn
    err({ ...attack, stackId: 's2', targetStackId: 's1' }); // p1 does not own s2
    err({ ...attack, targetStackId: 's3' }); // not adjacent
    err({ ...attack, targetStackId: 'zz' }); // unknown stack
    err({ ...attack, withdrawBelow: 1.5 });
    const own = createGame(
      { ...setup, stacks: [setup.stacks[0]!, { owner: 'p1', pos: { q: 1, r: 0 }, units: ['militia'] }] },
      fantasy,
    );
    expect('error' in applyCommand(own, { ...attack }, fantasy)).toBe(true); // own stack
  });
});

describe('applyCommand: turns and stances', () => {
  it('EndTurn passes play and advances the turn after the last player', () => {
    let s = createGame(setup, fantasy);
    expect(s.turn).toBe(1);
    s = ok(applyCommand(s, { type: 'EndTurn', playerId: 'p1' }, fantasy));
    expect(s.currentPlayer).toBe(1);
    expect(s.turn).toBe(1);
    s = ok(applyCommand(s, { type: 'EndTurn', playerId: 'p2' }, fantasy));
    expect(s.currentPlayer).toBe(0);
    expect(s.turn).toBe(2);
  });

  it('SetStance validates ownership and threshold', () => {
    const s = createGame(setup, fantasy);
    const r = ok(
      applyCommand(s, { type: 'SetStance', playerId: 'p1', stackId: 's1', stance: { kind: 'fall-back', threshold: 0.3 } }, fantasy),
    );
    expect(r.stacks.s1!.stance).toEqual({ kind: 'fall-back', threshold: 0.3 });
    expect(s.stacks.s1!.stance).toEqual({ kind: 'hold' });
    expect('error' in applyCommand(s, { type: 'SetStance', playerId: 'p1', stackId: 's2', stance: { kind: 'hold' } }, fantasy)).toBe(true);
    expect(
      'error' in applyCommand(s, { type: 'SetStance', playerId: 'p1', stackId: 's1', stance: { kind: 'fall-back', threshold: -1 } }, fantasy),
    ).toBe(true);
  });

  it('commands from later milestones return an error, not a throw', () => {
    const s = createGame(setup, fantasy);
    const r = applyCommand(s, { type: 'Move', playerId: 'p1', stackId: 's1', path: [] }, fantasy);
    expect(r).toEqual({ error: 'Move is not implemented yet' });
  });
});
