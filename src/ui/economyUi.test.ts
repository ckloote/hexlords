import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import stringsJson from '../content/fantasy/strings.json';
import { at } from '../engine/test-fixtures';
import type { GameEvent, GameState } from '../engine/types';
import { viewFor } from '../engine/vision';
import { cityCard, countNames } from './cityCard';
import { Game } from './controller';
import { demoGame } from './demo';
import { initialUi, type Input, type UiState } from './interaction';
import { leaderLine, netLabel, scoreboard, scoreLine } from './scoreboard';
import { loadStrings } from './strings';
import { buildSummary } from './summary';

// Demo game: the dwarves (p1) hold Stonebridge (site4, city) and Kettle Ford
// (site3, village); the orcs (p2) hold Gravelmaw (site1, city); Hollow Pine
// (site2, village) is neutral. The test map's domination share is 70%.
const strings = loadStrings(stringsJson);
const STONEBRIDGE = at(6, 14);
const HOLLOW_PINE = at(12, 4);

function play(game: Game, inputs: Input[], start: UiState = initialUi): UiState {
  let ui = start;
  for (const input of inputs) ui = game.handle(ui, input).ui;
  return ui;
}

describe('scoreboard', () => {
  it('shows gold, net income after upkeep, the turn, and secured scores', () => {
    const view = viewFor(demoGame(), fantasy, 'p1');
    const board = scoreboard(view, fantasy);
    expect(board).toMatchObject({ gold: 50, income: 15, upkeep: 26, net: -11, turn: 1, turnLimit: 40, total: 30, target: 21, lastStand: null });
    expect(scoreLine(board)).toBe('You 15 · Orcs 10');
    expect(netLabel(board.net)).toBe('−11 per turn');
    expect(leaderLine(board, view, fantasy)).toBe('You lead with 15.');
    const orcs = viewFor(demoGame(), fantasy, 'p2');
    expect(leaderLine(scoreboard(orcs, fantasy), orcs, fantasy)).toBe('Leading: the Dwarves with 15. You are second with 10.');
  });
});

describe('city card', () => {
  it('lists the build list with cost, time, upkeep, and specials', () => {
    const view = viewFor(demoGame(), fantasy, 'p1');
    const card = cityCard(view, fantasy, strings, 'site4');
    expect(card).toMatchObject({ name: 'Stonebridge', mine: true, subtitle: 'City · walls +25% · 10 gold a turn', holding: 'Secured', building: null, garrison: 'Empty' });
    expect(card.options.map((o) => o.unitTypeId)).toEqual(['militia', 'archers', 'infantry', 'siege-engine', 'ironguard']);
    expect(card.options[1]).toMatchObject({ stats: 'Str 3 · 2 hits · Move 8 · +25% defending', cost: 15, turns: 1, upkeep: 2, affordable: true });
  });

  it('shows progress and when the unit will be ready, or why it waits', () => {
    const s = demoGame();
    const building: GameState = { ...s, cities: { ...s.cities, site4: { ...s.cities.site4!, production: { unitTypeId: 'ironguard', progress: 1 } } } };
    expect(cityCard(viewFor(building, fantasy, 'p1'), fantasy, strings, 'site4').building).toEqual({
      name: 'Ironguard',
      progress: 1,
      turns: 2,
      status: 'Ready on turn 2',
    });
    const broke: GameState = { ...building, gold: { ...building.gold, p1: 3 }, cities: { ...building.cities, site4: { ...building.cities.site4!, production: { unitTypeId: 'ironguard', progress: 2 } } } };
    expect(cityCard(viewFor(broke, fantasy, 'p1'), fantasy, strings, 'site4').building!.status).toBe('Waiting for gold: needs 30');
  });

  it('shows other cities without their production', () => {
    const view = viewFor(demoGame(), fantasy, 'p1');
    expect(cityCard(view, fantasy, strings, 'site1')).toMatchObject({ mine: false, options: [], building: null, garrison: 'Not in sight' });
    expect(cityCard(view, fantasy, strings, 'site2')).toMatchObject({ owner: null, holding: '' });
  });

  it('counts unit names', () => {
    expect(countNames(['Archers', 'Militia', 'Archers'])).toBe('2 Archers, 1 Militia');
  });
});

