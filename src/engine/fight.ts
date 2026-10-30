// Shared battle rules used by both the exact odds and the sampled battle, so
// the two can never disagree on order, hit chance, or pursuit.

/** A unit as it enters battle: effective Strength (modifiers applied), remaining hits, movement. */
export interface Fighter {
  strength: number;
  hits: number;
  move: number;
  /** Strikes when pursuing; default 1. */
  pursuitStrikes?: number;
}

/**
 * Indices of `fighters` in fight order: weakest effective Strength first; among
 * equal Strength, more remaining hits first. Ties keep input order (stable sort).
 */
export function fightOrder(fighters: readonly Fighter[]): number[] {
  return fighters
    .map((_, k) => k)
    .sort((x, y) => {
      const a = fighters[x]!;
      const b = fighters[y]!;
      return a.strength - b.strength || b.hits - a.hits;
    });
}

/** Chance that a unit of Strength `a` lands the next hit against Strength `d`. */
export function hitChance(a: number, d: number): number {
  return a / (a + d);
}

export const strikesOf = (f: Fighter): number => f.pursuitStrikes ?? 1;

/**
 * Index of the pursuer among `candidates`: fastest; ties go to more pursuit
 * strikes, then the strongest, then the first listed.
 */
export function choosePursuer(candidates: readonly Fighter[]): number {
  let best = 0;
  candidates.forEach((f, k) => {
    const b = candidates[best]!;
    const cmp = f.move - b.move || strikesOf(f) - strikesOf(b) || f.strength - b.strength;
    if (cmp > 0) best = k;
  });
  return best;
}

/**
 * Survival chance of each withdrawing unit after the pursuer's strikes.
 * `withdrawing` is in fight order and `frontHits` is the front unit's remaining
 * hits. Strikes resolve one at a time against the weakest surviving unit, so a
 * later strike can finish a unit an earlier one wounded. Ignores clean breaks;
 * callers check isCleanBreak first.
 */
export function pursuitSurvival(pursuer: Fighter, withdrawing: readonly Fighter[], frontHits: number): number[] {
  const n = withdrawing.length;
  // Distribution over (front index, its hits).
  let states = [{ idx: 0, hits: frontHits, p: 1 }];
  for (let s = 0; s < strikesOf(pursuer); s++) {
    const next: typeof states = [];
    for (const st of states) {
      if (st.idx >= n) {
        next.push(st);
        continue;
      }
      const q = hitChance(pursuer.strength, withdrawing[st.idx]!.strength);
      next.push({ ...st, p: st.p * (1 - q) });
      if (st.hits > 1) next.push({ idx: st.idx, hits: st.hits - 1, p: st.p * q });
      else next.push({ idx: st.idx + 1, hits: withdrawing[st.idx + 1]?.hits ?? 0, p: st.p * q });
    }
    states = next;
  }
  // Unit k is dead exactly when the front has moved past it.
  return withdrawing.map((_, k) => states.reduce((sum, st) => sum + (st.idx <= k ? st.p : 0), 0));
}

/** Clean break: every retreating unit is at least as fast as the pursuer. */
export function isCleanBreak(retreating: readonly Fighter[], pursuer: Fighter): boolean {
  return retreating.every((f) => f.move >= pursuer.move);
}
