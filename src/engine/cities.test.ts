import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { canBuild, captureAt, forecastProduction, productionBlocker } from './cities';
import { treasuryAfterUpkeep } from './economy';
import { applyCommand, createGame, type GameSetup, replay } from './engine';
import { asciiMap, at } from './test-fixtures';
import type { Command, CommandResult, GameState } from './types';

// p1 holds a city (c0) top left, p2 a city (c1) bottom right; c2 is a neutral village, c3 a p2 capital.
// Domination needs every city here, so these games never end by it.
const map = asciiMap(
  ['........', '........', '........', '........', '........'],
  [
    { at: at(0, 0), tier: 'city', owner: 'p1', builds: ['militia', 'infantry', 'cavalry'] },
    { at: at(7, 4), tier: 'city', owner: 'p2', builds: ['militia'] },
    { at: at(3, 2), tier: 'village' },
    { at: at(5, 0), tier: 'capital', owner: 'p2', builds: ['militia'] },
  ],
  { turnLimit: 40, domination: 1 },
);

function game(stacks: GameSetup['stacks'], startingGold?: number): GameState {
  const setup: GameSetup = {
    seed: 'cities',
    map,
    players: [
      { id: 'p1', factionId: 'dwarves' },
      { id: 'p2', factionId: 'orc-horde' },
    ],
    stacks,
  };
  if (startingGold !== undefined) setup.startingGold = startingGold;
  return createGame(setup, fantasy);
}

function ok(result: CommandResult): GameState {
  if ('error' in result) throw new Error(result.error);
  return result.state;
}

const end = (playerId: string): Command => ({ type: 'EndTurn', playerId });
const build = (siteId: string, unitTypeId: string | null, playerId = 'p1'): Command => ({ type: 'SetProduction', playerId, siteId, unitTypeId });

describe('unique units', () => {
  it('only their own faction builds them, even in a city whose list names them', () => {
    expect(canBuild(fantasy, 'dwarves', 'ironguard')).toBe(true);
    expect(canBuild(fantasy, 'orc-horde', 'ironguard')).toBe(false);
    expect(canBuild(fantasy, 'orc-horde', 'infantry')).toBe(true);
    expect(canBuild(fantasy, 'dwarves', 'hero')).toBe(false); // never built
    // An orc-held city with a dwarf build list.
    const map = asciiMap(['....'], [{ at: at(0, 0), tier: 'city', owner: 'p2', builds: ['militia', 'ironguard'] }, { at: at(3, 0), tier: 'city', owner: 'p1' }]);
    const g = createGame({ seed: 1, map, players: [{ id: 'p1', factionId: 'dwarves' }, { id: 'p2', factionId: 'orc-horde' }], stacks: [] }, fantasy);
    const orcsTurn = ok(applyCommand(g, end('p1'), fantasy));
    expect(applyCommand(orcsTurn, build('c0', 'ironguard', 'p2'), fantasy)).toEqual({ error: 'City 0 cannot build that' });
    expect(ok(applyCommand(orcsTurn, build('c0', 'militia', 'p2'), fantasy)).cities.c0!.production).toEqual({ unitTypeId: 'militia', progress: 0 });
  });
});

