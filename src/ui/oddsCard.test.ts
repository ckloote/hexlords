import { describe, expect, it } from 'vitest';
import { fantasy, testMapJson } from '../content/fantasy';
import stringsJson from '../content/fantasy/strings.json';
import { previewAttack } from '../engine/combat';
import { createGame } from '../engine/engine';
import { at, plainsMap } from '../engine/test-fixtures';
import { loadTiledMap } from '../engine/tiled';
import { viewFor } from '../engine/vision';
import { oddsCard } from './oddsCard';
import { loadStrings } from './strings';

const strings = loadStrings(stringsJson);
const players = [
  { id: 'p1', factionId: 'dwarves' },
  { id: 'p2', factionId: 'orc-horde' },
];

describe('oddsCard', () => {
  it('reproduces the Attack mockup for Gravelmaw', () => {
    const s = createGame(
      {
        seed: 1,
        map: loadTiledMap(testMapJson, fantasy),
        players,
        stacks: [
          { owner: 'p1', pos: at(6, 3), units: ['siege-engine', 'infantry', { typeId: 'infantry', hits: 1 }, 'ironguard', 'hero'] },
          { owner: 'p2', pos: at(6, 2), units: ['militia', 'militia', 'infantry', 'infantry', 'trolls'] },
        ],
      },
      fantasy,
    );
    const view = viewFor(s, fantasy, 'p1');
    const preview = previewAttack(view, fantasy, 's1', 's2', 0.3);
    if ('error' in preview) throw new Error(preview.error);
    const card = oddsCard(view, fantasy, strings, 's1', 's2', preview, 0.3);
    if (card.evades) throw new Error('unexpected evade');
    expect(card.title).toBe('Attack Gravelmaw');
    expect(card.subtitle).toBe('Orc Horde city · 5 defenders');
    expect(card.winChance).toBe('79%');
    expect(card.youKeep).toBe('1.5 of 5');
    expect(card.theyKeep).toBe('0.3 of 5');
    expect(card.yourLines).toEqual([{ label: 'Leadership', value: '+25%' }]);
    expect(card.theirLines).toEqual([
      { label: 'City walls', value: '+25%' },
      { label: 'Siege engine', value: '−25%' },
    ]);
    expect(card.yourOrder.map((r) => [r.name, r.strength, r.wounded])).toEqual([
      ['Siege engine', '2.5', false],
      ['Infantry', '5', false],
      ['Infantry', '5', true],
      ['Ironguard', '6.25', false],
      ['Hero', '6.25', false],
    ]);
    expect(card.theirOrder.map((r) => r.strength)).toEqual(['2', '2', '4', '4', '5']);
    // Garrisons never fall back: no fourth segment.
    expect(card.segments.map((x) => x.kind)).toEqual(['win', 'withdraw', 'destroyed']);
    expect(card.withdrawBelow).toBe('30%');
    expect(card.pursuitNote).toMatch(/strikes once/);
  });

  it('shows the fall-back segment for a field stack, a clean break, and an evade', () => {
    const make = (stance: 'fall-back' | 'evade', attackers: string[], defenders: string[]) => {
      const s = createGame(
        {
          seed: 1,
          map: plainsMap(8, 5),
          players,
          stacks: [
            { owner: 'p1', pos: at(3, 2), units: attackers },
            {
              owner: 'p2',
              pos: at(4, 2),
              units: defenders,
              stance: stance === 'evade' ? { kind: 'evade' } : { kind: 'fall-back', threshold: 0.4 },
            },
          ],
        },
        fantasy,
      );
      const view = viewFor(s, fantasy, 'p1');
      const preview = previewAttack(view, fantasy, 's1', 's2', 0.3);
      if ('error' in preview) throw new Error(preview.error);
      return oddsCard(view, fantasy, strings, 's1', 's2', preview, 0.3);
    };
    const field = make('fall-back', ['cavalry', 'cavalry'], ['infantry', 'infantry']);
    if (field.evades) throw new Error('unexpected');
    expect(field.segments.map((x) => x.kind)).toEqual(['win', 'defender-withdraw', 'withdraw', 'destroyed']);
    expect(field.pursuitNote).toMatch(/break away cleanly/);
    expect(field.subtitle).toBe('Orc Horde · 2 units');
    expect(make('evade', ['infantry', 'infantry', 'infantry'], ['cavalry']).evades).toBe(true);
  });
});
