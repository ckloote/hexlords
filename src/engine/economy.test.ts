import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import {
  armyValue,
  chooseDeserter,
  cityIncome,
  dominationTarget,
  incomeOf,
  lastStandPlayer,
  pillagedTier,
  pillageGold,
  securedScore,
  totalIncome,
  upkeepOf,
} from './economy';
import { createGame, type GameSetup } from './engine';
import type { CityTier } from './map';
import { asciiMap, at } from './test-fixtures';
import type { GameState } from './types';

/** DESIGN's example: 4 capitals, 6 cities, and 8 villages make 180 total income. Each player starts with one capital. */
function designMap(): GameState {
  const tiers: CityTier[] = [...Array(4).fill('capital'), ...Array(6).fill('city'), ...Array(8).fill('village')];
  const owners = ['p1', 'p2', 'p3', 'p4'];
  const map = asciiMap(
    Array.from({ length: 3 }, () => '.'.repeat(18)),
    tiers.map((tier, k) => ({ at: at(k, 0), tier, owner: owners[k] })),
  );
  const setup: GameSetup = {
    seed: 1,
    map,
    players: [
      { id: 'p1', factionId: 'dwarves' },
      { id: 'p2', factionId: 'orc-horde' },
      { id: 'p3', factionId: 'elves' },
      { id: 'p4', factionId: 'horse-clans' },
    ],
    stacks: [
      { owner: 'p1', pos: at(0, 2), units: ['militia', 'infantry', 'griffins', 'hero'] },
      { owner: 'p1', pos: at(5, 2), units: ['ironguard', 'ironguard'] },
      { owner: 'p2', pos: at(9, 2), units: ['trolls'] },
    ],
  };
  return createGame(setup, fantasy);
}

describe('income and score', () => {
  const s = designMap();

  it('pays 5, 10, and 20 gold by tier', () => {
    expect([cityIncome('village'), cityIncome('city'), cityIncome('capital')]).toEqual([5, 10, 20]);
  });

  it('totals the map, and domination needs half of it', () => {
    expect(totalIncome(s)).toBe(180);
    expect(dominationTarget(s)).toBe(90);
    expect(incomeOf(s, 'p1')).toBe(20);
    expect(securedScore(s, 'p1')).toBe(20);
  });

  it('counts only secured cities toward the score, and drops razed ones from every total', () => {
    const fresh = { ...s, cities: { ...s.cities, c4: { ...s.cities.c4!, owner: 'p1', secured: false, heldSince: null } } };
    expect(incomeOf(fresh, 'p1')).toBe(30);
    expect(securedScore(fresh, 'p1')).toBe(20);
    const razed = { ...s, cities: { ...s.cities, c0: { ...s.cities.c0!, owner: null, razed: true } } };
    expect(totalIncome(razed)).toBe(160);
    expect(dominationTarget(razed)).toBe(80);
    expect(incomeOf(razed, 'p1')).toBe(0);
  });

  it('warns when one player holds more than half the current income', () => {
    expect(lastStandPlayer(s)).toBeNull();
    const cities = { ...s.cities };
    for (const id of ['c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13']) cities[id] = { ...cities[id]!, owner: 'p1' };
    const overHalf = { ...s, cities }; // 20 + 60 + 20 = 100 of 180
    expect(incomeOf(overHalf, 'p1')).toBe(100);
    expect(lastStandPlayer(overHalf)).toBe('p1');
    cities.c4 = { ...cities.c4!, owner: 'p2' };
    expect(lastStandPlayer({ ...s, cities })).toBeNull(); // exactly 90 is not more than half
  });
});

describe('upkeep and army value', () => {
  const s = designMap();

  it('sums the unit table upkeep; commanders pay none', () => {
    // militia 1 + infantry 2 + griffins 4 + hero 0 + 2 ironguard 4 each
    expect(upkeepOf(s, fantasy, 'p1')).toBe(15);
    expect(upkeepOf(s, fantasy, 'p2')).toBe(5);
    expect(upkeepOf(s, fantasy, 'p3')).toBe(0);
  });

  it('values an army at its purchase price', () => {
    expect(armyValue(s, fantasy, 'p1')).toBe(8 + 16 + 30 + 0 + 30 + 30);
  });

  it('picks the unit with the highest upkeep to desert, then the dearest, never a commander', () => {
    // Griffins and ironguard both cost 4 a turn and 30 gold; the newer unit (an ironguard) goes.
    const first = chooseDeserter(s, fantasy, 'p1')!;
    expect(s.units[first]!.typeId).toBe('ironguard');
    const heroOnly = { ...s, stacks: { s1: { ...s.stacks.s1!, unitIds: [s.stacks.s1!.unitIds[3]!] } } };
    expect(chooseDeserter(heroOnly, fantasy, 'p1')).toBeNull();
  });
});

describe('pillage', () => {
  it('pays three turns of income and drops a tier; a village is razed', () => {
    expect(pillageGold('capital')).toBe(60);
    expect(pillageGold('city')).toBe(30);
    expect(pillageGold('village')).toBe(15);
    expect(pillagedTier('capital')).toBe('city');
    expect(pillagedTier('city')).toBe('village');
    expect(pillagedTier('village')).toBeNull();
  });
});
