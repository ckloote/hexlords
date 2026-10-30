import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { loadContent } from './content';

describe('fantasy content pack', () => {
  it('matches the shared roster in DESIGN.md', () => {
    const roster: [string, number, number, number, number, number][] = [
      // id, Strength, Hits, Move, Cost, Build
      ['militia', 2, 2, 8, 8, 1],
      ['archers', 3, 2, 8, 15, 1],
      ['infantry', 4, 2, 8, 16, 1],
      ['cavalry', 4, 2, 12, 20, 2],
      ['siege-engine', 2, 2, 6, 20, 2],
      ['griffins', 5, 2, 16, 30, 3],
    ];
    for (const [id, strength, hits, move, cost, buildTurns] of roster) {
      expect(fantasy.units[id]).toMatchObject({ id, strength, hits, move, cost, buildTurns });
    }
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

  it('is JSON-safe', () => {
    expect(JSON.parse(JSON.stringify(fantasy))).toEqual(fantasy);
  });
});

describe('loadContent validation', () => {
  const good = { id: 't', name: 'T', units: { a: { name: 'A', strength: 3, hits: 2, move: 8, tags: [] } }, factions: {} };

  it('accepts a minimal pack', () => {
    expect(loadContent(good).units.a!.id).toBe('a');
  });

  it('rejects bad stats', () => {
    const bad = { ...good, units: { a: { name: 'A', strength: 0, hits: 2, move: 8, tags: [] } } };
    expect(() => loadContent(bad)).toThrow(/strength/);
    const noHits = { ...good, units: { a: { name: 'A', strength: 3, hits: 1.5, move: 8, tags: [] } } };
    expect(() => loadContent(noHits)).toThrow(/hits/);
  });

  it('rejects a faction whose unique unit does not exist', () => {
    const bad = { ...good, factions: { f: { name: 'F', traits: [], uniqueUnit: 'nope' } } };
    expect(() => loadContent(bad)).toThrow(/nope/);
  });
});
