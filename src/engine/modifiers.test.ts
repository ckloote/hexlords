import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { type Combatant, battleModifiers, effectiveStrength } from './modifiers';
import { computeOdds } from './odds';

let next = 0;
function unit(typeId: string, hits?: number): Combatant {
  const type = fantasy.units[typeId]!;
  return { id: `u${next++}`, type, hits: hits ?? type.hits };
}

const plains = { terrainDefensePct: 0 };

describe('effectiveStrength', () => {
  it('applies a percentage to base Strength', () => {
    expect(effectiveStrength(4, 25)).toBe(5);
    expect(effectiveStrength(4, -50)).toBe(2);
  });
});

describe('battleModifiers', () => {
  it('Gravelmaw: hero leadership, city walls cancelled by siege', () => {
    const attackers = [unit('siege-engine'), unit('infantry'), unit('infantry', 1), unit('ironguard'), unit('hero')];
    const defenders = [unit('militia'), unit('militia'), unit('infantry'), unit('infantry'), unit('trolls')];
    const mods = battleModifiers(attackers, defenders, { terrainDefensePct: 0, city: { defensePct: 25 } });
    expect(mods.attackers.map((f) => f.strength)).toEqual([2.5, 5, 5, 6.25, 6.25]);
    expect(mods.defenders.map((f) => f.strength)).toEqual([2, 2, 4, 4, 5]);
    expect(mods.attackers.map((f) => f.hits)).toEqual([2, 2, 1, 3, 3]);
    expect(mods.attackers.map((f) => f.move)).toEqual([6, 8, 8, 6, 10]);
    expect(mods.lines).toEqual([
      { side: 'attacker', source: 'leadership', pct: 25 },
      { side: 'defender', source: 'city', pct: 25 },
      { side: 'defender', source: 'siege', pct: -25 },
    ]);
    // End to end: the same numbers as the reference.
    expect(computeOdds(mods.attackers, mods.defenders).win).toBeCloseTo(0.8062, 4);
  });

  it('bonuses add before multiplying: forest +25% and leadership +25% make +50%', () => {
    const mods = battleModifiers([unit('infantry')], [unit('infantry'), unit('hero')], { terrainDefensePct: 25 });
    expect(mods.defenders[0]!.pct).toBe(50);
    expect(mods.defenders[0]!.strength).toBe(6);
  });

  it('caps each unit at +50%', () => {
    // Archers in a capital (+50%) with a hero (+25%) and their own +25%: capped at +50%.
    const mods = battleModifiers([unit('infantry')], [unit('archers'), unit('hero')], {
      terrainDefensePct: 0,
      city: { defensePct: 50 },
    });
    expect(mods.defenders[0]!.pct).toBe(50);
    expect(mods.defenders[0]!.strength).toBe(4.5);
  });

  it('floors penalties at half Strength', () => {
    expect(effectiveStrength(4, Math.max(-50, -75))).toBe(2);
    const mods = battleModifiers([unit('infantry')], [unit('infantry')], { terrainDefensePct: 0, acrossFord: true });
    expect(mods.attackers[0]!.pct).toBe(-25);
    expect(mods.attackers[0]!.strength).toBe(3);
  });

  it('a city bonus replaces the terrain bonus', () => {
    const mods = battleModifiers([unit('infantry')], [unit('infantry')], { terrainDefensePct: 25, city: { defensePct: 25 } });
    expect(mods.defenders[0]!.pct).toBe(25);
    expect(mods.lines.map((l) => l.source)).toEqual(['city']);
  });

  it('siege against a capital leaves +25%, and never pushes a village below 0', () => {
    const capital = battleModifiers([unit('siege-engine')], [unit('infantry')], { terrainDefensePct: 0, city: { defensePct: 50 } });
    expect(capital.defenders[0]!.pct).toBe(25);
    const village = battleModifiers([unit('siege-engine')], [unit('infantry')], { terrainDefensePct: 0, city: { defensePct: 0 } });
    expect(village.defenders[0]!.pct).toBe(0);
    expect(village.lines).toEqual([]);
  });

  it('only one leadership bonus counts per stack', () => {
    const mods = battleModifiers([unit('infantry'), unit('hero'), unit('hero')], [unit('infantry')], plains);
    expect(mods.attackers[0]!.pct).toBe(25);
  });

  it('defense bonus applies only to the defending unit that carries it', () => {
    const asDefender = battleModifiers([unit('infantry')], [unit('archers'), unit('militia')], plains);
    expect(asDefender.defenders.map((f) => f.pct)).toEqual([25, 0]);
    const asAttacker = battleModifiers([unit('archers')], [unit('militia')], plains);
    expect(asAttacker.attackers[0]!.pct).toBe(0);
  });

  it('terrain helps only the defender', () => {
    const mods = battleModifiers([unit('infantry')], [unit('infantry')], { terrainDefensePct: 25 });
    expect(mods.attackers[0]!.pct).toBe(0);
    expect(mods.defenders[0]!.pct).toBe(25);
  });
});
