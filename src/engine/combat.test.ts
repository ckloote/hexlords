import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { battleContextAt, planAttack, previewAttack, retreatHex } from './combat';
import { applyCommand, createGame, type GameSetup } from './engine';
import { type Hex, hexDistance, neighbors, toOffset } from './hex';
import type { CityTier } from './map';
import { computeOdds } from './odds';
import { asciiMap } from './test-fixtures';
import type { BattleReport, Command, GameState, Stance } from './types';
import { viewFor } from './vision';

const players = [
  { id: 'dw', factionId: 'dwarves' },
  { id: 'orc', factionId: 'orc-horde' },
];

// The attacker (orc, s1) stands at A and attacks the defender (dwarves, s2) at D.
const A: Hex = { q: 3, r: 3 };
const D: Hex = { q: 4, r: 3 };
const REAR = neighbors(D).filter((h) => hexDistance(h, A) === 2);

/** A 9x7 plains map with some hexes overridden by map characters. */
function board(overrides: [Hex, string][] = [], cities: { at: Hex; tier: CityTier; owner?: string }[] = []) {
  const rows = Array.from({ length: 7 }, () => [...'.........']);
  for (const [h, ch] of overrides) {
    const { col, row } = toOffset(h);
    rows[row]![col] = ch;
  }
  return asciiMap(rows.map((r) => r.join('')), cities);
}

function game(opts: {
  overrides?: [Hex, string][];
  cities?: { at: Hex; tier: CityTier; owner?: string }[];
  attackers?: string[];
  defenders?: string[];
  stance?: Stance;
  extra?: GameSetup['stacks'];
  seed?: number;
}): GameState {
  return createGame(
    {
      seed: opts.seed ?? 1,
      map: board(opts.overrides, opts.cities),
      players: [players[1]!, players[0]!], // orcs move first
      stacks: [
        { owner: 'orc', pos: A, units: opts.attackers ?? ['infantry'] },
        { owner: 'dw', pos: D, units: opts.defenders ?? ['infantry'], stance: opts.stance },
        ...(opts.extra ?? []),
      ],
    },
    fantasy,
  );
}

const attack = (withdrawBelow?: number): Command => ({ type: 'Attack', playerId: 'orc', stackId: 's1', targetStackId: 's2', withdrawBelow });
function run(s: GameState, c: Command = attack()) {
  const r = applyCommand(s, c, fantasy);
  if ('error' in r) throw new Error(r.error);
  return { state: r.state, report: r.events[0] as BattleReport };
}
/** Runs the attack over seeds until the outcome matches. */
function until(make: (seed: number) => GameState, outcome: BattleReport['outcome'], c: Command = attack()) {
  for (let seed = 0; seed < 300; seed++) {
    const r = run(make(seed), c);
    if (r.report.outcome === outcome) return r;
  }
  throw new Error(`no ${outcome} in 300 seeds`);
}

describe('battle context on the map', () => {
  it('gives the defender its terrain bonus', () => {
    for (const ch of ['f', 'h']) {
      const s = game({ overrides: [[D, ch]] });
      expect(battleContextAt(s, fantasy, A, D)).toEqual({ terrainDefensePct: 25 });
    }
    expect(battleContextAt(game({ overrides: [[A, 'f']] }), fantasy, A, D)).toEqual({ terrainDefensePct: 0 });
  });

  it('a city replaces the terrain bonus', () => {
    const s = game({ overrides: [[D, 'f']], cities: [{ at: D, tier: 'capital', owner: 'dw' }] });
    const plan = planAttack(s, fantasy, 's1', 's2');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.modifiers.lines).toEqual([{ side: 'defender', source: 'city', pct: 50 }]);
    expect(plan.garrison).toBe(true);
  });

  it('applies −25% only when attacking off a ford onto the bank', () => {
    const offFord = game({ overrides: [[A, 'F']] });
    expect(battleContextAt(offFord, fantasy, A, D).acrossFord).toBe(true);
    const ontoFord = game({ overrides: [[D, 'F']], defenders: ['infantry'] });
    expect(battleContextAt(ontoFord, fantasy, A, D).acrossFord).toBeUndefined();
    const both = game({ overrides: [[A, 'F'], [D, 'F']] });
    expect(battleContextAt(both, fantasy, A, D).acrossFord).toBeUndefined();
  });
});

