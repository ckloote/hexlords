// Sampled battle resolution. Uses the same fight order, hit chance, and
// pursuit rules as the exact odds, and the exact Hold win probability for
// in-battle retreat checks, drawing every roll from the seeded RNG.

import { choosePursuer, type Fighter, hitChance, isCleanBreak } from './fight';
import { createBattleModel, type RetreatThresholds } from './odds';
import { nextFloat, type RngState } from './rng';
import type { Side } from './modifiers';

export type BattleOutcome = 'win' | 'withdraw' | 'destroyed' | 'defender-withdraw';

/** Unit indices in events refer to the caller's input order. */
export type BattleEvent =
  | { kind: 'hit'; side: Side; by: number; target: number; hitsLeft: number }
  | { kind: 'death'; side: Side; unit: number }
  | { kind: 'withdraw'; side: Side; winChance: number }
  | { kind: 'pursuit'; side: Side; cleanBreak: true }
  | { kind: 'pursuit'; side: Side; cleanBreak: false; pursuer: number; target: number; hit: boolean; killed: boolean };

export interface BattleResult {
  rng: RngState;
  outcome: BattleOutcome;
  /** Remaining hits per unit in input order; 0 means dead. */
  attackerHits: number[];
  defenderHits: number[];
  events: BattleEvent[];
}

export function resolveBattle(
  rngIn: RngState,
  attackers: readonly Fighter[],
  defenders: readonly Fighter[],
  thresholds: RetreatThresholds = {},
): BattleResult {
  const { A, D, orderA, orderD, pWin } = createBattleModel(attackers, defenders);
  const hitsA = A.map((u) => u.hits);
  const hitsD = D.map((u) => u.hits);
  const events: BattleEvent[] = [];
  let rng = rngIn;
  let i = 0;
  let j = 0;
  let outcome: BattleOutcome | undefined;

  const roll = (): number => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };

  /** The retreating side's front unit takes one strike from the winner's fastest unit. */
  function pursue(side: Side) {
    const [own, ownHits, ownOrder, ownFront, foe, foeOrder, foeFront] =
      side === 'attacker'
        ? ([A, hitsA, orderA, i, D, orderD, j] as const)
        : ([D, hitsD, orderD, j, A, orderA, i] as const);
    const p = foeFront + choosePursuer(foe.slice(foeFront));
    const pursuer = foe[p]!;
    if (isCleanBreak(own.slice(ownFront), pursuer)) {
      events.push({ kind: 'pursuit', side, cleanBreak: true });
      return;
    }
    const hit = roll() < hitChance(pursuer.strength, own[ownFront]!.strength);
    if (hit) ownHits[ownFront]!--;
    const killed = ownHits[ownFront] === 0;
    events.push({
      kind: 'pursuit',
      side,
      cleanBreak: false,
      pursuer: foeOrder[p]!,
      target: ownOrder[ownFront]!,
      hit,
      killed,
    });
  }

  while (outcome === undefined) {
    if (j === D.length) {
      outcome = 'win';
      break;
    }
    if (i === A.length) {
      outcome = 'destroyed';
      break;
    }
    const attackerHits = roll() < hitChance(A[i]!.strength, D[j]!.strength);
    let died = false;
    if (attackerHits) {
      hitsD[j]!--;
      events.push({ kind: 'hit', side: 'attacker', by: orderA[i]!, target: orderD[j]!, hitsLeft: hitsD[j]! });
      if (hitsD[j] === 0) {
        events.push({ kind: 'death', side: 'defender', unit: orderD[j]! });
        j++;
        died = true;
      }
    } else {
      hitsA[i]!--;
      events.push({ kind: 'hit', side: 'defender', by: orderD[j]!, target: orderA[i]!, hitsLeft: hitsA[i]! });
      if (hitsA[i] === 0) {
        events.push({ kind: 'death', side: 'attacker', unit: orderA[i]! });
        i++;
        died = true;
      }
    }
    // Retreat checks only between duels, while both sides still have units.
    if (died && i < A.length && j < D.length) {
      const p = pWin(i, hitsA[i]!, j, hitsD[j]!);
      if (thresholds.attackerThreshold !== undefined && p < thresholds.attackerThreshold) {
        events.push({ kind: 'withdraw', side: 'attacker', winChance: p });
        pursue('attacker');
        outcome = 'withdraw';
      } else if (thresholds.defenderThreshold !== undefined && 1 - p < thresholds.defenderThreshold) {
        events.push({ kind: 'withdraw', side: 'defender', winChance: 1 - p });
        pursue('defender');
        outcome = 'defender-withdraw';
      }
    }
  }

  const attackerHits = new Array<number>(A.length);
  const defenderHits = new Array<number>(D.length);
  orderA.forEach((orig, k) => (attackerHits[orig] = hitsA[k]!));
  orderD.forEach((orig, k) => (defenderHits[orig] = hitsD[k]!));
  return { rng, outcome, attackerHits, defenderHits, events };
}
