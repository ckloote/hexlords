import { describe, expect, it } from 'vitest';
import type { Fighter } from './fight';
import { choosePursuer, pursuitSurvival } from './fight';
import { computeOdds } from './odds';
import { gravelmaw } from './test-fixtures';

function same(strength: number, hits: number, count: number, move = 8): Fighter[] {
  return Array.from({ length: count }, () => ({ strength, hits, move }));
}

// Reference values from CLAUDE.md, produced by docs/reference/combat_reference.py.
const holdCases: [string, Fighter[], Fighter[], number][] = [
  ['Duel 5 vs 4', same(5, 2, 1), same(4, 2, 1), 0.583],
  ['Duel 6 vs 4', same(6, 2, 1), same(4, 2, 1), 0.648],
  ['Duel 9 vs 3', same(9, 2, 1), same(3, 2, 1), 0.8438],
  ['Duel 6 vs 4, 1 hit each', same(6, 1, 1), same(4, 1, 1), 0.6],
  ['Duel 6 vs 4, 3 hits each', same(6, 3, 1), same(4, 3, 1), 0.6826],
  ['8 x Str 4 vs 4 x Str 8', same(4, 2, 8), same(8, 2, 4), 0.5193],
  ['8 x Str 3 vs 3 x Str 6', same(3, 2, 8), same(6, 2, 3), 0.7514],
  ['4 vs 4 Str 4, defender +25%', same(4, 2, 4), same(5, 2, 4), 0.3304],
  ['4 vs 4 Str 4, defender +50%', same(4, 2, 4), same(6, 2, 4), 0.2131],
  ['Hero 5/3 vs guardian 4/2', same(5, 3, 1), same(4, 2, 1), 0.7659],
  ['Hero 5/3 vs guardian 6/3', same(5, 3, 1), same(6, 3, 1), 0.4152],
  ['Hero 5/3 vs guardian 8/3', same(5, 3, 1), same(8, 3, 1), 0.2912],
  ['Hero 6/4 vs guardian 4/2', same(6, 4, 1), same(4, 2, 1), 0.913],
  ['Hero 6/4 vs guardian 6/3', same(6, 4, 1), same(6, 3, 1), 0.6562],
  ['Hero 6/4 vs guardian 8/3', same(6, 4, 1), same(8, 3, 1), 0.5148],
];

describe('computeOdds: hold reference values', () => {
  for (const [name, a, d, expected] of holdCases) {
    it(name, () => {
      const odds = computeOdds(a, d);
      expect(odds.win).toBeCloseTo(expected, 4);
      expect(odds.destroyed).toBeCloseTo(1 - odds.win, 12);
      expect(odds.withdraw).toBe(0);
    });
  }

  it('only the Strength ratio matters', () => {
    expect(computeOdds(same(6, 2, 1), same(3, 2, 1)).win).toBeCloseTo(
      computeOdds(same(4, 2, 1), same(2, 2, 1)).win,
      12,
    );
  });
});

describe('computeOdds: Gravelmaw', () => {
  it('Hold', () => {
    const { attackers, defenders } = gravelmaw();
    const odds = computeOdds(attackers, defenders);
    expect(odds.win).toBeCloseTo(0.8062, 4);
    expect(odds.withdraw).toBe(0);
    expect(odds.destroyed).toBeCloseTo(0.1938, 4);
  });

  // [threshold, win, withdraw, destroyed, attackers alive, defenders alive]
  const rows: [number, number, number, number, number, number][] = [
    [0.2, 0.7989, 0.0449, 0.1562, 1.474, 0.263],
    [0.25, 0.7966, 0.0535, 0.1499, 1.481, 0.285],
    [0.3, 0.7891, 0.0738, 0.1371, 1.494, 0.345],
    [0.4, 0.7695, 0.1207, 0.1099, 1.525, 0.415],
    [0.5, 0.7265, 0.1975, 0.076, 1.589, 0.595],
  ];
  for (const [threshold, win, withdraw, destroyed, ea, ed] of rows) {
    it(`Withdraw below ${threshold * 100}%`, () => {
      const { attackers, defenders } = gravelmaw();
      const odds = computeOdds(attackers, defenders, { attackerThreshold: threshold });
      expect(odds.win).toBeCloseTo(win, 4);
      expect(odds.withdraw).toBeCloseTo(withdraw, 4);
      expect(odds.destroyed).toBeCloseTo(destroyed, 4);
      expect(odds.defenderWithdraw).toBe(0);
      expect(odds.expectedAttackers).toBeCloseTo(ea, 3);
      expect(odds.expectedDefenders).toBeCloseTo(ed, 3);
    });
  }
});