describe('retreat hexes', () => {
  it('uses only the three hexes behind the defender, in direction order', () => {
    expect(REAR).toHaveLength(3);
    const s = game({});
    expect(retreatHex(s, fantasy, s.stacks.s2!, A)).toEqual(REAR[0]);
  });

  it('skips hexes some unit cannot enter or an enemy holds', () => {
    const s = game({ overrides: [[REAR[0]!, '~']], extra: [{ owner: 'orc', pos: REAR[1]!, units: ['militia'] }] });
    expect(retreatHex(s, fantasy, s.stacks.s2!, A)).toEqual(REAR[2]);
    // Griffins could fly over the river, but the infantry with them cannot.
    const mixed = game({ overrides: [[REAR[0]!, '~'], [REAR[1]!, '~'], [REAR[2]!, '~']], defenders: ['griffins', 'infantry'] });
    expect(retreatHex(mixed, fantasy, mixed.stacks.s2!, A)).toBeNull();
    const fliers = game({ overrides: [[REAR[0]!, '~'], [REAR[1]!, '~'], [REAR[2]!, '~']], defenders: ['griffins'] });
    expect(retreatHex(fliers, fantasy, fliers.stacks.s2!, A)).toEqual(REAR[0]);
  });

  it('joins a friendly stack only if the merged stack stays at 8 or fewer', () => {
    const six = Array.from({ length: 6 }, () => 'militia');
    const fits = game({ defenders: ['infantry', 'infantry'], overrides: [[REAR[1]!, 'f'], [REAR[2]!, 'f']], extra: [{ owner: 'dw', pos: REAR[0]!, units: six }] });
    expect(retreatHex(fits, fantasy, fits.stacks.s2!, A)).toEqual(REAR[0]);
    const full = game({ defenders: ['infantry', 'infantry'], overrides: [[REAR[1]!, 'f'], [REAR[2]!, 'f']], extra: [{ owner: 'dw', pos: REAR[0]!, units: [...six, 'militia'] }] });
    expect(retreatHex(full, fantasy, full.stacks.s2!, A)).toEqual(REAR[1]);
  });

  it('prefers a friendly city, then the cheapest hex', () => {
    const city = game({ cities: [{ at: REAR[2]!, tier: 'village', owner: 'dw' }, { at: REAR[1]!, tier: 'city', owner: 'orc' }] });
    expect(retreatHex(city, fantasy, city.stacks.s2!, A)).toEqual(REAR[2]);
    // Ownership comes from the game state: once the village changes hands it no longer attracts.
    const taken = { ...city, cities: { ...city.cities, c0: { ...city.cities.c0!, owner: 'orc' } } };
    expect(retreatHex(taken, fantasy, taken.stacks.s2!, A)).toEqual(REAR[0]);
    const cheap = game({ overrides: [[REAR[0]!, 'f'], [REAR[1]!, 's']] });
    expect(retreatHex(cheap, fantasy, cheap.stacks.s2!, A)).toEqual(REAR[2]);
  });

  it('a surrounded defender cannot fall back, so its threshold is dropped', () => {
    const extra = REAR.map((h) => ({ owner: 'orc', pos: h, units: ['militia'] }));
    const s = game({ stance: { kind: 'fall-back', threshold: 0.4 }, extra });
    const plan = planAttack(s, fantasy, 's1', 's2');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.retreatTo).toBeNull();
    expect(plan.defenderThreshold).toBeUndefined();
    const open = planAttack(game({ stance: { kind: 'fall-back', threshold: 0.4 } }), fantasy, 's1', 's2');
    expect(open).toMatchObject({ defenderThreshold: 0.4 });
  });

  it('a garrison never falls back', () => {
    const s = game({ stance: { kind: 'fall-back', threshold: 0.9 }, cities: [{ at: D, tier: 'village', owner: 'dw' }] });
    const plan = planAttack(s, fantasy, 's1', 's2');
    expect(plan).toMatchObject({ garrison: true, retreatTo: null });
    expect('defenderThreshold' in plan).toBe(false);
  });
});

