import { describe, expect, it } from 'vitest';
import type { Fighter } from './fight';
import { computeOdds } from './odds';

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

/** Gravelmaw, with effective Strengths already applied (see modifiers.test.ts). */
export function gravelmaw(): { attackers: Fighter[]; defenders: Fighter[] } {
  return {
    attackers: [
      { strength: 2.5, hits: 2, move: 6 }, // siege engine
      { strength: 5, hits: 2, move: 8 }, // infantry
      { strength: 5, hits: 1, move: 8 }, // infantry, wounded
      { strength: 6.25, hits: 3, move: 6 }, // ironguard
      { strength: 6.25, hits: 3, move: 10 }, // hero
    ],
    defenders: [
      { strength: 2, hits: 2, move: 8 },
      { strength: 2, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 5, hits: 3, move: 8 },
    ],
  };
}

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