describe('SetProduction', () => {
  const s = game([{ owner: 'p1', pos: at(1, 1), units: ['infantry'] }]);

  it('starts building a unit from the city\'s list', () => {
    const next = ok(applyCommand(s, build('c0', 'infantry'), fantasy));
    expect(next.cities.c0!.production).toEqual({ unitTypeId: 'infantry', progress: 0 });
    expect(ok(applyCommand(next, build('c0', null), fantasy)).cities.c0!.production).toBeNull();
  });

  it('rejects cities you do not own, units off the list, and unknown cities', () => {
    expect(applyCommand(s, build('c1', 'militia'), fantasy)).toEqual({ error: 'You do not own that city' });
    expect(applyCommand(s, build('c0', 'griffins'), fantasy)).toMatchObject({ error: expect.stringMatching(/cannot build/) });
    expect(applyCommand(s, build('nope', 'militia'), fantasy)).toEqual({ error: 'No such city' });
  });

  it('keeps progress when the same unit is picked again, and loses it on a change', () => {
    const started = { ...s, cities: { ...s.cities, c0: { ...s.cities.c0!, production: { unitTypeId: 'cavalry', progress: 1 } } } };
    expect(ok(applyCommand(started, build('c0', 'cavalry'), fantasy)).cities.c0!.production).toEqual({ unitTypeId: 'cavalry', progress: 1 });
    expect(ok(applyCommand(started, build('c0', 'militia'), fantasy)).cities.c0!.production).toEqual({ unitTypeId: 'militia', progress: 0 });
    // Stopping loses it too: picking the same unit again starts over.
    const stopped = ok(applyCommand(started, build('c0', null), fantasy));
    expect(ok(applyCommand(stopped, build('c0', 'cavalry'), fantasy)).cities.c0!.production).toEqual({ unitTypeId: 'cavalry', progress: 0 });
  });
});

describe('productionBlocker', () => {
  const s = game([
    { owner: 'p1', pos: at(0, 0), units: Array.from({ length: 8 }, () => 'militia') },
    { owner: 'p2', pos: at(7, 4), units: ['militia'] },
  ]);

  it('blocks on a full stack or another player\'s stack, then on gold', () => {
    expect(productionBlocker(s, at(0, 0), 'p1', 8, 100)).toBe('full');
    expect(productionBlocker(s, at(7, 4), 'p1', 8, 100)).toBe('full'); // someone else's stack stands there
    expect(productionBlocker(s, at(3, 2), 'p1', 16, 15)).toBe('gold');
    expect(productionBlocker(s, at(3, 2), 'p1', 16, 16)).toBeNull();
    expect(productionBlocker(s, at(7, 4), 'p2', 8, 8)).toBeNull(); // joins its own stack
  });
});

describe('forecastProduction', () => {
  it('predicts exactly what the next turn start builds, pays, and holds back', () => {
    // Three dwarf cities in map order: c0 finishes Infantry (16), c1 finishes Archers (15), c2 is halfway on Cavalry.
    const map = asciiMap(
      ['......', '......'],
      [
        { at: at(0, 0), tier: 'city', owner: 'p1', builds: ['infantry'] },
        { at: at(2, 0), tier: 'village', owner: 'p1', builds: ['archers'] },
        { at: at(4, 0), tier: 'city', owner: 'p1', builds: ['cavalry'] },
        { at: at(5, 1), tier: 'city', owner: 'p2', builds: ['militia'] },
      ],
      { turnLimit: 40, domination: 1 },
    );
    const g = createGame({ seed: 1, map, players: [{ id: 'p1', factionId: 'dwarves' }, { id: 'p2', factionId: 'orc-horde' }], stacks: [], startingGold: 0 }, fantasy);
    const s: GameState = {
      ...g,
      turn: 2,
      currentPlayer: 1,
      gold: { p1: 1, p2: 0 },
      cities: {
        ...g.cities,
        c0: { ...g.cities.c0!, production: { unitTypeId: 'infantry', progress: 0 } },
        c1: { ...g.cities.c1!, production: { unitTypeId: 'archers', progress: 0 } },
        c2: { ...g.cities.c2!, production: { unitTypeId: 'cavalry', progress: 0 } },
      },
    };
    // 1 + 25 income: Infantry is paid (10 left), Archers wait for gold, Cavalry is one turn in.
    const gold = treasuryAfterUpkeep(s, fantasy, 'p1', 1).gold;
    expect(gold).toBe(26);
    const forecast = forecastProduction(s, fantasy, 'p1', gold);
    expect(forecast).toEqual([
      { siteId: 'c0', unitTypeId: 'infantry', progress: 1, finishes: true, blocker: null, goldBefore: 26 },
      { siteId: 'c1', unitTypeId: 'archers', progress: 1, finishes: true, blocker: 'gold', goldBefore: 10 },
      { siteId: 'c2', unitTypeId: 'cavalry', progress: 1, finishes: false, blocker: null, goldBefore: 10 },
    ]);
    // The real turn start does the same.
    const r = applyCommand(s, end('p2'), fantasy);
    if ('error' in r) throw new Error(r.error);
    expect(r.events.filter((e) => e.kind === 'unit-built').map((e) => e.kind === 'unit-built' && e.siteId)).toEqual(['c0']);
    expect(r.events).toContainEqual({ kind: 'production-waiting', playerId: 'p1', siteId: 'c1', unitTypeId: 'archers', reason: 'gold' });
    expect(r.state.gold.p1).toBe(10);
    expect(r.state.cities.c2!.production).toEqual({ unitTypeId: 'cavalry', progress: 1 });
  });
});

