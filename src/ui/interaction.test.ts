import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { hexKey } from '../engine/hex';
import { findPath } from '../engine/movement';
import { at } from '../engine/test-fixtures';
import { Game } from './controller';
import { demoGame } from './demo';
import { initialUi, type Input, interact, MOVED, type UiState } from './interaction';

// Demo game: p1 (dwarves) has the host s1 at (6,9) south of the bridge; the orc
// patrol s6 holds (6,7) north of it on Fall back 40%.
const HOST = at(6, 9);
const PATROL = at(6, 7);

function play(game: Game, inputs: Input[], start: UiState = initialUi): UiState {
  let ui = start;
  for (const input of inputs) ui = game.handle(ui, input).ui;
  return ui;
}

/** Ends the turn (past the idle-city warning) and starts the next player's: hand-off, then the summary. */
function passTurn(game: Game, start: UiState = initialUi): UiState {
  let ui = play(game, [{ kind: 'endTurn' }], start);
  if (ui.endWarned) ui = play(game, [{ kind: 'endTurn' }], ui);
  return play(game, [{ kind: 'continue' }, { kind: 'continue' }], ui);
}

describe('selecting and previewing moves', () => {
  it('selects your stack, ignores taps on enemies, and deselects', () => {
    const game = new Game(demoGame(), fantasy);
    let ui = play(game, [{ kind: 'tap', hex: HOST }]);
    expect(ui.mode).toEqual({ kind: 'selected', stackId: 's1', split: [] });
    ui = play(game, [{ kind: 'tap', hex: HOST }], ui);
    expect(ui.mode.kind).toBe('idle');
    ui = play(game, [{ kind: 'tap', hex: PATROL }], ui);
    expect(ui.mode.kind).toBe('idle');
    expect(ui.message).toBe('Enemy: Infantry, Militia · Fall back below 40%');
  });

  it('previews with the engine\'s path, moves on the second tap, and keeps the stack selected', () => {
    const game = new Game(demoGame(), fantasy);
    const goal = at(6, 12);
    let ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: goal }]);
    expect(ui.mode.kind).toBe('move');
    const view = game.view();
    expect(ui.mode.kind === 'move' && ui.mode.steps).toEqual(findPath(view, fantasy, 's1', goal, { visible: new Set(view.visible) }));
    expect(game.state.stacks.s1!.pos).toEqual(HOST); // nothing happened yet
    ui = play(game, [{ kind: 'tap', hex: goal }], ui);
    expect(game.state.stacks.s1!.pos).toEqual(goal);
    expect(ui.mode).toEqual({ kind: 'selected', stackId: 's1', split: [] });
  });

  it('a tap on another hex re-previews instead of moving', () => {
    const game = new Game(demoGame(), fantasy);
    const ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: at(6, 12) }, { kind: 'tap', hex: at(5, 12) }]);
    expect(ui.mode.kind === 'move' && hexKey(ui.mode.goal)).toBe(hexKey(at(5, 12)));
    expect(game.state.stacks.s1!.pos).toEqual(HOST);
  });

  it('a long route moves as far as it can and saves the destination', () => {
    const game = new Game(demoGame(), fantasy);
    const far = at(1, 16);
    const ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: far }, { kind: 'confirm' }]);
    expect(game.state.stacks.s1!.destination).toEqual(far);
    expect(ui.message).toMatch(/continues next turn/);
  });

  it('splits off picked units', () => {
    const game = new Game(demoGame(), fantasy);
    const [first, second] = game.state.stacks.s1!.unitIds;
    let ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'toggleUnit', unitId: second! }, { kind: 'toggleUnit', unitId: first! }]);
    expect(ui.mode).toEqual({ kind: 'selected', stackId: 's1', split: [first, second] });
    expect(play(game, [{ kind: 'clearSplit' }], ui).mode).toEqual({ kind: 'selected', stackId: 's1', split: [] });
    ui = play(game, [{ kind: 'tap', hex: at(6, 11) }, { kind: 'confirm' }], ui);
    expect(game.state.stacks.s1!.unitIds).toHaveLength(3);
    const moved = Object.values(game.state.stacks).find((s) => s.unitIds.includes(first!))!;
    expect(moved.pos).toEqual(at(6, 11));
    expect(ui.mode).toEqual({ kind: 'selected', stackId: moved.id, split: [] });
  });
});

