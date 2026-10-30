import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { applyCommand, createGame, type GameSetup, replay } from './engine';
import type { MapState } from './map';
import { asciiMap, at } from './test-fixtures';
import { turnLimitWinner } from './turn';
import type { Command, GameEvent, GameState } from './types';

const end = (playerId: string): Command => ({ type: 'EndTurn', playerId });

// p1: a city (c0) and a village (c2); p2: a city (c1); p3 (when present): a village (c3).
function board(victory: MapState['victory'] = { turnLimit: 40, domination: 1 }): MapState {
  return asciiMap(
    ['........', '........', '........', '........', '........'],
    [
      { at: at(0, 0), tier: 'city', owner: 'p1' },
      { at: at(7, 4), tier: 'city', owner: 'p2' },
      { at: at(0, 4), tier: 'village', owner: 'p1' },
      { at: at(7, 0), tier: 'village', owner: 'p3' },
    ],
    victory,
  );
}

function game(stacks: GameSetup['stacks'], opts: { map?: MapState; three?: boolean; gold?: number } = {}): GameState {
  const players = [
    { id: 'p1', factionId: 'dwarves' },
    { id: 'p2', factionId: 'orc-horde' },
  ];
  if (opts.three) players.push({ id: 'p3', factionId: 'elves' });
  const map = opts.map ?? board();
  if (!opts.three) map.sites = map.sites.filter((s) => s.startOwner !== 'p3');
  const setup: GameSetup = { seed: 'turns', map, players, stacks };
  if (opts.gold !== undefined) setup.startingGold = opts.gold;
  return createGame(setup, fantasy);
}

