// The odds card's content, as plain data: what the Attack mockup shows, built
// from previewAttack on the attacker's view. Rendering is in panels.ts.

import type { AttackPreview } from '../engine/combat';
import type { ContentPack } from '../engine/content';
import { choosePursuer, fightOrder, isCleanBreak, strikesOf } from '../engine/fight';
import { terrainAt } from '../engine/map';
import type { ModifiedFighter } from '../engine/modifiers';
import type { PlayerView } from '../engine/vision';
import { percent, signedPct, type Strings } from './strings';

export interface FighterRow {
  name: string;
  strength: string;
  wounded: boolean;
  commander: boolean;
}

export interface OutcomeSegment {
  kind: 'win' | 'withdraw' | 'destroyed' | 'defender-withdraw';
  p: number;
}

export type OddsCard =
  | { evades: true; title: string; subtitle: string; note: string }
  | {
      evades: false;
      title: string;
      subtitle: string;
      winChance: string;
      /** "chance to win", or "chance to win or drive them off" against a stack that may fall back. */
      winLabel: string;
      segments: OutcomeSegment[];
      youKeep: string;
      theyKeep: string;
      yourLines: { label: string; value: string }[];
      theirLines: { label: string; value: string }[];
      yourOrder: FighterRow[];
      theirOrder: FighterRow[];
      withdrawBelow: string;
      pursuitNote: string;
    };

const fmtStrength = (s: number) => String(Math.round(s * 100) / 100);
const fmtKeep = (n: number, of: number) => `${(Math.round(n * 10) / 10).toFixed(1)} of ${of}`;

export function oddsCard(
  view: PlayerView,
  content: ContentPack,
  strings: Strings,
  attackerId: string,
  targetId: string,
  preview: AttackPreview,
  withdrawBelow: number,
): OddsCard {
  const target = view.stacks[targetId]!;
  const faction = view.players.find((p) => p.id === target.owner)?.factionId ?? '';
  const factionName = content.factions[faction]?.name ?? 'Enemy';
  const site = view.map.sites.find((s) => s.pos.q === target.pos.q && s.pos.r === target.pos.r);
  const title = `Attack ${site ? site.name : `${factionName} stack`}`;
  const n = target.unitIds.length;
  const subtitle = site
    ? `${factionName} ${site.tier} · ${n} defender${n === 1 ? '' : 's'}`
    : `${factionName} · ${n} unit${n === 1 ? '' : 's'}`;

  if (preview.evades) {
    return {
      evades: true,
      title,
      subtitle,
      note: 'They are on Evade, no faster than they need to be, and losing: they will slip away before the first duel. Attacking still ends your move, and you take the hex.',
    };
  }

  const { odds, modifiers } = preview;
  const label = (source: (typeof modifiers.lines)[number]['source']) =>
    source === 'terrain' ? (content.terrain[terrainAt(view.map, target.pos) ?? '']?.name ?? strings.modifiers.terrain) : strings.modifiers[source];
  const lines = (side: 'attacker' | 'defender') =>
    modifiers.lines.filter((l) => l.side === side).map((l) => ({ label: label(l.source), value: signedPct(l.pct) }));

  const rows = (fighters: ModifiedFighter[]): FighterRow[] =>
    fightOrder(fighters).map((k) => {
      const f = fighters[k]!;
      const unit = view.units[f.id]!;
      const type = content.units[unit.typeId]!;
      return { name: type.name, strength: fmtStrength(f.strength), wounded: unit.hits < type.hits, commander: type.tags.includes('commander') };
    });

  const segments: OutcomeSegment[] = [
    { kind: 'win', p: odds.win },
    { kind: 'defender-withdraw', p: odds.defenderWithdraw },
    { kind: 'withdraw', p: odds.withdraw },
    { kind: 'destroyed', p: odds.destroyed },
  ];
  const shown = segments.filter((s) => s.kind !== 'defender-withdraw' || preview.defenderThreshold !== undefined);

  const pursuer = modifiers.defenders[choosePursuer(modifiers.defenders)]!;
  const strikes = strikesOf(pursuer);
  const pursuitNote = isCleanBreak(modifiers.attackers, pursuer)
    ? 'Checked after each duel. Your stack is fast enough to break away cleanly.'
    : `Checked after each duel. Their fastest unit strikes ${strikes === 1 ? 'once' : 'twice'} as you leave.`;

  return {
    evades: false,
    title,
    subtitle,
    winChance: percent(preview.defenderThreshold !== undefined ? odds.win + odds.defenderWithdraw : odds.win),
    winLabel: preview.defenderThreshold !== undefined ? 'chance to win or drive them off' : 'chance to win',
    segments: shown,
    youKeep: fmtKeep(odds.expectedAttackers, modifiers.attackers.length),
    theyKeep: fmtKeep(odds.expectedDefenders, modifiers.defenders.length),
    yourLines: lines('attacker'),
    theirLines: lines('defender'),
    yourOrder: rows(modifiers.attackers),
    theirOrder: rows(modifiers.defenders),
    withdrawBelow: withdrawBelow > 0 ? percent(withdrawBelow) : 'Never',
    pursuitNote,
  };
}
