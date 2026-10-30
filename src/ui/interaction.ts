// What taps and buttons mean. A pure reducer: (view, UI state, input) → new UI
// state plus the commands to send to the engine. It reads only the current
// player's view, like the AI. The controller runs the commands, then settle()
// turns their results into the next UI state.

import type { ContentPack } from '../engine/content';
import { type Hex, parseHexKey, sameHex } from '../engine/hex';
import { siteAt } from '../engine/map';
import { findPath, movesLeft, type PathStep, pathTo, reachable } from '../engine/movement';
import type { BattleReport, CaptureChoice, Command, GameEvent, PlayerId, Stack, Stance } from '../engine/types';
import type { PlayerView } from '../engine/vision';

/** Stands for "the stack the previous Move produced" in a queued Attack. */
export const MOVED = '$moved';
export const DEFAULT_WITHDRAW = 0.3;
export const DEFAULT_FALL_BACK = 0.3;
const STEP = 0.05;

export type Mode =
  | { kind: 'idle' }
  /** `split`: units picked to split off; empty means the whole stack. */
  | { kind: 'selected'; stackId: string; split: string[] }
  | { kind: 'move'; stackId: string; split: string[]; goal: Hex; steps: PathStep[] }
  /** `path`: this turn's steps to the hex the attack starts from; empty when adjacent. */
  | { kind: 'attack'; stackId: string; split: string[]; targetId: string; path: Hex[]; withdrawBelow: number }
  /** `lostCities`: the viewer's cities a defender fell back into and took during this battle. */
  | { kind: 'result'; report: BattleReport; lostCities: string[] }
  /** The city panel. */
  | { kind: 'city'; siteId: string }
  /** The player just took a city and must choose its fate. */
  | { kind: 'capture'; siteId: string }
  | { kind: 'handoff'; playerId: PlayerId }
  /** The turn summary; the controller fills in what happened since the player's last turn. */
  | { kind: 'summary'; events: GameEvent[] };

export interface UiState {
  mode: Mode;
  /** A short toast for the player, or null. */
  message: string | null;
  /** End turn was tapped once and warned about idle cities; a second tap ends the turn. */
  endWarned?: boolean;
}

export type Input =
  | { kind: 'tap'; hex: Hex }
  | { kind: 'cancel' }
  | { kind: 'confirm' }
  | { kind: 'toggleUnit'; unitId: string }
  | { kind: 'clearSplit' }
  | { kind: 'stance'; stance: Stance['kind'] }
  | { kind: 'stanceThreshold'; delta: number }
  | { kind: 'withdraw'; delta: number }
  | { kind: 'nextStack' }
  | { kind: 'endTurn' }
  | { kind: 'continue' }
  | { kind: 'openCity'; siteId: string }
  | { kind: 'build'; unitTypeId: string | null }
  | { kind: 'capture'; choice: CaptureChoice };

export interface Step {
  ui: UiState;
  commands: Command[];
}

export const initialUi: UiState = { mode: { kind: 'idle' }, message: null };

const ui = (mode: Mode, message: string | null = null): UiState => ({ mode, message });
const round = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, round(x)));

function stackAt(view: PlayerView, hex: Hex): Stack | undefined {
  return Object.values(view.stacks).find((s) => sameHex(s.pos, hex));
}

function describeEnemy(view: PlayerView, content: ContentPack, stack: Stack): string {
  const names = stack.unitIds.map((id) => content.units[view.units[id]!.typeId]!.name);
  const stance =
    stack.stance.kind === 'hold' ? 'Hold' : stack.stance.kind === 'evade' ? 'Evade' : `Fall back below ${Math.round(stack.stance.threshold * 100)}%`;
  return `Enemy: ${names.join(', ')} · ${stance}`;
}

const unitIdsOf = (split: string[]) => (split.length ? split : undefined);

function previewMove(view: PlayerView, content: ContentPack, stackId: string, split: string[], goal: Hex): UiState | null {
  const steps = findPath(view, content, stackId, goal, { unitIds: unitIdsOf(split), visible: new Set(view.visible) });
  return steps && steps.length ? ui({ kind: 'move', stackId, split, goal, steps }) : null;
}