describe('Attack on the map', () => {
  it('a defender that falls back lands on its retreat hex with half movement next turn; the attacker advances', () => {
    const make = (seed: number) =>
      game({ seed, attackers: ['infantry', 'infantry', 'infantry'], defenders: ['infantry', 'infantry'], stance: { kind: 'fall-back', threshold: 0.5 } });
    const { state, report } = until(make, 'defender-withdraw');
    expect(report.defenderRetreatTo).toEqual(REAR[0]);
    expect(state.stacks.s2!.pos).toEqual(REAR[0]);
    expect(report.attackerAdvanced).toBe(true);
    expect(state.stacks.s1!.pos).toEqual(D);
    for (const id of state.stacks.s2!.unitIds) expect(state.units[id]!.retreated).toBe(true);
    const next = applyCommand(state, { type: 'EndTurn', playerId: 'orc' }, fantasy);
    if ('error' in next) throw new Error(next.error);
    for (const id of next.state.stacks.s2!.unitIds) expect(next.state.units[id]!.moveLeft).toBe(4);
  });

  it('the winner advances; a withdrawing attacker stays', () => {
    const won = until((seed) => game({ seed, attackers: ['trolls', 'trolls'], defenders: ['militia'] }), 'win');
    expect(won.state.stacks.s1!.pos).toEqual(D);
    expect(won.report.attackerAdvanced).toBe(true);
    const left = until((seed) => game({ seed, attackers: ['militia', 'militia'], defenders: ['trolls'] }), 'withdraw', attack(0.5));
    expect(left.state.stacks.s1!.pos).toEqual(A);
    expect(left.report.attackerAdvanced).toBe(false);
  });

  it('does not advance when some unit cannot enter: orcs beating dwarves on a mountain stay put', () => {
    const won = until((seed) => game({ seed, overrides: [[D, 'm']], attackers: ['trolls', 'trolls', 'trolls'], defenders: ['militia'] }), 'win');
    expect(won.report.attackerAdvanced).toBe(false);
    expect(won.state.stacks.s1!.pos).toEqual(A);
  });

  it('needs movement to attack and ends the attacker\'s movement', () => {
    const s = game({ attackers: ['trolls', 'trolls'], defenders: ['militia'] });
    const tired = { ...s, units: { ...s.units, u1: { ...s.units.u1!, moveLeft: 1 } } };
    const r = applyCommand(tired, attack(), fantasy);
    expect('error' in r && r.error).toMatch(/movement/i);
    const { state } = run(s);
    for (const id of state.stacks.s1!.unitIds) expect(state.units[id]!.moveLeft).toBe(0);
    const again = applyCommand(state, { type: 'Move', playerId: 'orc', stackId: 's1', path: [neighbors(state.stacks.s1!.pos)[0]!] }, fantasy);
    expect('error' in again).toBe(true);
  });
});