function step(s: GameState, command: Command): { state: GameState; events: GameEvent[] } {
  const r = applyCommand(s, command, fantasy);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('income and upkeep', () => {
  it('skips the first round, then pays income minus upkeep at the start of each turn', () => {
    const s = game([{ owner: 'p1', pos: at(3, 2), units: ['infantry', 'ironguard', 'hero'] }]);
    const first = step(s, end('p1'));
    expect(first.events.find((e) => e.kind === 'income')).toBeUndefined();
    expect(first.state.gold.p2).toBe(50);
    const second = step(first.state, end('p2'));
    expect(second.events).toContainEqual({ kind: 'turn-started', playerId: 'p1', turn: 2 });
    // City 10 + village 5; infantry 2 + ironguard 4 + hero 0.
    expect(second.events).toContainEqual({ kind: 'income', playerId: 'p1', income: 15, upkeep: 6, gold: 59 });
    expect(second.state.gold.p1).toBe(59);
  });

  it('when gold runs out, the costliest unit deserts and the treasury stays at zero', () => {
    const big = Array.from({ length: 4 }, () => 'griffins');
    const s = game([{ owner: 'p1', pos: at(3, 2), units: [...big, 'militia', 'hero'] }], { gold: 0 });
    const r = step(step(s, end('p1')).state, end('p2'));
    const deserted = r.events.filter((e) => e.kind === 'deserted');
    expect(deserted).toHaveLength(1);
    expect(deserted[0]).toMatchObject({ playerId: 'p1', unitTypeId: 'griffins' });
    expect(r.state.gold.p1).toBe(0);
    expect(r.state.stacks.s1!.unitIds).toHaveLength(5);
    expect(r.events).toContainEqual({ kind: 'income', playerId: 'p1', income: 15, upkeep: 17, gold: 0 });
  });
});

describe('healing', () => {
  const wounded = { typeId: 'infantry', hits: 1 };
  const hurtTroll = { typeId: 'trolls', hits: 1 };
  /** p1 acts on turn 1; healing happens at the start of p1's turn 2. */
  const afterRound = (s: GameState, p1Moves: Command[]) => replay(s, [...p1Moves, end('p1'), end('p2')], fantasy);

  it('heals 1 hit in the field for a stack that did not move or fight', () => {
    const s = game([{ owner: 'p1', pos: at(3, 2), units: [{ typeId: 'ironguard', hits: 1 }] }]);
    const r = step(step(s, end('p1')).state, end('p2'));
    expect(r.state.units.u1!.hits).toBe(2);
    expect(r.events).toContainEqual({ kind: 'healed', playerId: 'p1', hits: 1 });
  });

  it('does not heal a stack that moved, except regenerating units', () => {
    const s = game([{ owner: 'p1', pos: at(3, 2), units: [wounded, hurtTroll] }]);
    const t = afterRound(s, [{ type: 'Move', playerId: 'p1', stackId: 's1', path: [at(4, 2)] }]);
    expect(t.units.u1!.hits).toBe(1);
    expect(t.units.u2!.hits).toBe(2);
    expect(t.units.u1!.acted).toBeUndefined();
  });

  it('heals 2 hits in a friendly city, even after moving', () => {
    const s = game([{ owner: 'p1', pos: at(1, 0), units: [{ typeId: 'ironguard', hits: 1 }] }]);
    const t = afterRound(s, [{ type: 'Move', playerId: 'p1', stackId: 's1', path: [at(0, 0)] }]);
    expect(t.units.u1!.hits).toBe(3);
  });

  it('a stack that was attacked does not heal in the field', () => {
    const s = game([
      { owner: 'p1', pos: at(3, 2), units: Array.from({ length: 3 }, () => ({ typeId: 'ironguard', hits: 2 })) },
      { owner: 'p2', pos: at(4, 2), units: ['militia'] },
    ]);
    const attacked = replay(s, [end('p1'), { type: 'Attack', playerId: 'p2', stackId: 's2', targetStackId: 's1' }], fantasy);
    const hurt = attacked.stacks.s1!.unitIds;
    expect(hurt.length).toBeGreaterThan(0);
    const r = step(attacked, end('p2'));
    for (const id of hurt) expect(r.state.units[id]!.hits).toBe(attacked.units[id]!.hits);
  });
});

describe('secured cities and victory', () => {
  it('secures a captured city after a full round of holding it', () => {
    const s = game([{ owner: 'p1', pos: at(6, 4), units: ['infantry'] }, { owner: 'p2', pos: at(3, 2), units: ['militia'] }]);
    const p2: GameState = { ...s, cities: { ...s.cities, c3: { owner: 'p2', tier: 'village', razed: false, production: null, heldSince: 0, secured: true } } };
    p2.map = { ...p2.map, sites: [...p2.map.sites, { id: 'c3', kind: 'city', name: 'Spare', pos: at(4, 4), tier: 'village', startOwner: 'p2', builds: [] }] };
    let t = replay(p2, [
      { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(7, 4)] },
      { type: 'ResolveCapture', playerId: 'p1', siteId: 'c1', choice: 'occupy' },
      end('p1'),
      end('p2'),
    ], fantasy);
    expect(t.turn).toBe(2);
    expect(t.cities.c1).toMatchObject({ owner: 'p1', heldSince: 2, secured: false });
    const r = step(step(t, end('p1')).state, end('p2'));
    expect(r.events).toContainEqual({ kind: 'secured', playerId: 'p1', siteId: 'c1' });
    t = r.state;
    expect(t.cities.c1!.secured).toBe(true);
  });

  it('wins by domination at the start of a turn with the share of income secured', () => {
    // 25 total; p1 starts with 15 secured, which is at least 60%.
    const s = game([], { map: board({ turnLimit: 40, domination: 0.6 }) });
    const r = step(step(s, end('p1')).state, end('p2'));
    expect(r.state.winner).toEqual({ playerId: 'p1', reason: 'domination' });
    expect(r.events).toContainEqual({ kind: 'game-over', winner: { playerId: 'p1', reason: 'domination' } });
    expect(applyCommand(r.state, end('p1'), fantasy)).toEqual({ error: 'The game is over' });
  });

  it('eliminates a player who starts a turn with no city, disbanding their units', () => {
    const s = game([
      { owner: 'p1', pos: at(6, 4), units: ['infantry'] },
      { owner: 'p2', pos: at(3, 2), units: ['militia'] },
      { owner: 'p3', pos: at(5, 2), units: ['militia'] },
    ], { three: true });
    const t = replay(s, [
      { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(7, 4)] },
      { type: 'ResolveCapture', playerId: 'p1', siteId: 'c1', choice: 'raze' },
    ], fantasy);
    const r = step(t, end('p1'));
    expect(r.events).toContainEqual({ kind: 'eliminated', playerId: 'p2' });
    expect(r.state.players.find((p) => p.id === 'p2')!.eliminated).toBe(true);
    expect(r.state.stacks.s2).toBeUndefined();
    expect(r.state.players[r.state.currentPlayer]!.id).toBe('p3');
    expect(r.state.winner).toBeUndefined();
  });

  it('the last player standing wins', () => {
    const s = game([{ owner: 'p1', pos: at(6, 4), units: ['infantry'] }]);
    const t = replay(s, [
      { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(7, 4)] },
      { type: 'ResolveCapture', playerId: 'p1', siteId: 'c1', choice: 'occupy' },
    ], fantasy);
    expect(step(t, end('p1')).state.winner).toEqual({ playerId: 'p1', reason: 'last-standing' });
  });

  it('after the last turn, the highest secured score wins, then the larger army', () => {
    const s = game([{ owner: 'p2', pos: at(3, 2), units: ['griffins'] }], { map: board({ turnLimit: 2, domination: 1 }) });
    const t = replay(s, [end('p1'), end('p2'), end('p1')], fantasy);
    expect(t.winner).toBeUndefined();
    expect(step(t, end('p2')).state.winner).toEqual({ playerId: 'p1', reason: 'turn-limit' });
    // Equal score: the army decides; equal armies: a draw.
    const level = { ...s, cities: { ...s.cities, c2: { ...s.cities.c2!, owner: null, razed: true } } };
    expect(turnLimitWinner(level, fantasy)).toBe('p2');
    const noArmy = { ...level, stacks: {}, units: {} };
    expect(turnLimitWinner(noArmy, fantasy)).toBeNull();
  });
});