describe('attacking', () => {
  it('previews an attack, adjusts the threshold, and confirms with Move + Attack', () => {
    const game = new Game(demoGame(), fantasy);
    const view = game.view();
    let ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: PATROL }]);
    expect(ui.mode).toMatchObject({ kind: 'attack', targetId: 's6', withdrawBelow: 0.3 });
    ui = play(game, [{ kind: 'withdraw', delta: 1 }, { kind: 'withdraw', delta: 1 }], ui);
    expect(ui.mode).toMatchObject({ withdrawBelow: 0.4 });
    for (let k = 0; k < 30; k++) ui = play(game, [{ kind: 'withdraw', delta: -1 }], ui);
    expect(ui.mode).toMatchObject({ withdrawBelow: 0 });
    const step = interact(view, fantasy, { mode: { ...ui.mode, withdrawBelow: 0.3 } as UiState['mode'], message: null }, { kind: 'confirm' });
    expect(step.commands.map((c) => c.type)).toEqual(['Move', 'Attack']);
    expect(step.commands[1]).toMatchObject({ stackId: MOVED, targetStackId: 's6', withdrawBelow: 0.3 });
  });

  it('runs the battle and shows the result', () => {
    const game = new Game(demoGame(), fantasy);
    let ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: PATROL }, { kind: 'confirm' }]);
    expect(ui.mode.kind).toBe('result');
    expect(ui.mode.kind === 'result' && ui.mode.report.defenderStackId).toBe('s6');
    for (const id of game.state.stacks.s1?.unitIds ?? []) expect(game.state.units[id]!.moveLeft).toBe(0);
    ui = play(game, [{ kind: 'continue' }], ui);
    expect(['selected', 'idle']).toContain(ui.mode.kind);
  });

  it('an enemy out of reach this turn gets a route toward it, with a note', () => {
    const game = new Game(demoGame(), fantasy);
    // The patrol is in sight (2 hexes) but the host has only 1 movement left:
    // the bridge (1) plus the attack step (1) is too much this turn.
    const units = { ...game.state.units };
    for (const id of game.state.stacks.s1!.unitIds) units[id] = { ...units[id]!, moveLeft: 1 };
    game.state = { ...game.state, units };
    const ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: PATROL }]);
    expect(ui.mode.kind).toBe('move');
    expect(ui.message).toMatch(/Out of reach/);
    // A hidden enemy is just a hex: from far away the same tap previews a plain move, with no note.
    const far = new Game(demoGame(), fantasy);
    let ui2 = play(far, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: at(6, 12) }, { kind: 'confirm' }]);
    ui2 = play(far, [{ kind: 'tap', hex: PATROL }], ui2);
    expect(ui2.message).toBeNull();
  });

  it('attacks directly when already adjacent', () => {
    const game = new Game(demoGame(), fantasy);
    play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: at(6, 8) }, { kind: 'confirm' }]); // onto the bridge
    const view = game.view();
    const step = interact(view, fantasy, { mode: { kind: 'selected', stackId: 's1', split: [] }, message: null }, { kind: 'tap', hex: PATROL });
    expect(step.ui.mode).toMatchObject({ kind: 'attack', path: [] });
    expect(interact(view, fantasy, step.ui, { kind: 'confirm' }).commands.map((c) => c.type)).toEqual(['Attack']);
  });
});

describe('turns and stances', () => {
  it('sets stances, steps the fall-back threshold, and cycles Next stack', () => {
    const game = new Game(demoGame(), fantasy);
    let ui = play(game, [{ kind: 'tap', hex: HOST }, { kind: 'stance', stance: 'fall-back' }]);
    expect(game.state.stacks.s1!.stance).toEqual({ kind: 'fall-back', threshold: 0.3 });
    ui = play(game, [{ kind: 'stanceThreshold', delta: 1 }], ui);
    expect(game.state.stacks.s1!.stance).toEqual({ kind: 'fall-back', threshold: 0.35 });
    ui = play(game, [{ kind: 'nextStack' }], ui);
    expect(ui.mode).toMatchObject({ kind: 'selected', stackId: 's2' });
    ui = play(game, [{ kind: 'nextStack' }, { kind: 'nextStack' }, { kind: 'nextStack' }], ui);
    expect(ui.mode).toMatchObject({ stackId: 's1' }); // wraps around
  });

  it('ends the turn with a hand-off; the next player sees only their own view', () => {
    const game = new Game(demoGame(), fantasy);
    // Stonebridge and Kettle Ford have nothing in production: the first tap warns.
    let ui = play(game, [{ kind: 'endTurn' }]);
    expect(ui.mode.kind).toBe('idle');
    expect(ui.message).toBe('Kettle Ford and Stonebridge have nothing in production. Tap End turn again to end anyway.');
    expect(game.playerId).toBe('p1');
    ui = play(game, [{ kind: 'endTurn' }], ui);
    expect(ui.mode).toEqual({ kind: 'handoff', playerId: 'p2' });
    expect(game.playerId).toBe('p2');
    // Taps do nothing until the new player continues, then the turn summary shows.
    expect(play(game, [{ kind: 'tap', hex: PATROL }], ui)).toEqual(ui);
    ui = play(game, [{ kind: 'continue' }], ui);
    expect(ui.mode.kind).toBe('summary');
    if (ui.mode.kind === 'summary') expect(ui.mode.events).toContainEqual({ kind: 'turn-started', playerId: 'p2', turn: 1 });
    ui = play(game, [{ kind: 'continue' }], ui);
    expect(ui.mode.kind).toBe('idle');
    ui = play(game, [{ kind: 'tap', hex: PATROL }], ui);
    expect(ui.mode).toMatchObject({ kind: 'selected', stackId: 's6' });
    expect(Object.keys(game.view().stacks)).not.toContain('s3'); // dwarf griffins far away stay hidden
  });

  it('continues saved routes when your turn starts, and drops routes with no path', () => {
    const game = new Game(demoGame(), fantasy);
    const far = at(1, 16);
    play(game, [{ kind: 'tap', hex: HOST }, { kind: 'tap', hex: far }, { kind: 'confirm' }]);
    const midway = game.state.stacks.s1!.pos;
    // p1 ends, p2 ends, p1 continues: the host moves on.
    let ui = passTurn(game, passTurn(game));
    expect(game.state.stacks.s1!.pos).not.toEqual(midway);
    expect(ui.message).toMatch(/continued along its route/);
    // A destination that can no longer be reached is cleared.
    game.state = { ...game.state, stacks: { ...game.state.stacks, s1: { ...game.state.stacks.s1!, destination: at(0, 8) } } };
    ui = passTurn(game, passTurn(game, ui));
    expect(game.state.stacks.s1!.destination).toBeUndefined();
  });
});
