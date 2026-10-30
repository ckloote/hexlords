import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import stringsJson from '../content/fantasy/strings.json';
import { at } from '../engine/test-fixtures';
import type { GameEvent, GameState } from '../engine/types';
import { viewFor } from '../engine/vision';
import { cityCard, countNames } from './cityCard';
import { Game } from './controller';
import { demoGame } from './demo';
import { initialUi, type Input, MOVED, type UiState } from './interaction';
import { leaderLine, netLabel, scoreboard, scoreLine } from './scoreboard';
import { loadStrings } from './strings';
import { buildSummary } from './summary';

// Demo game: the dwarves (p1) hold Stonebridge (site4, city) and Kettle Ford
// (site3, village); the orcs (p2) hold Gravelmaw (site1, city) and Hollow Pine
// (site2, village); Ashvale (site5, city) is neutral. 40 total income, so
// domination at the default 50% needs 20.
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
    expect(board).toMatchObject({ gold: 50, income: 15, upkeep: 14, net: 1, turn: 1, turnLimit: 40, total: 40, target: 20, lastStand: null });
    expect(scoreLine(board)).toBe('You 15 · Orcs 15');
    expect(netLabel(board.net)).toBe('+1 per turn');
    expect(netLabel(-4)).toBe('−4 per turn');
    expect(leaderLine(board, view, fantasy)).toBe('You share the lead with 15.');
    const orcs = viewFor(demoGame(), fantasy, 'p2');
    expect(scoreboard(orcs, fantasy)).toMatchObject({ income: 15, upkeep: 14, net: 1 });
  });

  it('warns of a last stand only past half the income: a village is not enough, a city is', () => {
    const s = demoGame();
    const take = (siteId: string): GameState => ({ ...s, cities: { ...s.cities, [siteId]: { ...s.cities[siteId]!, owner: 'p1' } } });
    expect(scoreboard(viewFor(take('site2'), fantasy, 'p1'), fantasy).lastStand).toBeNull(); // 20 of 40
    expect(scoreboard(viewFor(take('site5'), fantasy, 'p1'), fantasy).lastStand).toBe('p1'); // 25 of 40
    const orcLead = viewFor(take('site5'), fantasy, 'p2');
    expect(leaderLine(scoreboard(orcLead, fantasy), orcLead, fantasy)).toBe('You share the lead with 15.'); // Ashvale is not secured yet
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
    expect(cityCard(view, fantasy, strings, 'site2')).toMatchObject({ owner: 'p2', mine: false, holding: 'Secured' });
    expect(cityCard(view, fantasy, strings, 'site5')).toMatchObject({ name: 'Ashvale', owner: null, holding: '' });
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
        attackerStackId: 's4',
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
      { kind: 'captured', playerId: 'p2', siteId: 'site3', from: 'p1', stackId: 's4' },
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
    expect(summary.leader).toBe('You share the lead with 15. Domination needs 20 secured.');
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

  it('keeps the city panel open when a build is rejected', () => {
    const game = new Game(demoGame(), fantasy);
    const ui = play(game, [{ kind: 'tap', hex: STONEBRIDGE }, { kind: 'build', unitTypeId: 'griffins' }]);
    expect(ui.mode).toEqual({ kind: 'city', siteId: 'site4' });
    expect(ui.message).toMatch(/cannot build/);
    expect(game.state.cities.site4!.production).toBeNull();
  });

  it('asks what to do with a captured city before anything else', () => {
    const s = demoGame();
    // Put the griffins next to the orcs' empty Hollow Pine.
    const game = new Game({ ...s, stacks: { ...s.stacks, s2: { ...s.stacks.s2!, pos: at(11, 4) } } }, fantasy);
    let ui = play(game, [{ kind: 'tap', hex: at(11, 4) }, { kind: 'tap', hex: HOLLOW_PINE }, { kind: 'confirm' }]);
    expect(ui.mode).toEqual({ kind: 'capture', siteId: 'site2' });
    // Other inputs keep the capture card up.
    ui = play(game, [{ kind: 'endTurn' }], ui);
    expect(ui.mode).toEqual({ kind: 'capture', siteId: 'site2' });
    expect(game.playerId).toBe('p1');
    ui = play(game, [{ kind: 'capture', choice: 'pillage' }], ui);
    expect(ui.message).toBe('Hollow Pine lies in ruins; you took 15 gold.');
    expect(ui.mode).toMatchObject({ kind: 'selected', stackId: 's2' });
    expect(game.state.gold.p1).toBe(65);
    expect(game.state.cities.site2!.razed).toBe(true);
  });

  it('continues every saved route at turn start, then asks about a city one of them took', () => {
    const s = demoGame();
    // The host stands next to neutral Ashvale with it as its destination; the griffins head south.
    const state: GameState = {
      ...s,
      stacks: {
        ...s.stacks,
        s1: { ...s.stacks.s1!, pos: at(3, 5), destination: at(2, 5) },
        s2: { ...s.stacks.s2!, destination: at(4, 15) },
      },
    };
    const game = new Game(state, fantasy);
    const ui = play(game, [{ kind: 'continue' }], { mode: { kind: 'summary', events: [] }, message: null });
    expect(game.state.stacks.s1!.pos).toEqual(at(2, 5));
    expect(game.state.stacks.s2!.pos).not.toEqual(at(4, 12)); // the second route ran too
    expect(ui).toEqual({ mode: { kind: 'capture', siteId: 'site5' }, message: '2 stacks continued along their routes.' });
  });

  it('a queued attack staged from an empty enemy city still attacks; the capture card follows the result', () => {
    const s = demoGame();
    // Griffins west of the orcs' empty Hollow Pine, the orc patrol east of it.
    const state: GameState = {
      ...s,
      stacks: { ...s.stacks, s2: { ...s.stacks.s2!, pos: at(11, 4) }, s4: { ...s.stacks.s4!, pos: at(13, 4) } },
    };
    const game = new Game(state, fantasy);
    const run = game.run([
      { type: 'Move', playerId: 'p1', stackId: 's2', path: [HOLLOW_PINE] },
      { type: 'Attack', playerId: 'p1', stackId: MOVED, targetStackId: 's4' },
    ]);
    expect(run.error).toBeNull();
    const battle = run.events.find((e) => e.kind === 'battle');
    expect(run.events.find((e) => e.kind === 'captured')).toMatchObject({ siteId: 'site2', from: 'p2' });
    if (!battle || battle.kind !== 'battle') throw new Error('no battle');
    const ui = play(game, [{ kind: 'continue' }], { mode: { kind: 'result', report: battle }, message: null });
    expect(ui.mode).toEqual({ kind: 'capture', siteId: 'site2' });
  });
});
