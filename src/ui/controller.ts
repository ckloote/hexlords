// Owns the game state for the page. Every change goes through applyCommand;
// the UI reads only the current player's view.

import type { ContentPack } from '../engine/content';
import { applyCommand } from '../engine/engine';
import type { Command, GameEvent, GameState } from '../engine/types';
import { type PlayerView, viewFor } from '../engine/vision';
import { type Input, interact, MOVED, settle, type UiState } from './interaction';
import { summaryEventFor } from './summary';

export interface RunResult {
  events: GameEvent[];
  error: string | null;
}

export class Game {
  /** Per player: events from other players' turns and their own turn start, kept for the turn summary. */
  private inbox: Record<string, GameEvent[]> = {};

  constructor(
    public state: GameState,
    readonly content: ContentPack,
  ) {}

  get playerId(): string {
    return this.state.players[this.state.currentPlayer]!.id;
  }

  view(): PlayerView {
    return viewFor(this.state, this.content, this.playerId);
  }

  /** Runs commands in order, stopping at the first error. */
  run(commands: readonly Command[]): RunResult {
    const events: GameEvent[] = [];
    let moved: { id: string; stopped: boolean } | null = null;
    for (const raw of commands) {
      let command = raw;
      if (command.type === 'Attack' && command.stackId === MOVED) {
        if (!moved || moved.stopped) return { events, error: 'Attack cancelled: the move stopped short of the target.' };
        command = { ...command, stackId: moved.id };
      }
      const result = applyCommand(this.state, command, this.content);
      if ('error' in result) return { events, error: result.error };
      this.state = result.state;
      events.push(...result.events);
      for (const e of result.events) {
        if (e.kind === 'moved') moved = { id: e.mergedInto ?? e.stackId, stopped: e.stopped !== undefined };
      }
    }
    return { events, error: null };
  }

  /** One player input: interpret it, run the commands, and return the next UI state. */
  handle(ui: UiState, input: Input): { ui: UiState; events: GameEvent[] } {
    const step = interact(this.view(), this.content, ui, input);
    const actor = this.playerId;
    const { events, error } = this.run(step.commands);
    for (const p of this.state.players) {
      if (p.eliminated) {
        delete this.inbox[p.id];
        continue;
      }
      if (p.id === actor) continue;
      const inbox = (this.inbox[p.id] ??= []);
      for (const e of events) if (summaryEventFor(e, p.id)) inbox.push(e);
    }
    let next = settle(step.ui, events, error, this.view());
    if (next.mode.kind === 'summary' && next.mode.events.length === 0) {
      next = { ...next, mode: { kind: 'summary', events: this.inbox[this.playerId] ?? [] } };
      this.inbox[this.playerId] = [];
    }
    return { ui: next, events };
  }
}
