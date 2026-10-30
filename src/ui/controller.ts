// Owns the game state for the page. Every change goes through applyCommand;
// the UI reads only the current player's view.

import type { ContentPack } from '../engine/content';
import { applyCommand } from '../engine/engine';
import type { Command, GameEvent, GameState } from '../engine/types';
import { type PlayerView, viewFor } from '../engine/vision';
import { type Input, interact, MOVED, settle, type UiState } from './interaction';

export interface RunResult {
  events: GameEvent[];
  error: string | null;
}

export class Game {
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
    const { events, error } = this.run(step.commands);
    return { ui: settle(step.ui, events, error, this.view()), events };
  }
}
