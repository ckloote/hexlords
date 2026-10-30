// Game state and commands. Everything here is plain JSON-safe data.

import type { BattleEvent, BattleOutcome } from './battle';
import type { Hex } from './hex';
import type { ModifierLine } from './modifiers';
import type { RngState } from './rng';

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  factionId: string;
  eliminated: boolean;
}

export interface Unit {
  id: string;
  typeId: string;
  /** Remaining hits; damage persists between battles. */
  hits: number;
}

/** Standing order for a field stack when attacked. */
export type Stance = { kind: 'hold' } | { kind: 'fall-back'; threshold: number } | { kind: 'evade' };

export interface Stack {
  id: string;
  owner: PlayerId;
  pos: Hex;
  unitIds: string[];
  stance: Stance;
}

export interface GameState {
  version: 1;
  contentId: string;
  seed: number | string;
  rng: RngState;
  turn: number;
  /** Index into `players` of the player whose turn it is. */
  currentPlayer: number;
  players: Player[];
  stacks: Record<string, Stack>;
  units: Record<string, Unit>;
  nextId: number;
}

export type Command =
  | { type: 'EndTurn'; playerId: PlayerId }
  | { type: 'SetStance'; playerId: PlayerId; stackId: string; stance: Stance }
  | {
      type: 'Attack';
      playerId: PlayerId;
      stackId: string;
      targetStackId: string;
      /** Withdraw if the win chance drops below this (0..1). Omit to hold. */
      withdrawBelow?: number;
    }
  // Later milestones.
  | { type: 'Move'; playerId: PlayerId; stackId: string; path: Hex[] }
  | { type: 'Split'; playerId: PlayerId; stackId: string; unitIds: string[] }
  | { type: 'Merge'; playerId: PlayerId; stackId: string; intoStackId: string }
  | { type: 'SetProduction'; playerId: PlayerId; siteId: string; unitTypeId: string | null }
  | { type: 'Explore'; playerId: PlayerId; stackId: string };

export interface BattleReport {
  kind: 'battle';
  attackerStackId: string;
  defenderStackId: string;
  attackerUnitIds: string[];
  defenderUnitIds: string[];
  modifiers: ModifierLine[];
  outcome: BattleOutcome;
  /** Unit indices in these events refer to attackerUnitIds / defenderUnitIds. */
  events: BattleEvent[];
}

export type GameEvent = BattleReport | { kind: 'turn-started'; playerId: PlayerId; turn: number };

export type CommandResult = { state: GameState; events: GameEvent[] } | { error: string };
