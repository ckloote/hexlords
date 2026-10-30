// The turn summary ("while you were away"): what happened to the viewer since
// their last turn, built from the engine's events. The controller passes only
// the events summaryEventFor keeps: from other players' turns and the
// viewer's own turn start.

import type { ContentPack } from '../engine/content';
import { cityIncome } from '../engine/economy';
import type { BattleReport, GameEvent, PlayerId, TurnEvent } from '../engine/types';
import type { PlayerView } from '../engine/vision';
import { countNames } from './cityCard';
import { leaderLine, type Scoreboard, scoreboard } from './scoreboard';
import { signed, type Strings } from './strings';

export interface SummaryItem {
  tone: 'good' | 'danger' | 'neutral';
  title: string;
  detail: string;
}

export interface Summary {
  turn: number;
  board: Scoreboard;
  /** "Income 45 − upkeep 27 = +18 gold · treasury 212". */
  economy: string;
  items: SummaryItem[];
  leader: string;
  /** Shown when one player holds more than half the income. */
  lastStand: string | null;
}

type Of<K extends TurnEvent['kind']> = Extract<TurnEvent, { kind: K }>;

/**
 * Whether `event` belongs in `playerId`'s next turn summary, given the events
 * already kept for them: battles they fought, cities taken from or by them
 * (and what was done with those), their own turn-start events, eliminations,
 * and the end of the game.
 */
export function summaryEventFor(event: GameEvent, playerId: PlayerId, kept: readonly GameEvent[]): boolean {
  switch (event.kind) {
    case 'moved':
      return false;
    case 'battle':
      return event.attackerOwner === playerId || event.defenderOwner === playerId;
    case 'captured':
      return event.playerId === playerId || event.from === playerId;
    case 'capture-resolved':
      return kept.some((e) => e.kind === 'captured' && e.siteId === event.siteId);
    case 'eliminated':
    case 'game-over':
      return true;
    default:
      return event.playerId === playerId;
  }
}

/** Units each side lost in a battle, pursuit included. */
export function battleLosses(report: BattleReport): { attacker: number; defender: number } {
  const lost = { attacker: 0, defender: 0 };
  for (const e of report.events) {
    if (e.kind === 'death') lost[e.side]++;
    if (e.kind === 'pursuit' && !e.cleanBreak && e.killed) lost[e.side]++;
  }
  return lost;
}

export function buildSummary(view: PlayerView, content: ContentPack, strings: Strings, events: readonly GameEvent[]): Summary {
  const me = view.viewer;
  const board = scoreboard(view, content);
  const factionName = (playerId: string | null) => {
    const p = view.players.find((x) => x.id === playerId);
    return p ? content.factions[p.factionId]!.name : 'Someone';
  };
  const siteName = (id: string) => view.map.sites.find((s) => s.id === id)?.name ?? id;
  const items: SummaryItem[] = [];
  const of = <K extends TurnEvent['kind']>(kind: K) => events.filter((e): e is Of<K> => e.kind === kind);

  for (const e of events) {
    if (e.kind !== 'battle' || e.defenderOwner !== me) continue;
    const lost = battleLosses(e);
    const result =
      e.outcome === 'win' ? 'Your stack was destroyed.'
      : e.outcome === 'defender-withdraw' ? 'Your stack fell back.'
      : e.outcome === 'evaded' ? 'Your stack slipped away before the fight.'
      : e.outcome === 'withdraw' ? 'They withdrew.'
      : 'Your stack held.';
    const tally = e.outcome === 'evaded' ? '' : ` You lost ${lost.defender}; they lost ${lost.attacker}.`;
    const good = e.outcome === 'withdraw' || e.outcome === 'destroyed' || e.outcome === 'evaded';
    items.push({ tone: good ? 'good' : 'danger', title: `The ${factionName(e.attackerOwner)} attacked you`, detail: `${result}${tally}` });
  }

  const resolved = of('capture-resolved');
  for (const e of of('captured')) {
    const fate = resolved.find((r) => r.siteId === e.siteId)?.choice;
    const city = view.cities[e.siteId]!;
    if (e.from === me) {
      const detail =
        fate === 'raze' || city.razed ? 'They razed it.'
        : fate === 'pillage' ? `They pillaged it; it is now a ${strings.tiers[city.tier].toLowerCase()}.`
        : `${strings.tiers[city.tier]} lost · income −${cityIncome(city.tier)} a turn`;
      items.push({ tone: 'danger', title: `The ${factionName(e.playerId)} took ${siteName(e.siteId)}`, detail });
    } else if (e.playerId === me) {
      items.push({ tone: 'good', title: `You took ${siteName(e.siteId)}`, detail: 'Your stack fell back into the empty city and holds it.' });
    }
  }

  const built = of('unit-built').filter((e) => e.playerId === me);
  if (built.length) {
    const names = built.map((e) => `${content.units[e.unitTypeId]!.name} at ${siteName(e.siteId)}`);
    items.push({ tone: 'good', title: built.length === 1 ? 'New unit ready' : 'New units ready', detail: names.join(' · ') });
  }
  for (const e of of('production-waiting').filter((x) => x.playerId === me)) {
    const why = e.reason === 'gold' ? 'not enough gold' : 'the stack in the city is full';
    items.push({ tone: 'danger', title: `${siteName(e.siteId)} is waiting`, detail: `${content.units[e.unitTypeId]!.name} is ready, but ${why}.` });
  }
  const deserted = of('deserted').filter((e) => e.playerId === me);
  if (deserted.length) {
    items.push({
      tone: 'danger',
      title: 'Units deserted',
      detail: `${countNames(deserted.map((e) => content.units[e.unitTypeId]!.name))} left: the treasury could not pay upkeep.`,
    });
  }
  for (const e of of('secured').filter((x) => x.playerId === me)) {
    items.push({ tone: 'good', title: `${siteName(e.siteId)} is secured`, detail: 'It now counts toward victory.' });
  }
  const healed = of('healed').filter((e) => e.playerId === me).reduce((n, e) => n + e.hits, 0);
  if (healed) items.push({ tone: 'neutral', title: 'Wounds healed', detail: `${healed} hit${healed === 1 ? '' : 's'} recovered.` });
  for (const e of of('eliminated')) {
    items.push(
      e.playerId === me
        ? { tone: 'danger', title: 'You have been eliminated', detail: 'You hold no city.' }
        : { tone: 'neutral', title: `${factionName(e.playerId)} eliminated`, detail: 'They hold no city, and their army has disbanded.' },
    );
  }

  const income = of('income').find((e) => e.playerId === me);
  const net = board.income - board.upkeep;
  const economy = income
    ? `Income ${income.income} − upkeep ${income.upkeep} = ${signed(income.income - income.upkeep)} gold · treasury ${view.gold}`
    : `Income ${board.income} − upkeep ${board.upkeep} = ${signed(net)} gold a turn · treasury ${view.gold}`;

  const leader = `${leaderLine(board, view, content)} Domination needs ${board.target} secured.`;
  const lastStand =
    board.lastStand === null ? null
    : board.lastStand === me ? 'You hold more than half of all income. Everyone will come for you: hold out until it is secured.'
    : `Last stand: over half of all income belongs to the ${factionName(board.lastStand)}. Stop them before it is secured.`;
  return { turn: view.turn, board, economy, items, leader, lastStand };
}
