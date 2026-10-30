// Combat modifiers. All bonuses are percentages that add before multiplying;
// each unit's total is capped at +50% and floored at -50% (half Strength).
// Modifiers are fixed when the battle starts.

import { TAGS, type UnitType } from './content';
import type { Fighter } from './fight';
import { RULES } from './rules';

export interface BattleContext {
  /** Defense bonus of the defender's hex terrain (forest and hills +25). */
  terrainDefensePct: number;
  /** Present when the defender holds a city; its bonus replaces the terrain bonus. */
  city?: { defensePct: number };
  /** The attacker strikes across a ford. */
  acrossFord?: boolean;
}

export interface Combatant {
  id: string;
  type: UnitType;
  /** Remaining hits. */
  hits: number;
}

export type Side = 'attacker' | 'defender';

/** One line on the odds card. Applies to the whole side unless `unitIds` is set. */
export interface ModifierLine {
  side: Side;
  source: string;
  pct: number;
  unitIds?: string[];
}

export interface ModifiedFighter extends Fighter {
  id: string;
  /** Total bonus after the cap and floor. */
  pct: number;
}

export interface BattleModifiers {
  lines: ModifierLine[];
  attackers: ModifiedFighter[];
  defenders: ModifiedFighter[];
}

export function effectiveStrength(base: number, pct: number): number {
  return (base * (100 + pct)) / 100;
}

const has = (units: readonly Combatant[], tag: string) => units.some((u) => u.type.tags.includes(tag));

export function battleModifiers(
  attackers: readonly Combatant[],
  defenders: readonly Combatant[],
  ctx: BattleContext,
): BattleModifiers {
  const lines: ModifierLine[] = [];

  if (has(attackers, TAGS.leadsStack)) lines.push({ side: 'attacker', source: 'leadership', pct: RULES.leadershipPct });
  if (ctx.acrossFord) lines.push({ side: 'attacker', source: 'ford', pct: RULES.fordAttackPct });

  if (has(defenders, TAGS.leadsStack)) lines.push({ side: 'defender', source: 'leadership', pct: RULES.leadershipPct });
  if (ctx.city) {
    if (ctx.city.defensePct > 0) {
      lines.push({ side: 'defender', source: 'city', pct: ctx.city.defensePct });
      if (has(attackers, TAGS.siege)) {
        const cut = Math.min(RULES.siegeCityReductionPct, ctx.city.defensePct);
        lines.push({ side: 'defender', source: 'siege', pct: -cut });
      }
    }
  } else if (ctx.terrainDefensePct !== 0) {
    lines.push({ side: 'defender', source: 'terrain', pct: ctx.terrainDefensePct });
  }
  const defenseBonus = defenders.filter((u) => u.type.tags.includes(TAGS.defenseBonus)).map((u) => u.id);
  if (defenseBonus.length > 0) {
    lines.push({ side: 'defender', source: 'defense-bonus', pct: RULES.defenseBonusPct, unitIds: defenseBonus });
  }

  const apply = (side: Side, units: readonly Combatant[]): ModifiedFighter[] =>
    units.map((u) => {
      const raw = lines
        .filter((l) => l.side === side && (!l.unitIds || l.unitIds.includes(u.id)))
        .reduce((sum, l) => sum + l.pct, 0);
      const pct = Math.min(RULES.maxBonusPct, Math.max(RULES.minBonusPct, raw));
      return { id: u.id, strength: effectiveStrength(u.type.strength, pct), hits: u.hits, move: u.type.move, pct };
    });

  return { lines, attackers: apply('attacker', attackers), defenders: apply('defender', defenders) };
}