describe('Evade', () => {
  const evade: Stance = { kind: 'evade' };

  it('leaves before the first duel: no battle, no RNG draw, no pursuit', () => {
    const s = game({ attackers: ['infantry', 'infantry', 'infantry'], defenders: ['cavalry'], stance: evade });
    expect(previewAttack(viewFor(s, fantasy, 'orc'), fantasy, 's1', 's2')).toEqual({ evades: true, retreatTo: REAR[0] });
    const { state, report } = run(s);
    expect(report.outcome).toBe('evaded');
    expect(report.events).toEqual([]);
    expect(state.rng).toEqual(s.rng);
    expect(state.stacks.s2!.pos).toEqual(REAR[0]);
    expect(state.units[state.stacks.s2!.unitIds[0]!]!.hits).toBe(2);
    expect(state.units[state.stacks.s2!.unitIds[0]!]!.retreated).toBe(true);
    expect(state.stacks.s1!.pos).toEqual(D);
    for (const id of state.stacks.s1!.unitIds) expect(state.units[id]!.moveLeft).toBe(0);
  });

  it('fails against a faster unit anywhere in the attacking stack, and then fights as Fall back at 50%', () => {
    // The stack moves at 8, but its griffins (16) are faster than the cavalry (12).
    const s = game({ attackers: ['infantry', 'infantry', 'griffins'], defenders: ['cavalry'], stance: evade });
    const preview = previewAttack(viewFor(s, fantasy, 'orc'), fantasy, 's1', 's2');
    expect(preview).toMatchObject({ evades: false, defenderThreshold: 0.5 });
    expect(run(s).report.outcome).not.toBe('evaded');
  });

  it('does not evade a fight it is likely to win', () => {
    const s = game({ attackers: ['militia'], defenders: ['cavalry', 'cavalry'], stance: evade });
    expect(previewAttack(s, fantasy, 's1', 's2')).toMatchObject({ evades: false, defenderThreshold: 0.5 });
  });

  it('cannot evade without a retreat hex, and then holds', () => {
    const extra = REAR.map((h) => ({ owner: 'orc', pos: h, units: ['militia'] }));
    const s = game({ attackers: ['infantry', 'infantry', 'infantry'], defenders: ['cavalry'], stance: evade, extra });
    const preview = previewAttack(s, fantasy, 's1', 's2');
    expect(preview).toMatchObject({ evades: false });
    expect('defenderThreshold' in preview).toBe(false);
  });
});

describe('previewAttack', () => {
  it('reads the public stance from the attacker\'s view and matches the exact odds the battle uses', () => {
    const s = game({ attackers: ['infantry', 'infantry'], defenders: ['infantry', 'archers'], overrides: [[D, 'h']], stance: { kind: 'fall-back', threshold: 0.3 } });
    const view = viewFor(s, fantasy, 'orc');
    expect(view.stacks.s2!.stance).toEqual({ kind: 'fall-back', threshold: 0.3 });
    const preview = previewAttack(view, fantasy, 's1', 's2', 0.25);
    if ('error' in preview || preview.evades) throw new Error('unexpected');
    const plan = planAttack(s, fantasy, 's1', 's2', 0.25);
    if ('error' in plan) throw new Error(plan.error);
    expect(preview.odds).toEqual(
      computeOdds(plan.modifiers.attackers, plan.modifiers.defenders, { attackerThreshold: 0.25, defenderThreshold: 0.3 }),
    );
    expect(preview).toMatchObject({ attackerThreshold: 0.25, defenderThreshold: 0.3, canAdvance: true });
    expect(preview.modifiers.lines).toContainEqual({ side: 'defender', source: 'terrain', pct: 25 });
  });

  it('battle frequencies agree with the preview', () => {
    const make = (seed: number) =>
      game({ seed, attackers: ['infantry', 'infantry', 'infantry'], defenders: ['infantry', 'infantry'], stance: { kind: 'fall-back', threshold: 0.4 } });
    const preview = previewAttack(make(0), fantasy, 's1', 's2', 0.3);
    if ('error' in preview || preview.evades) throw new Error('unexpected');
    const n = 2000;
    let fellBack = 0;
    for (let seed = 0; seed < n; seed++) if (run(make(seed), attack(0.3)).report.outcome === 'defender-withdraw') fellBack++;
    expect(Math.abs(fellBack / n - preview.odds.defenderWithdraw)).toBeLessThan(0.04);
  });

  it('reports errors for bad targets', () => {
    const s = game({ extra: [{ owner: 'orc', pos: { q: 0, r: 0 }, units: ['militia'] }] });
    expect(previewAttack(s, fantasy, 's1', 's3')).toEqual({ error: 'Cannot attack your own stack' });
    expect(previewAttack(s, fantasy, 's1', 'nope')).toEqual({ error: 'No such target stack' });
  });
});