describe('computeOdds: field battles with a defender on Fall back', () => {
  // [name, attackers, defenders, attacker threshold, defender threshold,
  //  win, defender withdraws, attacker withdraws, destroyed, attackers alive, defenders alive]
  const rows: [string, Fighter[], Fighter[], number | undefined, number, number, number, number, number, number, number][] = [
    ['3 cavalry + 2 infantry vs 5 infantry on hills, Fall back 30%', [...same(4, 2, 3, 12), ...same(4, 2, 2)], same(5, 2, 5),
      undefined, 0.3, 0.0931, 0.2832, 0, 0.6237, 1.122, 1.985],
    ['4 infantry vs 4 cavalry, Fall back 30% (clean break)', same(4, 2, 4), same(4, 2, 4, 12),
      undefined, 0.3, 0.0978, 0.533, 0, 0.3693, 1.929, 1.955],
    ['4 vs 4 infantry, both 30% (attacker checks first)', same(4, 2, 4), same(4, 2, 4),
      0.3, 0.3, 0.0264, 0.4736, 0.4736, 0.0264, 2.846, 2.846],
  ];
  for (const [name, a, d, tA, tD, win, defWithdraw, withdraw, destroyed, ea, ed] of rows) {
    it(name, () => {
      const odds = computeOdds(a, d, { attackerThreshold: tA, defenderThreshold: tD });
      expect(odds.win).toBeCloseTo(win, 4);
      expect(odds.defenderWithdraw).toBeCloseTo(defWithdraw, 4);
      expect(odds.withdraw).toBeCloseTo(withdraw, 4);
      expect(odds.destroyed).toBeCloseTo(destroyed, 4);
      expect(odds.expectedAttackers).toBeCloseTo(ea, 3);
      expect(odds.expectedDefenders).toBeCloseTo(ed, 3);
    });
  }
});

describe('computeOdds: survival and invariants', () => {
  it('outcome probabilities sum to 1 and per-unit survival sums to expected survivors', () => {
    const { attackers, defenders } = gravelmaw();
    const odds = computeOdds(attackers, defenders, { attackerThreshold: 0.3 });
    expect(odds.win + odds.withdraw + odds.destroyed + odds.defenderWithdraw).toBeCloseTo(1, 12);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(odds.attackerSurvival)).toBeCloseTo(odds.expectedAttackers, 12);
    expect(sum(odds.defenderSurvival)).toBeCloseTo(odds.expectedDefenders, 12);
  });

  it('reports per-unit survival in input order', () => {
    // The weak unit is listed last but fights first, so it survives least.
    const odds = computeOdds([{ strength: 6, hits: 2, move: 8 }, { strength: 2, hits: 2, move: 8 }], same(4, 2, 1));
    expect(odds.attackerSurvival[1]!).toBeLessThan(odds.attackerSurvival[0]!);
  });

  it('a defender with a fall-back threshold can withdraw', () => {
    const odds = computeOdds(same(6, 2, 3), same(4, 2, 3), { defenderThreshold: 0.3 });
    expect(odds.defenderWithdraw).toBeGreaterThan(0);
    expect(odds.win + odds.withdraw + odds.destroyed + odds.defenderWithdraw).toBeCloseTo(1, 12);
  });

  it('handles empty sides', () => {
    expect(computeOdds(same(4, 2, 1), []).win).toBe(1);
    expect(computeOdds([], same(4, 2, 1)).destroyed).toBe(1);
  });
});

describe('pursuit', () => {
  const two = { strength: 4, hits: 2, move: 12, pursuitStrikes: 2 };

  it('one strike kills only a 1-hit front unit', () => {
    expect(pursuitSurvival(f(4, 2), [f(4, 1), f(4, 2)], 1)).toEqual([0.5, 1]);
    expect(pursuitSurvival(f(4, 2), [f(4, 2), f(4, 2)], 2)).toEqual([1, 1]);
  });

  it('two strikes: the second can finish a unit the first wounded', () => {
    // Front at 2 hits dies only if both strikes land: 0.25.
    expect(pursuitSurvival(two, [f(4, 2), f(4, 2)], 2)).toEqual([0.75, 1]);
  });

  it('two strikes: after a kill the second strike moves to the next unit', () => {
    // Front (1 hit) survives only if both miss: 0.25. The next 1-hit unit dies only if both land: 0.25.
    expect(pursuitSurvival(two, [f(4, 1), f(4, 1)], 1)).toEqual([0.25, 0.75]);
    // A 2-hit second unit cannot die from the one remaining strike.
    expect(pursuitSurvival(two, [f(4, 1), f(4, 2)], 1)).toEqual([0.25, 1]);
  });

  it('a wounded front unit uses its current hits', () => {
    expect(pursuitSurvival(f(4, 2), [f(4, 2)], 1)).toEqual([0.5]);
  });

  it('pursuer ties go to more pursuit strikes, then Strength, then fight order', () => {
    expect(choosePursuer([f(5, 2, 12), two])).toBe(1);
    expect(choosePursuer([f(4, 2, 12), f(5, 2, 12)])).toBe(1);
    expect(choosePursuer([f(5, 2, 12), f(5, 2, 12)])).toBe(0);
    expect(choosePursuer([f(9, 2, 8), f(1, 2, 12)])).toBe(1);
  });

  it('computeOdds uses the two-strike pursuer', () => {
    // One 1-hit attacker dies first; the attacker withdraws with two 1-hit units left.
    const a = [f(1, 1, 8), f(4, 1, 8), f(4, 1, 8)];
    const d1 = [f(9, 2, 12)];
    const d2 = [{ strength: 9, hits: 2, move: 12, pursuitStrikes: 2 }];
    const one = computeOdds(a, d1, { attackerThreshold: 0.99 });
    const twice = computeOdds(a, d2, { attackerThreshold: 0.99 });
    expect(twice.expectedAttackers).toBeLessThan(one.expectedAttackers);
  });
});

function f(strength: number, hits: number, move = 8): Fighter {
  return { strength, hits, move };
}