function previewAttack(view: PlayerView, content: ContentPack, stackId: string, split: string[], target: Stack): UiState {
  const visible = new Set(view.visible);
  const reach = reachable(view, content, stackId, { unitIds: unitIdsOf(split), visible });
  const option = reach.attacks[target.id];
  if (option) {
    const path = pathTo(reach, parseHexKey(option.from)) ?? [];
    // A split can only attack after moving: one stack per hex.
    return ui({ kind: 'attack', stackId, split: path.length ? split : [], targetId: target.id, path, withdrawBelow: DEFAULT_WITHDRAW });
  }
  // Out of reach this turn: head for the hex before it.
  const route = findPath(view, content, stackId, target.pos, { unitIds: unitIdsOf(split), visible });
  if (route && route.length > 1) {
    const steps = route.slice(0, -1);
    return ui({ kind: 'move', stackId, split, goal: steps[steps.length - 1]!.hex, steps }, 'Out of reach this turn: showing a route toward it.');
  }
  return ui({ kind: 'selected', stackId, split }, 'No route to that stack.');
}

function select(stackId: string): UiState {
  return ui({ kind: 'selected', stackId, split: [] });
}


/** Moves that continue saved routes at the start of a turn; routes with no path are dropped. */
export function continueRoutes(view: PlayerView, content: ContentPack): Command[] {
  const commands: Command[] = [];
  const visible = new Set(view.visible);
  for (const stack of Object.values(view.stacks)) {
    if (stack.owner !== view.viewer || !stack.destination) continue;
    const steps = findPath(view, content, stack.id, stack.destination, { visible });
    commands.push(
      steps && steps.length
        ? { type: 'Move', playerId: view.viewer, stackId: stack.id, path: steps.map((s) => s.hex) }
        : { type: 'ClearDestination', playerId: view.viewer, stackId: stack.id },
    );
  }
  return commands;
}

function onTap(view: PlayerView, content: ContentPack, state: UiState, hex: Hex): Step {
  const mode = state.mode;
  const stack = stackAt(view, hex);
  const mine = stack?.owner === view.viewer;
  const none = (u: UiState): Step => ({ ui: u, commands: [] });

  if (mode.kind !== 'selected' && mode.kind !== 'move' && mode.kind !== 'attack') {
    if (stack && mine) return none(select(stack.id));
    if (stack) return none(ui({ kind: 'idle' }, describeEnemy(view, content, stack)));
    const site = siteAt(view.map, hex);
    if (site) return none(ui({ kind: 'city', siteId: site.id }));
    return none(ui({ kind: 'idle' }));
  }

  const { stackId, split } = mode;
  if (stack?.id === stackId) {
    // Tapping the selected stack backs out of a preview, or deselects.
    return none(mode.kind === 'selected' ? ui({ kind: 'idle' }) : ui({ kind: 'selected', stackId, split }));
  }
  if (mode.kind === 'move' && sameHex(mode.goal, hex)) return confirm(view, state);
  if (stack && !mine) {
    if (mode.kind === 'attack' && mode.targetId === stack.id) return confirm(view, state);
    return none(previewAttack(view, content, stackId, split, stack));
  }
  // An empty hex, or a friendly stack to join; if it cannot be reached, a friendly stack is selected instead.
  const preview = previewMove(view, content, stackId, split, hex);
  if (preview) return none(preview);
  if (stack && mine) return none(select(stack.id));
  return none(ui({ kind: 'selected', stackId, split }, 'No route there.'));
}

function confirm(view: PlayerView, state: UiState): Step {
  const mode = state.mode;
  const playerId = view.viewer;
  if (mode.kind === 'move') {
    const command: Command = { type: 'Move', playerId, stackId: mode.stackId, path: mode.steps.map((s) => s.hex) };
    if (mode.split.length) command.unitIds = [...mode.split];
    return { ui: state, commands: [command] };
  }
  if (mode.kind === 'attack') {
    const commands: Command[] = [];
    let attacker = mode.stackId;
    if (mode.path.length) {
      const move: Command = { type: 'Move', playerId, stackId: mode.stackId, path: mode.path };
      if (mode.split.length) move.unitIds = [...mode.split];
      commands.push(move);
      attacker = MOVED;
    }
    const attack: Command = { type: 'Attack', playerId, stackId: attacker, targetStackId: mode.targetId };
    if (mode.withdrawBelow > 0) attack.withdrawBelow = mode.withdrawBelow;
    commands.push(attack);
    return { ui: state, commands };
  }
  return { ui: state, commands: [] };
}

/** Owned cities with something to build and nothing in production. */
export function idleCities(view: PlayerView): string[] {
  return view.map.sites
    .filter((s) => {
      const c = view.cities[s.id]!;
      return c.owner === view.viewer && !c.razed && !c.production && s.builds.length > 0;
    })
    .map((s) => s.name);
}

