// Game state and commands. Everything here is plain JSON-safe data.

import type { BattleEvent, BattleOutcome } from './battle';
import type { Hex } from './hex';
import type { MapState } from './map';
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
  /** Movement points left this turn (doubled scale: plains cost 2). */
  moveLeft: number;
  /** Retreated since its owner's last turn; starts the next turn with half movement. */
  retreated?: boolean;
}

/** Standing order for a field stack when attacked. */
export type Stance = { kind: 'hold' } | { kind: 'fall-back'; threshold: number } | { kind: 'evade' };

export interface Stack {
  id: string;
  owner: PlayerId;
  pos: Hex;
  unitIds: string[];
  stance: Stance;
  /** Rest of a multi-turn route, for the UI to issue again next turn. */
  route?: Hex[];
}

/** The parts of the state that describe the board; shared by the full state and a player's view. */
export interface World {
  map: MapState;
  players: Player[];
  stacks: Record<string, Stack>;
  units: Record<string, Unit>;
}

export interface GameState extends World {
  version: 1;
  contentId: string;
  seed: number | string;
  rng: RngState;
  turn: number;
  /** Index into `players` of the player whose turn it is. */
  currentPlayer: number;
  /** Hexes each player has ever seen, keyed by hexKey. */
  explored: Record<PlayerId, Record<string, true>>;
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
  | {
      type: 'Move';
      playerId: PlayerId;
      stackId: string;
      /** Hexes to enter in order, not including the start. */
      path: Hex[];
      /** Move only these units, splitting them off; default the whole stack. */
      unitIds?: string[];
    }
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
  /** 'evaded': the defender left before the first duel (no battle events). */
  outcome: BattleOutcome | 'evaded';
  /** Unit indices in these events refer to attackerUnitIds / defenderUnitIds. */
  events: BattleEvent[];
  /** Where a withdrawing or evading defender went. */
  defenderRetreatTo?: Hex;
  /** The attacker moved into the defender's hex. */
  attackerAdvanced: boolean;
}

export interface MoveReport {
  kind: 'moved';
  /** The stack that moved (a new id when units split off). */
  stackId: string;
  from: Hex;
  /** Hexes entered, in order. */
  path: Hex[];
  /** Why the move ended before the end of the requested path. */
  stopped?: 'movement' | 'spotted' | 'blocked';
  /** The friendly stack it joined at the end, if any. */
  mergedInto?: string;
}

export type GameEvent = BattleReport | MoveReport | { kind: 'turn-started'; playerId: PlayerId; turn: number };

export type CommandResult = { state: GameState; events: GameEvent[] } | { error: string };
