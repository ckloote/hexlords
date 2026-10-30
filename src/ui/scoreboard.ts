// The top bar's numbers: treasury, net income after upkeep, the turn out of
// the limit, and each player's secured score against the domination target.
// Everything here is public or the viewer's own, so it reads only the view.

import type { ContentPack } from '../engine/content';
import { dominationTarget, incomeOf, lastStandPlayer, securedScore, totalIncome, upkeepOf } from '../engine/economy';
import type { PlayerId } from '../engine/types';
import type { PlayerView } from '../engine/vision';
import { signed } from './strings';

export interface ScoreEntry {
  playerId: PlayerId;
  factionId: string;
  /** "You" for the viewer, the faction's short name otherwise. */
  label: string;
  score: number;
  /** Share of the map's total income held secured (0..1). */
  share: number;
  eliminated: boolean;
}

export interface Scoreboard {
  gold: number;
  income: number;
  upkeep: number;
  /** income − upkeep. */
  net: number;
  turn: number;
  turnLimit: number;
  total: number;
  /** Secured score that wins by domination. */
  target: number;
  /** Domination share, for the marker on the score bar (0..1). */
  targetShare: number;
  scores: ScoreEntry[];
  /** The player above half the current income, if any. */
  lastStand: PlayerId | null;
}

export function scoreboard(view: PlayerView, content: ContentPack): Scoreboard {
  const total = totalIncome(view);
  const income = incomeOf(view, view.viewer);
  const upkeep = upkeepOf(view, content, view.viewer);
  return {
    gold: view.gold,
    income,
    upkeep,
    net: income - upkeep,
    turn: view.turn,
    turnLimit: view.map.victory.turnLimit,
    total,
    target: dominationTarget(view),
    targetShare: view.map.victory.domination,
    scores: view.players.map((p) => {
      const score = securedScore(view, p.id);
      return {
        playerId: p.id,
        factionId: p.factionId,
        label: p.id === view.viewer ? 'You' : content.factions[p.factionId]!.shortName,
        score,
        share: total > 0 ? score / total : 0,
        eliminated: p.eliminated,
      };
    }),
    lastStand: lastStandPlayer(view),
  };
}

/** "+18 per turn" or "−4 per turn". */
export function netLabel(net: number): string {
  return `${signed(net)} per turn`;
}

/** "You 45 · Orcs 60". */
export function scoreLine(board: Scoreboard): string {
  return board.scores.filter((s) => !s.eliminated).map((s) => `${s.label} ${s.score}`).join(' · ');
}

/** Who leads on secured score, and where the viewer stands: "Leading: the Orc Horde with 60. You are second with 45." */
export function leaderLine(board: Scoreboard, view: PlayerView, content: ContentPack): string {
  const ranked = board.scores.filter((s) => !s.eliminated).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return '';
  const tied = ranked.filter((s) => s.score === top.score);
  const nameOf = (s: ScoreEntry) => content.factions[s.factionId]!.name;
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const mine = ranked.find((s) => s.playerId === view.viewer);
  if (tied.length > 1) {
    const meTied = tied.some((s) => s.playerId === view.viewer);
    return meTied ? `You share the lead with ${top.score}.` : `Tied for the lead at ${top.score}: the ${tied.map(nameOf).join(' and the ')}.`;
  }
  if (top.playerId === view.viewer) return `You lead with ${top.score}.`;
  let where = '';
  if (mine) {
    // Placed by how many score more, so equal scores share a place.
    const place = ranked.filter((s) => s.score > mine.score).length;
    const tiedWith = ranked.some((s) => s.score === mine.score && s.playerId !== mine.playerId);
    where = ` You are ${tiedWith ? 'tied for ' : ''}${ordinal[place] ?? `number ${place + 1}`} with ${mine.score}.`;
  }
  return `Leading: the ${nameOf(top)} with ${top.score}.${where}`;
}
