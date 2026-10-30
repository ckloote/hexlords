// Theme-neutral rule numbers from docs/DESIGN.md. Starting values for tuning.
export const RULES = {
  /** Leadership bonus to a commander's whole stack. */
  leadershipPct: 25,
  /** A stack with a siege unit cuts the enemy city defense bonus by this much. */
  siegeCityReductionPct: 25,
  /** Bonus for units tagged defense-bonus when defending. */
  defenseBonusPct: 25,
  /** Attacking across a ford. */
  fordAttackPct: -25,
  /** Per-unit cap on total bonus. */
  maxBonusPct: 50,
  /** Penalties never drop Strength below half. */
  minBonusPct: -50,
  /** Upkeep per turn as a percentage of base price (rounded, minimum 1). */
  upkeepPct: 12,
  /** Extra cost for sliding between two hexes next to the same visible enemy stack. */
  zocPenalty: 2,
  /** Vision radius of a unit without its own value, and of a city for its owner. */
  defaultVision: 2,
  cityVision: 2,
  /** A flier pays at most this per hex (roads and bridges still cost less). */
  flyingStepCost: 2,
  /** Movement an attack needs when the attacker cannot enter the defender's hex (a plains step). */
  attackIntoImpassableCost: 2,
  /** Movement lost on the next turn after retreating or evading. */
  retreatMovePenaltyPct: 50,
  /** Evade leaves when the evader's own win chance is below this. */
  evadeWinChance: 0.5,
  /** City defense bonus by tier; replaces the terrain bonus. */
  cityDefensePct: { village: 0, city: 25, capital: 50 },
  /** Units per stack. */
  maxStackSize: 8,
} as const;
