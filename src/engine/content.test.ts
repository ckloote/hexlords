import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { loadContent, upkeepFor } from './content';

describe('fantasy content pack', () => {
  it('matches the shared roster in DESIGN.md', () => {
    const roster: [string, number, number, number, number, number, number][] = [
      // id, Strength, Hits, Move, Cost, Build, Upkeep
      ['militia', 2, 2, 8, 8, 1, 1],
      ['archers', 3, 2, 8, 15, 1, 2],
      ['infantry', 4, 2, 8, 16, 1, 2],
      ['cavalry', 4, 2, 12, 20, 2, 2],
      ['siege-engine', 2, 2, 6, 20, 2, 2],
      ['griffins', 5, 2, 16, 30, 3, 4],
    ];
    for (const [id, strength, hits, move, cost, buildTurns, upkeep] of roster) {
      expect(fantasy.units[id]).toMatchObject({ id, strength, hits, move, cost, buildTurns, upkeep });
    }
  });

  it('matches the unique units table in DESIGN.md', () => {
    const uniques: [string, string, number, number, number, number, number, number][] = [
      // id, faction, Strength, Hits, Move, Cost, Build (before traits), Upkeep
      ['rangers', 'elves', 4, 2, 8, 24, 2, 3],
      ['ironguard', 'dwarves', 5, 3, 6, 30, 2, 4],
      ['horse-archers', 'horse-clans', 3, 2, 12, 18, 2, 2],
      ['trolls', 'orc-horde', 5, 3, 8, 38, 2, 5],
    ];
    for (const [id, faction, strength, hits, move, cost, buildTurns, upkeep] of uniques) {
      expect(fantasy.units[id]).toMatchObject({ id, strength, hits, move, cost, buildTurns, upkeep });
      expect(fantasy.factions[faction]!.uniqueUnit).toBe(id);
    }
    expect(fantasy.units['horse-archers']).toMatchObject({ pursuitStrikes: 2 });
    expect(fantasy.units['horse-archers']!.tags).toContain('mounted');
    expect(fantasy.units.rangers!.tags).toContain('defense-bonus');
  });

  it('lists upkeep as 12% of the price, rounded, minimum 1; heroes pay none', () => {
    for (const u of Object.values(fantasy.units)) {
      if (u.cost === undefined) expect(u.upkeep).toBeUndefined();
      else expect(u.upkeep).toBe(upkeepFor(u.cost));
    }
    expect(fantasy.units.hero!.upkeep).toBeUndefined();
  });

  it('has the base hero and the faction uniques', () => {
    expect(fantasy.units.hero).toMatchObject({ strength: 5, hits: 3, move: 10 });
    expect(fantasy.units.hero!.tags).toContain('leads-stack');
    expect(fantasy.units.ironguard).toMatchObject({ strength: 5, hits: 3, move: 6 });
    expect(fantasy.units.trolls).toMatchObject({ strength: 5, hits: 3 });
    expect(fantasy.units.trolls!.tags).toContain('regenerates');
    expect(fantasy.factions.dwarves).toMatchObject({ id: 'dwarves', uniqueUnit: 'ironguard' });
    expect(Object.keys(fantasy.factions)).toHaveLength(4);
  });

  it('has the terrain table from DESIGN.md (costs doubled)', () => {
    const cost = (id: string) => fantasy.terrain[id]!.moveCost;
    expect([cost('plains'), cost('forest'), cost('hills'), cost('swamp')]).toEqual([2, 4, 4, 6]);
    expect([cost('mountains'), cost('water'), cost('river')]).toEqual([null, null, null]);
    expect(fantasy.terrain.forest).toMatchObject({ defensePct: 25, traitCosts: { 'forest-native': 2 } });
    expect(fantasy.terrain.hills).toMatchObject({ defensePct: 25, visionBonus: 1 });
    expect(fantasy.terrain.mountains!.traitCosts).toEqual({ 'mountain-walker': 6 });
    expect(fantasy.features).toMatchObject({ road: { moveCost: 1 }, bridge: { moveCost: 1 }, ford: { moveCost: 4 } });
  });

  it('is JSON-safe', () => {
    expect(JSON.parse(JSON.stringify(fantasy))).toEqual(fantasy);
  });
});

describe('loadContent validation', () => {
  const good = {
    id: 't',
    name: 'T',
    units: { a: { name: 'A', strength: 3, hits: 2, move: 8, tags: [] } },
    factions: {},
    terrain: { plains: { name: 'P', moveCost: 2 } },
    features: { road: { name: 'R', moveCost: 1 }, bridge: { name: 'B', moveCost: 1 }, ford: { name: 'F', moveCost: 4 } },
  };

  it('accepts a minimal pack', () => {
    expect(loadContent(good).units.a!.id).toBe('a');
  });

  it('rejects bad stats', () => {
    const bad = { ...good, units: { a: { name: 'A', strength: 0, hits: 2, move: 8, tags: [] } } };
    expect(() => loadContent(bad)).toThrow(/strength/);
    const noHits = { ...good, units: { a: { name: 'A', strength: 3, hits: 1.5, move: 8, tags: [] } } };
    expect(() => loadContent(noHits)).toThrow(/hits/);
  });

  it('rejects bad terrain and missing features', () => {
    expect(() => loadContent({ ...good, terrain: { x: { name: 'X', moveCost: 0 } } })).toThrow(/moveCost/);
    expect(loadContent({ ...good, terrain: { x: { name: 'X', moveCost: null } } }).terrain.x!.moveCost).toBeNull();
    expect(() => loadContent({ ...good, features: { road: { name: 'R', moveCost: 1 } } })).toThrow(/bridge/);
  });

  it('rejects a bad pursuit strike count', () => {
    const bad = { ...good, units: { a: { name: 'A', strength: 3, hits: 2, move: 8, tags: [], pursuitStrikes: 0 } } };
    expect(() => loadContent(bad)).toThrow(/pursuitStrikes/);
  });

  it('rejects a faction whose unique unit does not exist', () => {
    const bad = { ...good, factions: { f: { name: 'F', traits: [], uniqueUnit: 'nope' } } };
    expect(() => loadContent(bad)).toThrow(/nope/);
  });
});
