// Battles on the map: the battle context from terrain, cities, and fords;
// where a withdrawing defender goes; Evade; and the odds preview. The Attack
// command and previewAttack share planAttack, so the preview shows exactly the
// thresholds and Evade decision the battle will use.

import type { ContentPack } from './content';
import { type Hex, hexDistance, neighbors, sameHex } from './hex';
import { cityAt, featureAt, inBounds, terrainAt } from './map';
import { type BattleContext, type BattleModifiers, battleModifiers, type Combatant } from './modifiers';
import { canEnter, hexCost, moverFor, stackMover } from './movement';
import { computeOdds, type Odds } from './odds';
import { RULES } from './rules';
import type { Stack, World } from './types';

/** Terrain, city, and ford around a battle. Terrain helps only the defender; a city replaces it. */
export function battleContextAt(world: World, content: ContentPack, attackerPos: Hex, defenderPos: Hex): BattleContext {
  const ctx: BattleContext = {
    terrainDefensePct: content.terrain[terrainAt(world.map, defenderPos) ?? '']?.defensePct ?? 0,
  };
  const city = cityAt(world, defenderPos);
  if (city && !city.state.razed) ctx.city = { defensePct: RULES.cityDefensePct[city.state.tier] };
  if (featureAt(world.map, attackerPos) === 'ford' && featureAt(world.map, defenderPos) !== 'ford') ctx.acrossFord = true;
  return ctx;
}

/**
 * Where `stack` goes if it withdraws from an attacker on `attackerPos`: one of
 * the three adjacent hexes at distance 2 from the attacker that every unit can
 * enter, holding no enemy and at most a friendly stack it can merge with (8
 * max). Prefers a friendly city, then the lowest move cost, then direction order.
 */
export function retreatHex(world: World, content: ContentPack, stack: Stack, attackerPos: Hex): Hex | null {
  const mover = stackMover(world, content, stack);
  const options: { hex: Hex; city: boolean; cost: number }[] = [];
  for (const hex of neighbors(stack.pos)) {
    if (hexDistance(hex, attackerPos) !== 2 || !inBounds(world.map, hex) || !canEnter(world, content, mover, hex)) continue;
    const there = Object.values(world.stacks).find((s) => s.id !== stack.id && sameHex(s.pos, hex));
    if (there && (there.owner !== stack.owner || there.unitIds.length + stack.unitIds.length > RULES.maxStackSize)) continue;
    const city = cityAt(world, hex);
    const friendlyCity = city !== undefined && !city.state.razed && city.state.owner === stack.owner;
    options.push({ hex, city: friendlyCity, cost: hexCost(world, content, mover, hex) });
  }
  options.sort((a, b) => Number(b.city) - Number(a.city) || a.cost - b.cost); // stable: direction order breaks ties
  return options[0]?.hex ?? null;
}

export interface AttackPlan {
  attacker: Stack;
  defender: Stack;
  context: BattleContext;
  modifiers: BattleModifiers;
  /** The defender holds a city: it never retreats. */
  garrison: boolean;
  /** Where the defender would go if it withdraws or evades; null if it cannot. */
  retreatTo: Hex | null;
  attackerThreshold?: number;
  /** Fall back threshold actually in force (none for garrisons or without a retreat hex). */
  defenderThreshold?: number;
  /** The defender evades before the first duel. */
  evades: boolean;
}

function combatants(world: World, content: ContentPack, stack: Stack): Combatant[] {
  return stack.unitIds.map((id) => {
    const unit = world.units[id]!;
    return { id, type: content.units[unit.typeId]!, hits: unit.hits };
  });
}

/** Sets up a battle between two stacks; works on the full state or a player's view. */
export function planAttack(
  world: World,
  content: ContentPack,
  attackerId: string,
  defenderId: string,
  withdrawBelow?: number,
): AttackPlan | { error: string } {
  const attacker = world.stacks[attackerId];
  const defender = world.stacks[defenderId];
  if (!attacker) return { error: 'No such attacking stack' };
  if (!defender) return { error: 'No such target stack' };
  if (defender.owner === attacker.owner) return { error: 'Cannot attack your own stack' };
  if (hexDistance(attacker.pos, defender.pos) !== 1) return { error: 'Target is not adjacent' };
  if (withdrawBelow !== undefined && !(withdrawBelow >= 0 && withdrawBelow <= 1)) return { error: 'withdrawBelow must be 0..1' };

  const context = battleContextAt(world, content, attacker.pos, defender.pos);
  const modifiers = battleModifiers(combatants(world, content, attacker), combatants(world, content, defender), context);
  const garrison = context.city !== undefined;
  const retreatTo = garrison ? null : retreatHex(world, content, defender, attacker.pos);
  const plan: AttackPlan = { attacker, defender, context, modifiers, garrison, retreatTo, evades: false };
  if (withdrawBelow !== undefined) plan.attackerThreshold = withdrawBelow;

  const stance = defender.stance;
  const threshold = stance.kind === 'fall-back' ? stance.threshold : stance.kind === 'evade' ? RULES.evadeWinChance : undefined;
  if (retreatTo && threshold !== undefined) plan.defenderThreshold = threshold;

  if (stance.kind === 'evade' && retreatTo) {
    const fastestAttacker = Math.max(...modifiers.attackers.map((f) => f.move));
    const fastEnough = modifiers.defenders.every((f) => f.move >= fastestAttacker);
    const ownWinChance = 1 - computeOdds(modifiers.attackers, modifiers.defenders).win;
    plan.evades = fastEnough && ownWinChance < RULES.evadeWinChance;
  }
  return plan;
}

/** The attacker's units can all stand on the defender's hex, so a winner may advance. */
export function canAdvance(world: World, content: ContentPack, attacker: Stack, unitIds: readonly string[], to: Hex): boolean {
  if (unitIds.length === 0) return false;
  return canEnter(world, content, moverFor(world, content, attacker.owner, unitIds), to);
}

export type AttackPreview =
  | { evades: true; retreatTo: Hex }
  | {
      evades: false;
      odds: Odds;
      modifiers: BattleModifiers;
      attackerThreshold?: number;
      defenderThreshold?: number;
      /** Every attacking unit could enter the hex after a win. */
      canAdvance: boolean;
    };

/**
 * The odds card: exact outcome odds for an attack, from what the attacker can
 * see (pass the attacker's viewFor). Evade and the defender's threshold follow
 * the defender's public stance.
 */
export function previewAttack(
  world: World,
  content: ContentPack,
  attackerId: string,
  defenderId: string,
  withdrawBelow?: number,
): AttackPreview | { error: string } {
  const plan = planAttack(world, content, attackerId, defenderId, withdrawBelow);
  if ('error' in plan) return plan;
  if (plan.evades) return { evades: true, retreatTo: plan.retreatTo! };
  const odds = computeOdds(plan.modifiers.attackers, plan.modifiers.defenders, {
    attackerThreshold: plan.attackerThreshold,
    defenderThreshold: plan.defenderThreshold,
  });
  const preview: AttackPreview = {
    evades: false,
    odds,
    modifiers: plan.modifiers,
    canAdvance: canAdvance(world, content, plan.attacker, plan.attacker.unitIds, plan.defender.pos),
  };
  if (plan.attackerThreshold !== undefined) preview.attackerThreshold = plan.attackerThreshold;
  if (plan.defenderThreshold !== undefined) preview.defenderThreshold = plan.defenderThreshold;
  return preview;
}
