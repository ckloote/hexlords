// UI wording from the content pack, so a reskin can rename things without
// code changes. Every modifier source, battle outcome, and stance needs text.

import type { CityTier } from '../engine/map';
import { MODIFIER_SOURCES, type ModifierSource } from '../engine/modifiers';
import type { ContentPack } from '../engine/content';
import type { BattleReport, CaptureChoice, PlayerId, Stance, World } from '../engine/types';

export const OUTCOMES = ['win', 'withdraw', 'destroyed', 'defender-withdraw', 'evaded'] as const;
const STANCES: readonly Stance['kind'][] = ['hold', 'fall-back', 'evade'];
const TIERS: readonly CityTier[] = ['village', 'city', 'capital'];
const CAPTURE: readonly CaptureChoice[] = ['occupy', 'pillage', 'raze'];

export interface Strings {
  modifiers: Record<ModifierSource, string>;
  outcomes: Record<BattleReport['outcome'], string>;
  stances: Record<Stance['kind'], string>;
  tiers: Record<CityTier, string>;
  /** What each capture choice does, shown on the capture card. */
  capture: Record<CaptureChoice, string>;
  /** Short notes for unit tags in build lists; tags without one are not shown. */
  tags: Record<string, string>;
}

export function loadStrings(raw: unknown): Strings {
  const r = raw as Partial<Record<keyof Strings, Record<string, unknown>>>;
  const pick = <K extends string>(group: keyof Strings, keys: readonly K[]): Record<K, string> => {
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const v = r[group]?.[k];
      if (typeof v !== 'string' || !v) throw new Error(`Invalid strings: ${group}.${k} is missing`);
      out[k] = v;
    }
    return out;
  };
  return {
    modifiers: pick('modifiers', MODIFIER_SOURCES),
    outcomes: pick('outcomes', OUTCOMES),
    stances: pick('stances', STANCES),
    tiers: pick('tiers', TIERS),
    capture: pick('capture', CAPTURE),
    tags: Object.fromEntries(Object.entries(r.tags ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')),
  };
}

/** The faction name of a player ("Orc Horde", or "Orcs" when short); "Someone" for an unknown or absent player. */
export function factionName(world: Pick<World, 'players'>, content: ContentPack, playerId: PlayerId | null, short = false): string {
  const faction = content.factions[world.players.find((p) => p.id === playerId)?.factionId ?? ''];
  if (!faction) return 'Someone';
  return short ? faction.shortName : faction.name;
}

/** "+18" or "−4" (with a real minus sign). */
export function signed(n: number): string {
  return `${n < 0 ? '−' : '+'}${Math.abs(n)}`;
}

/** "+25%" or "−25%" (with a real minus sign). */
export function signedPct(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct)}%`;
}

export function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}