describe('production', () => {
  it('finishes a 1-turn unit at the start of the next turn and pays for it then', () => {
    const s = game([{ owner: 'p2', pos: at(6, 4), units: ['militia'] }]);
    const r = applyCommand(replay(s, [build('c0', 'infantry'), end('p1')], fantasy), end('p2'), fantasy);
    if ('error' in r) throw new Error(r.error);
    const built = r.events.find((e) => e.kind === 'unit-built');
    expect(built).toMatchObject({ playerId: 'p1', siteId: 'c0', unitTypeId: 'infantry', cost: 16 });
    // 50 starting gold + 10 income from one city − no upkeep − 16 for the infantry.
    expect(r.state.gold.p1).toBe(50 + 10 - 16);
    const stack = Object.values(r.state.stacks).find((st) => st.owner === 'p1')!;
    expect(stack.pos).toEqual(at(0, 0));
    expect(r.state.units[stack.unitIds[0]!]).toMatchObject({ typeId: 'infantry', hits: 2, moveLeft: 8 });
    // The city keeps building the same unit.
    expect(r.state.cities.c0!.production).toEqual({ unitTypeId: 'infantry', progress: 0 });
  });

  it('takes the build time in turns', () => {
    const s = replay(game([]), [build('c0', 'cavalry'), end('p1'), end('p2')], fantasy);
    expect(s.cities.c0!.production).toEqual({ unitTypeId: 'cavalry', progress: 1 });
    expect(Object.values(s.stacks)).toHaveLength(0);
    const t = replay(s, [end('p1'), end('p2')], fantasy);
    expect(Object.values(t.stacks).map((st) => t.units[st.unitIds[0]!]!.typeId)).toEqual(['cavalry']);
  });

  it('waits, keeping progress, when the treasury is short', () => {
    const s = replay(game([], 0), [build('c0', 'infantry'), end('p1')], fantasy);
    const r = applyCommand(s, end('p2'), fantasy);
    if ('error' in r) throw new Error(r.error);
    expect(r.events).toContainEqual({ kind: 'production-waiting', playerId: 'p1', siteId: 'c0', unitTypeId: 'infantry', reason: 'gold' });
    expect(r.state.gold.p1).toBe(10);
    expect(r.state.cities.c0!.production).toEqual({ unitTypeId: 'infantry', progress: 1 });
    // Next turn there is enough.
    const t = replay(r.state, [end('p1'), end('p2')], fantasy);
    expect(t.gold.p1).toBe(20 - 16);
  });

  it('joins the stack in the city, and waits while that stack is full', () => {
    const seven = Array.from({ length: 7 }, () => 'militia');
    const s = replay(game([{ owner: 'p1', pos: at(0, 0), units: seven }], 200), [build('c0', 'militia'), end('p1'), end('p2')], fantasy);
    expect(s.stacks.s1!.unitIds).toHaveLength(8);
    const r = applyCommand(replay(s, [end('p1')], fantasy), end('p2'), fantasy);
    if ('error' in r) throw new Error(r.error);
    expect(r.events).toContainEqual({ kind: 'production-waiting', playerId: 'p1', siteId: 'c0', unitTypeId: 'militia', reason: 'full' });
  });
});