export function interact(view: PlayerView, content: ContentPack, state: UiState, input: Input): Step {
  const step = react(view, content, state, input);
  // The idle-city warning holds only until the next input.
  if (input.kind !== 'endTurn' && step.ui.endWarned) {
    step.ui = { ...step.ui };
    delete step.ui.endWarned;
  }
  return step;
}

function react(view: PlayerView, content: ContentPack, state: UiState, input: Input): Step {
  const mode = state.mode;
  const none = (u: UiState): Step => ({ ui: u, commands: [] });
  if (view.winner) return none(state);
  if (mode.kind === 'handoff') return none(input.kind === 'continue' ? ui({ kind: 'summary', events: [] }) : state);
  if (mode.kind === 'summary') {
    return input.kind === 'continue' ? { ui: ui({ kind: 'idle' }), commands: continueRoutes(view, content) } : none(state);
  }
  const pending = view.pendingCaptures;
  // The capture card is modal: the city's fate comes first.
  if (mode.kind === 'capture' && pending.includes(mode.siteId)) {
    if (input.kind !== 'capture') return none(state);
    return { ui: state, commands: [{ type: 'ResolveCapture', playerId: view.viewer, siteId: mode.siteId, choice: input.choice }] };
  }
  switch (input.kind) {
    case 'tap':
      return onTap(view, content, state, input.hex);
    case 'confirm':
      return confirm(view, state);
    case 'cancel':
      if (mode.kind === 'move' || mode.kind === 'attack') return none(ui({ kind: 'selected', stackId: mode.stackId, split: mode.split }));
      return none(ui({ kind: 'idle' }));
    case 'continue':
      if (mode.kind === 'result') {
        if (pending.length) return none(ui({ kind: 'capture', siteId: pending[0]! }));
        const id = mode.report.attackerStackId;
        return none(view.stacks[id] ? select(id) : ui({ kind: 'idle' }));
      }
      return none(state);
    case 'toggleUnit': {
      if (mode.kind !== 'selected' && mode.kind !== 'move' && mode.kind !== 'attack') return none(state);
      const all = view.stacks[mode.stackId]!.unitIds;
      let split = mode.split.includes(input.unitId) ? mode.split.filter((id) => id !== input.unitId) : [...mode.split, input.unitId];
      if (split.length === all.length) split = [];
      split = all.filter((id) => split.includes(id)); // keep fight-panel order stable
      return none(ui({ kind: 'selected', stackId: mode.stackId, split }));
    }
    case 'clearSplit':
      return none(mode.kind === 'selected' ? ui({ ...mode, split: [] }) : state);
    case 'stance': {
      if (mode.kind !== 'selected') return none(state);
      const stance: Stance =
        input.stance === 'fall-back' ? { kind: 'fall-back', threshold: DEFAULT_FALL_BACK } : { kind: input.stance };
      return { ui: state, commands: [{ type: 'SetStance', playerId: view.viewer, stackId: mode.stackId, stance }] };
    }
    case 'stanceThreshold': {
      if (mode.kind !== 'selected') return none(state);
      const current = view.stacks[mode.stackId]!.stance;
      if (current.kind !== 'fall-back') return none(state);
      const threshold = clamp(current.threshold + input.delta * STEP, STEP, 0.95);
      return { ui: state, commands: [{ type: 'SetStance', playerId: view.viewer, stackId: mode.stackId, stance: { kind: 'fall-back', threshold } }] };
    }
    case 'withdraw':
      if (mode.kind !== 'attack') return none(state);
      return none(ui({ ...mode, withdrawBelow: clamp(mode.withdrawBelow + input.delta * STEP, 0, 0.95) }));
    case 'nextStack': {
      const ready = Object.values(view.stacks)
        .filter((s) => s.owner === view.viewer && movesLeft(view, s.unitIds) > 0)
        .map((s) => s.id)
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b));
      if (ready.length === 0) return none(ui({ kind: 'idle' }, 'Every stack has moved. End the turn when ready.'));
      const current = 'stackId' in mode ? mode.stackId : null;
      const after = ready.find((id) => current === null || Number(id.slice(1)) > Number(current.slice(1)));
      return none(select(after ?? ready[0]!));
    }
    case 'openCity':
      return none(view.cities[input.siteId] ? ui({ kind: 'city', siteId: input.siteId }) : state);
    case 'build':
      if (mode.kind !== 'city') return none(state);
      return { ui: state, commands: [{ type: 'SetProduction', playerId: view.viewer, siteId: mode.siteId, unitTypeId: input.unitTypeId }] };
    case 'capture':
      return none(state);
    case 'endTurn': {
      if (pending.length) {
        return none(ui({ kind: 'capture', siteId: pending[0]! }, 'Decide what to do with the cities you took before ending the turn.'));
      }
      const idle = idleCities(view);
      if (idle.length && !state.endWarned) {
        const list = idle.length === 1 ? `${idle[0]} has` : `${idle.slice(0, -1).join(', ')} and ${idle[idle.length - 1]} have`;
        return none({ mode, message: `${list} nothing in production. Tap End turn again to end anyway.`, endWarned: true });
      }
      // settle() names the player whose turn it is once EndTurn has run (it may skip an eliminated one).
      return { ui: ui({ kind: 'handoff', playerId: view.viewer }), commands: [{ type: 'EndTurn', playerId: view.viewer }] };
    }
  }
}

