// Exact battle odds: a memoized recursion over (attacker unit index, its hits,
// defender unit index, its hits). The odds preview, the AI, and in-battle
// retreat checks all use this module. It matches docs/reference/combat_reference.py.

import { choosePursuer, type Fighter, fightOrder, hitChance, isCleanBreak } from './fight';

export interface RetreatThresholds {
  /** Attacker withdraws when its win chance drops below this, checked after each death. */
  attackerThreshold?: number;
  /** Defender (a field stack on Fall back) withdraws when its own win chance drops below this. */
  defenderThreshold?: number;
}

export interface Odds {
  /** All defenders destroyed. */
  win: number;
  /** Attacker withdrew. */
  withdraw: number;
  /** All attackers destroyed. */
  destroyed: number;
  /** Defender withdrew. */
  defenderWithdraw: number;
  expectedAttackers: number;
  expectedDefenders: number;
  /** Per-unit survival probability, in the caller's input order. */
  attackerSurvival: number[];
  defenderSurvival: number[];
}

/** Fight-ordered view of a battle plus the exact Hold win probability from any state. */
export interface BattleModel {
  /** Attackers in fight order. */
  A: Fighter[];
  /** Defenders in fight order. */
  D: Fighter[];
  /** orderA[k] is the caller's index of A[k]. */
  orderA: number[];
  orderD: number[];
  /** Exact P(attacker wins) if both sides fight to the end from this state. */
  pWin(i: number, ha: number, j: number, hd: number): number;
}

export function createBattleModel(attackers: readonly Fighter[], defenders: readonly Fighter[]): BattleModel {
  const orderA = fightOrder(attackers);
  const orderD = fightOrder(defenders);
  const A = orderA.map((k) => attackers[k]!);
  const D = orderD.map((k) => defenders[k]!);
  const nA = A.length;
  const nD = D.length;
  const maxHa = Math.max(0, ...A.map((f) => f.hits)) + 1;
  const maxHd = Math.max(0, ...D.map((f) => f.hits)) + 1;
  const memo = new Float64Array((nA + 1) * maxHa * (nD + 1) * maxHd).fill(NaN);
  const key = (i: number, ha: number, j: number, hd: number) => ((i * maxHa + ha) * (nD + 1) + j) * maxHd + hd;

  function pWin(i: number, ha: number, j: number, hd: number): number {
    if (j === nD) return 1;
    if (i === nA) return 0;
    const k = key(i, ha, j, hd);
    const cached = memo[k]!;
    if (!Number.isNaN(cached)) return cached;
    const p = hitChance(A[i]!.strength, D[j]!.strength);
    const win = hd > 1 ? pWin(i, ha, j, hd - 1) : pWin(i, ha, j + 1, D[j + 1]?.hits ?? 0);
    const lose = ha > 1 ? pWin(i, ha - 1, j, hd) : pWin(i + 1, A[i + 1]?.hits ?? 0, j, hd);
    const result = p * win + (1 - p) * lose;
    memo[k] = result;
    return result;
  }

  return { A, D, orderA, orderD, pWin };
}

// Outcome vectors: [win, withdraw, destroyed, defenderWithdraw, survA..., survD...],
// with survival in fight order.
const WIN = 0;
const WITHDRAW = 1;
const DESTROYED = 2;
const DEF_WITHDRAW = 3;
const HEAD = 4;

export function computeOdds(
  attackers: readonly Fighter[],
  defenders: readonly Fighter[],
  thresholds: RetreatThresholds = {},
): Odds {
  const model = createBattleModel(attackers, defenders);
  const { A, D, pWin } = model;
  const nA = A.length;
  const nD = D.length;
  const size = HEAD + nA + nD;
  const tA = thresholds.attackerThreshold;
  const tD = thresholds.defenderThreshold;
  const memo = new Map<number, Float64Array>();
  const maxHa = Math.max(0, ...A.map((f) => f.hits)) + 1;
  const maxHd = Math.max(0, ...D.map((f) => f.hits)) + 1;
  const key = (i: number, ha: number, j: number, hd: number) => ((i * maxHa + ha) * (nD + 1) + j) * maxHd + hd;

  /** Terminal vector where attackers i.. and defenders j.. are alive. */
  function terminal(slot: number, i: number, j: number): Float64Array {
    const v = new Float64Array(size);
    v[slot] = 1;
    for (let k = i; k < nA; k++) v[HEAD + k] = 1;
    for (let k = j; k < nD; k++) v[HEAD + nA + k] = 1;
    return v;
  }

  function attackerWithdraws(i: number, ha: number, j: number): Float64Array {
    const v = terminal(WITHDRAW, i, j);
    const pursuer = choosePursuer(D.slice(j));
    if (!isCleanBreak(A.slice(i), pursuer) && ha === 1) {
      v[HEAD + i] = 1 - hitChance(pursuer.strength, A[i]!.strength);
    }
    return v;
  }

  function defenderWithdraws(i: number, j: number, hd: number): Float64Array {
    const v = terminal(DEF_WITHDRAW, i, j);
    const pursuer = choosePursuer(A.slice(i));
    if (!isCleanBreak(D.slice(j), pursuer) && hd === 1) {
      v[HEAD + nA + j] = 1 - hitChance(pursuer.strength, D[j]!.strength);
    }
    return v;
  }

  function next(i: number, ha: number, j: number, hd: number, afterDeath: boolean): Float64Array {
    if (afterDeath && i < nA && j < nD) {
      const p = tA !== undefined || tD !== undefined ? pWin(i, ha, j, hd) : 0;
      if (tA !== undefined && p < tA) return attackerWithdraws(i, ha, j);
      if (tD !== undefined && 1 - p < tD) return defenderWithdraws(i, j, hd);
    }
    return play(i, ha, j, hd);
  }

  function play(i: number, ha: number, j: number, hd: number): Float64Array {
    if (j === nD) return terminal(WIN, i, j);
    if (i === nA) return terminal(DESTROYED, i, j);
    const k = key(i, ha, j, hd);
    const cached = memo.get(k);
    if (cached) return cached;
    const p = hitChance(A[i]!.strength, D[j]!.strength);
    const win = hd > 1 ? next(i, ha, j, hd - 1, false) : next(i, ha, j + 1, D[j + 1]?.hits ?? 0, true);
    const lose = ha > 1 ? next(i, ha - 1, j, hd, false) : next(i + 1, A[i + 1]?.hits ?? 0, j, hd, true);
    const v = new Float64Array(size);
    for (let s = 0; s < size; s++) v[s] = p * win[s]! + (1 - p) * lose[s]!;
    memo.set(k, v);
    return v;
  }

  const v = play(0, A[0]?.hits ?? 0, 0, D[0]?.hits ?? 0);
  const attackerSurvival = new Array<number>(nA);
  const defenderSurvival = new Array<number>(nD);
  model.orderA.forEach((orig, k) => (attackerSurvival[orig] = v[HEAD + k]!));
  model.orderD.forEach((orig, k) => (defenderSurvival[orig] = v[HEAD + nA + k]!));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    win: v[WIN]!,
    withdraw: v[WITHDRAW]!,
    destroyed: v[DESTROYED]!,
    defenderWithdraw: v[DEF_WITHDRAW]!,
    expectedAttackers: sum(attackerSurvival),
    expectedDefenders: sum(defenderSurvival),
    attackerSurvival,
    defenderSurvival,
  };
}
