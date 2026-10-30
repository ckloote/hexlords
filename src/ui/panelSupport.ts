// Small helpers the panels share with the engine's modifier rules.

import type { UnitType } from '../engine/content';
import { battleModifiers as engineModifiers, type BattleModifiers } from '../engine/modifiers';

/** A stack's own battle strengths when it attacks in the open (its stack-wide bonuses only). */
export function battleModifiers(units: { id: string; type: UnitType; hits: number }[]): BattleModifiers {
  return engineModifiers(units, [], { terrainDefensePct: 0 });
}
