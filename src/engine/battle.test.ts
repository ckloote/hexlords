import { describe, expect, it } from 'vitest';
import { resolveBattle } from './battle';
import type { Fighter } from './fight';
import { fightOrder } from './fight';
import { computeOdds } from './odds';
import { gravelmaw } from './test-fixtures';
import { seedRng } from './rng';

const f = (strength: number, hits: number, move = 8): Fighter => ({ strength, hits, move });

describe('fight order', () => {
  it('lines up weakest first, healthy before wounded at equal Strength, stable otherwise', () => {
    const units = [f(4, 1), f(6, 2), f(2, 2), f(4, 2), f(4, 2)];
    expect(fightOrder(units)).toEqual([2, 3, 4, 0, 1]);
  });
});

describe('resolveBattle', () => {
  it('is deterministic for a given seed', () => {
    const { attackers, defenders } = gravelmaw();
    const a = resolveBattle(seedRng(1), attackers, defenders, { attackerThreshold: 0.3 });
    const b = resolveBattle(seedRng(1), attackers, defenders, { attackerThreshold: 0.3 });
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('does not mutate its inputs', () => {
    const { attackers, defenders } = gravelmaw();
    const before = JSON.stringify({ attackers, defenders });
    resolveBattle(seedRng(3), attackers, defenders);
    expect(JSON.stringify({ attackers, defenders })).toBe(before);
  });

  it('reports remaining hits in input order and ends with one side gone when holding', () => {
    const { attackers, defenders } = gravelmaw();
    const r = resolveBattle(seedRng(2), attackers, defenders);
    expect(r.attackerHits).toHaveLength(5);
    expect(r.defenderHits).toHaveLength(5);
    const aliveA = r.attackerHits.filter((h) => h > 0).length;
    const aliveD = r.defenderHits.filter((h) => h > 0).length;
    expect(r.outcome === 'win' ? aliveD : aliveA).toBe(0);
    expect(aliveA + aliveD).toBeGreaterThan(0);
    // Damage persists: survivors never gain hits.
    r.attackerHits.forEach((h, k) => expect(h).toBeLessThanOrEqual(attackers[k]!.hits));
  });

  it('matches the exact odds over many seeded battles (Gravelmaw, withdraw below 30%)', () => {
    const { attackers, defenders } = gravelmaw();
    const odds = computeOdds(attackers, defenders, { attackerThreshold: 0.3 });
    const n = 20000;
    let rng = seedRng('monte-carlo');
    const counts = { win: 0, withdraw: 0, destroyed: 0, 'defender-withdraw': 0 };
    let aliveA = 0;
    let aliveD = 0;
    for (let k = 0; k < n; k++) {
      const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.3 });
      rng = r.rng;
      counts[r.outcome]++;
      aliveA += r.attackerHits.filter((h) => h > 0).length;
      aliveD += r.defenderHits.filter((h) => h > 0).length;
    }
    // About 4 standard errors.
    expect(counts.win / n).toBeCloseTo(odds.win, 1);
    expect(Math.abs(counts.win / n - odds.win)).toBeLessThan(0.012);
    expect(Math.abs(counts.withdraw / n - odds.withdraw)).toBeLessThan(0.008);
    expect(Math.abs(aliveA / n - odds.expectedAttackers)).toBeLessThan(0.04);
    expect(Math.abs(aliveD / n - odds.expectedDefenders)).toBeLessThan(0.03);
  });

  it('withdraws only between duels, once the win chance drops below the threshold', () => {
    const { attackers, defenders } = gravelmaw();
    let rng = seedRng('withdraw');
    for (let k = 0; k < 200; k++) {
      const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.5 });
      rng = r.rng;
      if (r.outcome !== 'withdraw') continue;
      const w = r.events.find((e) => e.kind === 'withdraw');
      expect(w).toBeDefined();
      if (w?.kind === 'withdraw') expect(w.winChance).toBeLessThan(0.5);
      // The event right before the withdrawal is a death.
      const idx = r.events.indexOf(w!);
      expect(r.events[idx - 1]!.kind).toBe('death');
      return;
    }
    throw new Error('no withdrawal in 200 battles');
  });

  it('clean break: no pursuit when every retreating unit is at least as fast as the pursuer', () => {
    // A hopeless fight, so the attacker withdraws after the first death.
    const attackers = [f(1, 1, 12), f(1, 2, 12)];
    const defenders = [f(9, 2, 8), f(9, 2, 8)];
    let rng = seedRng(4);
    for (let k = 0; k < 50; k++) {
      const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.5 });
      rng = r.rng;
      if (r.outcome !== 'withdraw') continue;
      const p = r.events.find((e) => e.kind === 'pursuit');
      expect(p).toMatchObject({ kind: 'pursuit', cleanBreak: true });
      return;
    }
    throw new Error('no withdrawal');
  });

  it('a pursuit strike kills only a 1-hit target and wounds otherwise', () => {
    // Attacker withdraws at once after its first unit dies; the next unit is the target.
    const outcomes = new Set<string>();
    let rng = seedRng(5);
    for (const targetHits of [1, 2]) {
      for (let k = 0; k < 200; k++) {
        const attackers = [f(1, 1, 6), f(2, targetHits, 6)];
        const defenders = [f(9, 2, 8)];
        const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.99 });
        rng = r.rng;
        const p = r.events.find((e) => e.kind === 'pursuit');
        if (p?.kind !== 'pursuit' || p.cleanBreak) continue;
        // Fight order puts the Strength-1 unit first, so it dies and index 1 is pursued.
        expect(p.target).toBe(1);
        if (p.hit) {
          expect(r.attackerHits[1]).toBe(targetHits - 1);
          expect(p.killed).toBe(targetHits === 1);
        } else {
          expect(r.attackerHits[1]).toBe(targetHits);
        }
        outcomes.add(`${targetHits}:${p.hit}`);
      }
    }
    expect(outcomes).toEqual(new Set(['1:true', '1:false', '2:true', '2:false']));
  });

  it('a two-strike pursuer resolves strikes one at a time against the weakest surviving unit', () => {
    // Attackers withdraw after the Strength-1 unit dies; the pursuer strikes twice.
    const seen = new Set<string>();
    let rng = seedRng(7);
    for (let k = 0; k < 400; k++) {
      const attackers = [f(1, 1, 6), f(2, 1, 6), f(3, 2, 6)];
      const defenders = [{ strength: 9, hits: 2, move: 12, pursuitStrikes: 2 }];
      const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.99 });
      rng = r.rng;
      const strikes = r.events.filter((e) => e.kind === 'pursuit');
      if (r.outcome !== 'withdraw' || r.attackerHits[0] !== 0) continue;
      expect(strikes).toHaveLength(2);
      const [s1, s2] = strikes as Extract<(typeof strikes)[number], { cleanBreak: false }>[];
      expect(s1!.target).toBe(1);
      // After a kill, the second strike moves on to the next weakest unit.
      expect(s2!.target).toBe(s1!.killed ? 2 : 1);
      seen.add(`${s1!.killed}:${s2!.hit}`);
    }
    expect(seen.size).toBe(4);
  });

  it('matches the exact odds with a two-strike pursuer', () => {
    const attackers = [f(3, 2, 8), f(4, 1, 8), f(4, 2, 8)];
    const defenders = [f(5, 2, 8), { strength: 3, hits: 2, move: 12, pursuitStrikes: 2 }, f(5, 2, 8)];
    const odds = computeOdds(attackers, defenders, { attackerThreshold: 0.5 });
    expect(odds.withdraw).toBeGreaterThan(0.2);
    const n = 20000;
    let rng = seedRng('two-strikes');
    const alive = [0, 0, 0];
    let withdrawals = 0;
    for (let k = 0; k < n; k++) {
      const r = resolveBattle(rng, attackers, defenders, { attackerThreshold: 0.5 });
      rng = r.rng;
      if (r.outcome === 'withdraw') withdrawals++;
      r.attackerHits.forEach((h, u) => (alive[u]! += h > 0 ? 1 : 0));
    }
    expect(Math.abs(withdrawals / n - odds.withdraw)).toBeLessThan(0.015);
    alive.forEach((a, u) => expect(Math.abs(a / n - odds.attackerSurvival[u]!)).toBeLessThan(0.015));
  });

  it('a defender on fall-back can withdraw and be pursued', () => {
    let rng = seedRng(6);
    for (let k = 0; k < 200; k++) {
      const r = resolveBattle(rng, [f(6, 2, 12), f(6, 2, 12)], [f(3, 2), f(3, 2)], { defenderThreshold: 0.5 });
      rng = r.rng;
      if (r.outcome !== 'defender-withdraw') continue;
      expect(r.events.some((e) => e.kind === 'pursuit' && e.side === 'defender')).toBe(true);
      return;
    }
    throw new Error('no defender withdrawal');
  });
});
