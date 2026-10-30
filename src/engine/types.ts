// Game state and commands. Everything here is plain JSON-safe data.

import type { BattleEvent, BattleOutcome } from './battle';
import type { Hex } from './hex';
import type { CityTier, MapState } from './map';
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
  /** Moved or fought since its owner's last turn start; it heals in the field only if not. */
  acted?: boolean;
}

/** Standing order for a field stack when attacked. */
export type Stance = { kind: 'hold' } | { kind: 'fall-back'; threshold: number } | { kind: 'evade' };

export interface Stack {
  id: string;
  owner: PlayerId;
  pos: Hex;
  unitIds: string[];
  stance: Stance;
  /**
   * Where an unfinished move was headed. The engine never continues it: at the
   * start of the owner's turn the UI plans a fresh path here (or drops it if
   * none exists), since zone of control and new sightings change the best path.
   */
  destination?: Hex;
}

export interface Production {
  unitTypeId: string;
  /** Turns of work done; the unit is ready once this reaches its build time. */
  progress: number;
}

/** A city's play state. Ownership, tier, and secured status are public; production is its owner's. */
export interface CityState {
  /** null for neutral or razed. */
  owner: PlayerId | null;
  tier: CityTier;
  razed: boolean;
  production: Production | null;
  /** Turn at whose start the current owner first held it; null right after a capture. */
  heldSince: number | null;
  /** Held for a full round (start of one owner turn to the next); only secured cities score. */
  secured: boolean;
}

export type CaptureChoice = 'occupy' | 'pillage' | 'raze';

/** A city taken this turn, awaiting Occupy, Pillage, or Raze. */
export interface PendingCapture {
  siteId: string;
  stackId: string;
}

export interface Winner {
  /** null for a draw. */
  playerId: PlayerId | null;
  reason: 'domination' | 'last-standing' | 'turn-limit';
}

/** The parts of the state that describe the board; shared by the full state and a player's view. */
export interface World {
  map: MapState;
  players: Player[];
  /** Play state of each city by site id. Public apart from production: fog hides only units. */
  cities: Record<string, CityState>;
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
  /** Counter for stack ids (s1, s2, ...). */
  nextId: number;
  /** Counter for unit ids (u1, u2, ...). */
  nextUnitId: number;
  /** Treasury per player. */
  gold: Record<PlayerId, number>;
  /** Cities the current player took this turn and has not yet decided on; they must all be resolved before ending the turn. */
  pendingCaptures: PendingCapture[];
  /** Set when the game is over; no command is accepted after that. */
  winner?: Winner;
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
  | {
      type: 'Move';
      playerId: PlayerId;
      stackId: string;
      /** Hexes to enter in order, not including the start. */
      path: Hex[];
      /** Move only these units, splitting them off; default the whole stack. */
      unitIds?: string[];
    }
  /** Forget a saved destination (the UI drops routes it can no longer plan). */
  | { type: 'ClearDestination'; playerId: PlayerId; stackId: string }
  /** Start building a unit type in a city (null stops production). Changing type loses progress. */
  | { type: 'SetProduction'; playerId: PlayerId; siteId: string; unitTypeId: string | null }
  /** Decide what to do with the city just captured. */
  | { type: 'ResolveCapture'; playerId: PlayerId; siteId: string; choice: CaptureChoice }
  // Later milestones.
  | { type: 'Explore'; playerId: PlayerId; stackId: string };

export interface BattleReport {
  kind: 'battle';
  attackerOwner: PlayerId;
  defenderOwner: PlayerId;
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

/** Events of the economy and the turn cycle. */
export type TurnEvent =
  | { kind: 'turn-started'; playerId: PlayerId; turn: number }
  | { kind: 'captured'; playerId: PlayerId; siteId: string; from: PlayerId | null; stackId: string }
  | { kind: 'capture-resolved'; playerId: PlayerId; siteId: string; choice: CaptureChoice; gold: number }
  | { kind: 'income'; playerId: PlayerId; income: number; upkeep: number; gold: number }
  | { kind: 'unit-built'; playerId: PlayerId; siteId: string; unitId: string; unitTypeId: string; cost: number }
  | { kind: 'production-waiting'; playerId: PlayerId; siteId: string; unitTypeId: string; reason: 'gold' | 'full' }
  | { kind: 'deserted'; playerId: PlayerId; unitId: string; unitTypeId: string }
  | { kind: 'healed'; playerId: PlayerId; hits: number }
  | { kind: 'secured'; playerId: PlayerId; siteId: string }
  | { kind: 'eliminated'; playerId: PlayerId }
  | { kind: 'game-over'; winner: Winner };

export type GameEvent = BattleReport | MoveReport | TurnEvent;

export type CommandResult = { state: GameState; events: GameEvent[] } | { error: string };