describe('turn summary', () => {
  it('reports battles against you, lost cities, new units, and the economy', () => {
    const view = viewFor(demoGame(), fantasy, 'p1');
    const events: GameEvent[] = [
      {
        kind: 'battle',
        attackerOwner: 'p2',
        defenderOwner: 'p1',
        attackerStackId: 's6',
        defenderStackId: 's2',
        attackerUnitIds: ['a', 'b'],
        defenderUnitIds: ['c', 'd'],
        modifiers: [],
        outcome: 'destroyed',
        events: [
          { kind: 'death', side: 'defender', unit: 0 },
          { kind: 'death', side: 'attacker', unit: 0 },
          { kind: 'death', side: 'attacker', unit: 1 },
        ],
        attackerAdvanced: false,
      },
      { kind: 'captured', playerId: 'p2', siteId: 'site3', from: 'p1', stackId: 's7' },
      { kind: 'income', playerId: 'p1', income: 10, upkeep: 26, gold: 0 },
      { kind: 'unit-built', playerId: 'p1', siteId: 'site4', unitId: 'u99', unitTypeId: 'infantry', cost: 16 },
      { kind: 'deserted', playerId: 'p1', unitId: 'u5', unitTypeId: 'griffins' },
    ];
    const summary = buildSummary(view, fantasy, strings, events);
    expect(summary.items).toEqual([
      { tone: 'good', title: 'The Orc Horde attacked you', detail: 'Your stack held. You lost 1; they lost 2.' },
      { tone: 'danger', title: 'The Orc Horde took Kettle Ford', detail: 'Village lost · income −5 a turn' },
      { tone: 'good', title: 'New unit ready', detail: 'Infantry at Stonebridge' },
      { tone: 'danger', title: 'Units deserted', detail: '1 Griffins left: the treasury could not pay upkeep.' },
    ]);
    expect(summary.economy).toBe('Income 10 − upkeep 26 = −16 gold · treasury 50');
    expect(summary.leader).toBe('You lead with 15. Domination needs 21 secured.');
  });
});

describe('cities and captures in play', () => {
  it('opens a city by tapping it, and sets production from the build list', () => {
    const game = new Game(demoGame(), fantasy);
    let ui = play(game, [{ kind: 'tap', hex: STONEBRIDGE }]);
    expect(ui.mode).toEqual({ kind: 'city', siteId: 'site4' });
    ui = play(game, [{ kind: 'build', unitTypeId: 'archers' }], ui);
    expect(ui.mode).toEqual({ kind: 'city', siteId: 'site4' });
    expect(game.state.cities.site4!.production).toEqual({ unitTypeId: 'archers', progress: 0 });
    play(game, [{ kind: 'build', unitTypeId: null }], ui);
    expect(game.state.cities.site4!.production).toBeNull();
  });

  it('asks what to do with a captured city before anything else', () => {
    const s = demoGame();
    // Put the griffins next to Hollow Pine.
    const game = new Game({ ...s, stacks: { ...s.stacks, s3: { ...s.stacks.s3!, pos: at(11, 4) } } }, fantasy);
    let ui = play(game, [{ kind: 'tap', hex: at(11, 4) }, { kind: 'tap', hex: HOLLOW_PINE }, { kind: 'confirm' }]);
    expect(ui.mode).toEqual({ kind: 'capture', siteId: 'site2' });
    // Other inputs keep the capture card up.
    ui = play(game, [{ kind: 'endTurn' }], ui);
    expect(ui.mode).toEqual({ kind: 'capture', siteId: 'site2' });
    expect(game.playerId).toBe('p1');
    ui = play(game, [{ kind: 'capture', choice: 'pillage' }], ui);
    expect(ui.message).toBe('Hollow Pine lies in ruins; you took 15 gold.');
    expect(ui.mode).toMatchObject({ kind: 'selected', stackId: 's3' });
    expect(game.state.gold.p1).toBe(65);
    expect(game.state.cities.site2!.razed).toBe(true);
  });
});