/** The UI state after the engine ran a step's commands. */
export function settle(step: UiState, events: GameEvent[], error: string | null, view: PlayerView): UiState {
  const mode = step.mode;
  if (mode.kind === 'handoff') {
    if (error) return ui({ kind: 'idle' }, error);
    // A game that just ended shows the game-over card; nobody needs the device passed.
    if (view.winner) return ui({ kind: 'idle' });
    return ui({ kind: 'handoff', playerId: view.viewer });
  }
  if (mode.kind === 'summary') return step;
  const battle = events.find((e): e is BattleReport => e.kind === 'battle');
  // The battle result shows first; Continue then opens any capture card.
  if (battle) {
    const lostCities = events.flatMap((e) => (e.kind === 'captured' && e.from === view.viewer ? [e.siteId] : []));
    return ui({ kind: 'result', report: battle, lostCities }, error);
  }
  const nextCapture = view.pendingCaptures[0];
  const moves = events.filter((e) => e.kind === 'moved');
  const routesNote =
    mode.kind === 'idle' && moves.length
      ? `${moves.length} stack${moves.length === 1 ? '' : 's'} continued along ${moves.length === 1 ? 'its route' : 'their routes'}.`
      : null;
  const resolved = events.find((e) => e.kind === 'capture-resolved');
  if (resolved && resolved.kind === 'capture-resolved') {
    const site = view.map.sites.find((s) => s.id === resolved.siteId)!;
    const note =
      resolved.choice === 'occupy' ? `${site.name} is yours.`
      : resolved.choice === 'raze' || view.cities[site.id]!.razed ? `${site.name} lies in ruins${resolved.gold ? `; you took ${resolved.gold} gold` : ''}.`
      : `You pillaged ${site.name} for ${resolved.gold} gold.`;
    if (nextCapture) return ui({ kind: 'capture', siteId: nextCapture }, note);
    const there = Object.values(view.stacks).find((s) => s.owner === view.viewer && sameHex(s.pos, site.pos));
    return there ? ui({ kind: 'selected', stackId: there.id, split: [] }, note) : ui({ kind: 'idle' }, note);
  }
  if (nextCapture) return ui({ kind: 'capture', siteId: nextCapture }, error ?? routesNote);
  // A rejected build or capture choice keeps its panel open, with the reason.
  if (error && (mode.kind === 'city' || mode.kind === 'capture')) return ui(mode, error);
  if (error) {
    const stackId = 'stackId' in mode ? mode.stackId : null;
    const moved = [...events].reverse().find((e) => e.kind === 'moved');
    const id = moved && moved.kind === 'moved' ? (moved.mergedInto ?? moved.stackId) : stackId;
    return id && view.stacks[id] ? ui({ kind: 'selected', stackId: id, split: [] }, error) : ui({ kind: 'idle' }, error);
  }
  if (routesNote) return ui({ kind: 'idle' }, routesNote);
  const last = moves[moves.length - 1];
  if (last && last.kind === 'moved') {
    const id = last.mergedInto ?? last.stackId;
    const note =
      last.stopped === 'spotted'
        ? 'Stopped: an enemy stack came into view.'
        : last.stopped === 'movement'
          ? 'Out of movement: the route continues next turn.'
          : last.mergedInto
            ? 'Joined the stack.'
            : null;
    return ui({ kind: 'selected', stackId: id, split: [] }, note);
  }
  return step;
}

