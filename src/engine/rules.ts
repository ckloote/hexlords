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
  /** Units per stack. */
  maxStackSize: 8,
} as const;
