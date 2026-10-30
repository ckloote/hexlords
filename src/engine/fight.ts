// Shared battle rules used by both the exact odds and the sampled battle, so
// the two can never disagree on order, hit chance, or pursuit.

/** A unit as it enters battle: effective Strength (modifiers applied), remaining hits, movement. */
export interface Fighter {
  strength: number;
  hits: number;
  move: number;
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

/** The pursuer among `candidates`: fastest, ties to the strongest, then the first listed. */
export function choosePursuer(candidates: readonly Fighter[]): Fighter {
  let best = candidates[0]!;
  for (const f of candidates) {
    if (f.move > best.move || (f.move === best.move && f.strength > best.strength)) best = f;
  }
  return best;
}

/** Clean break: every retreating unit is at least as fast as the pursuer. */
export function isCleanBreak(retreating: readonly Fighter[], pursuer: Fighter): boolean {
  return retreating.every((f) => f.move >= pursuer.move);
}