describe('capture', () => {
  const s = game([
    { owner: 'p1', pos: at(2, 2), units: ['infantry'] },
    { owner: 'p1', pos: at(6, 0), units: ['infantry', 'infantry'] },
    { owner: 'p2', pos: at(7, 2), units: ['militia'] },
  ]);
  const intoVillage: Command = { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(3, 2)] };
  const intoCapital: Command = { type: 'Move', playerId: 'p1', stackId: 's2', path: [at(5, 0)] };
  const resolve = (siteId: string, choice: 'occupy' | 'pillage' | 'raze'): Command => ({ type: 'ResolveCapture', playerId: 'p1', siteId, choice });

  it('takes a city a move ends on and waits for the choice', () => {
    const r = applyCommand(s, intoVillage, fantasy);
    if ('error' in r) throw new Error(r.error);
    expect(r.events).toContainEqual({ kind: 'captured', playerId: 'p1', siteId: 'c2', from: null, tier: 'village', stackId: 's1' });
    expect(r.state.cities.c2).toMatchObject({ owner: 'p1', secured: false, held: false });
    expect(r.state.pendingCaptures).toEqual([{ siteId: 'c2', from: null }]);
    expect(applyCommand(r.state, end('p1'), fantasy)).toEqual({ error: 'Choose what to do with the captured cities first' });
    expect(applyCommand(r.state, resolve('c0', 'occupy'), fantasy)).toMatchObject({ error: expect.any(String) });
  });

  it('queues several captures; play goes on, and the turn ends once each is resolved', () => {
    const t = replay(s, [intoVillage, intoCapital], fantasy);
    expect(t.pendingCaptures).toEqual([
      { siteId: 'c2', from: null },
      { siteId: 'c3', from: 'p2' },
    ]);
    // Other commands still run while captures wait.
    const moved = ok(applyCommand(t, { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(3, 3)] }, fantasy));
    const one = ok(applyCommand(moved, resolve('c3', 'pillage'), fantasy));
    expect(one.pendingCaptures).toEqual([{ siteId: 'c2', from: null }]);
    expect(applyCommand(one, end('p1'), fantasy)).toEqual({ error: 'Choose what to do with the captured cities first' });
    const both = ok(applyCommand(one, resolve('c2', 'occupy'), fantasy));
    expect(both.pendingCaptures).toEqual([]);
    expect(both.cities.c2!.owner).toBe('p1'); // the stack left, but the city stays taken
    expect(ok(applyCommand(both, end('p1'), fantasy)).currentPlayer).toBe(1);
  });

  it('occupies: keeps the city and its income', () => {
    const t = replay(s, [intoVillage, resolve('c2', 'occupy')], fantasy);
    expect(t.pendingCaptures).toEqual([]);
    expect(t.cities.c2).toMatchObject({ owner: 'p1', tier: 'village', razed: false });
    expect(t.gold.p1).toBe(50);
  });

  it('pillages: three turns of income now and a tier down; a village is razed', () => {
    const v = replay(s, [intoVillage, resolve('c2', 'pillage')], fantasy);
    expect(v.gold.p1).toBe(65);
    expect(v.cities.c2).toMatchObject({ owner: null, razed: true });
    const c = replay(s, [intoCapital, resolve('c3', 'pillage')], fantasy);
    expect(c.gold.p1).toBe(110);
    expect(c.cities.c3).toMatchObject({ owner: 'p1', tier: 'city', razed: false, production: null });
  });

  it('razes: nobody can use it, and a stack walks over the ruin without taking it', () => {
    const t = replay(s, [intoCapital, resolve('c3', 'raze')], fantasy);
    expect(t.cities.c3).toMatchObject({ owner: null, razed: true });
    expect(applyCommand(t, { type: 'SetProduction', playerId: 'p1', siteId: 'c3', unitTypeId: 'militia' }, fantasy)).toEqual({
      error: 'That city has been razed',
    });
    const back = ok(applyCommand(t, { type: 'Move', playerId: 'p1', stackId: 's2', path: [at(4, 0), at(5, 0)] }, fantasy));
    expect(back.pendingCaptures).toEqual([]);
  });

  it('a stack that falls back into an empty city occupies it without a choice', () => {
    const moved = { ...s, stacks: { ...s.stacks, s3: { ...s.stacks.s3!, pos: at(7, 4) } }, cities: { ...s.cities, c1: { ...s.cities.c1!, owner: 'p1' } } };
    const r = captureAt(moved, 's3', false);
    expect(r.state.cities.c1).toMatchObject({ owner: 'p2', secured: false });
    expect(r.state.pendingCaptures).toEqual([]);
    expect(r.events).toEqual([{ kind: 'captured', playerId: 'p2', siteId: 'c1', from: 'p1', tier: 'city', stackId: 's3' }]);
  });

  it('a pending capture the enemy retakes by falling back into it drops off, and cannot be pillaged', () => {
    // p1 takes the village, then walks out of it; a p2 stack falls back into the empty village.
    const taken = replay(s, [intoVillage, { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(3, 3)] }], fantasy);
    expect(taken.pendingCaptures).toEqual([{ siteId: 'c2', from: null }]);
    const fellBack = captureAt({ ...taken, stacks: { ...taken.stacks, s3: { ...taken.stacks.s3!, pos: at(3, 2) } } }, 's3', false).state;
    expect(fellBack.cities.c2!.owner).toBe('p2');
    expect(fellBack.pendingCaptures).toEqual([]);
    expect(applyCommand(fellBack, resolve('c2', 'pillage'), fantasy)).toEqual({ error: 'There is no capture to resolve there' });
    expect(ok(applyCommand(fellBack, end('p1'), fantasy)).currentPlayer).toBe(1); // nothing left to resolve
    // Even with a stale entry, resolving refuses a city the player no longer holds.
    const stale: GameState = { ...fellBack, pendingCaptures: [{ siteId: 'c2', from: null }] };
    expect(applyCommand(stale, resolve('c2', 'pillage'), fantasy)).toEqual({ error: 'That city is no longer yours' });
  });

  it('a city taken twice in one turn is queued once', () => {
    const first = replay(s, [intoVillage, { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(3, 3)] }], fantasy);
    const lost = captureAt({ ...first, stacks: { ...first.stacks, s3: { ...first.stacks.s3!, pos: at(3, 2) } } }, 's3', false).state;
    // p1 takes it back by advancing in again (the p2 stack moved off for the test).
    const cleared: GameState = { ...lost, stacks: { ...lost.stacks, s3: { ...lost.stacks.s3!, pos: at(7, 2) } } };
    const again = ok(applyCommand(cleared, { type: 'Move', playerId: 'p1', stackId: 's1', path: [at(3, 2)] }, fantasy));
    expect(again.pendingCaptures).toEqual([{ siteId: 'c2', from: 'p2' }]);
    expect(again.cities.c2!.owner).toBe('p1');
  });

  it('an attacker that wins and advances into a city takes it', () => {
    const g = game([
      { owner: 'p1', pos: at(6, 4), units: Array.from({ length: 8 }, () => 'ironguard') },
      { owner: 'p2', pos: at(7, 4), units: [{ typeId: 'militia', hits: 1 }] },
    ]);
    const r = applyCommand(g, { type: 'Attack', playerId: 'p1', stackId: 's1', targetStackId: 's2' }, fantasy);
    if ('error' in r) throw new Error(r.error);
    expect(r.events[0]).toMatchObject({ kind: 'battle', outcome: 'win', attackerAdvanced: true, attackerOwner: 'p1', defenderOwner: 'p2' });
    expect(r.events[1]).toEqual({ kind: 'captured', playerId: 'p1', siteId: 'c1', from: 'p2', tier: 'city', stackId: 's1' });
    expect(r.state.pendingCaptures).toEqual([{ siteId: 'c1', from: 'p2' }]);
  });
});
