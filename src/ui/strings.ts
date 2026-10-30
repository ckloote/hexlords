// UI wording from the content pack, so a reskin can rename things without
// code changes. Every modifier source, battle outcome, and stance needs text.

import { MODIFIER_SOURCES, type ModifierSource } from '../engine/modifiers';
import type { BattleReport, Stance } from '../engine/types';

export const OUTCOMES = ['win', 'withdraw', 'destroyed', 'defender-withdraw', 'evaded'] as const;
const STANCES: readonly Stance['kind'][] = ['hold', 'fall-back', 'evade'];

export interface Strings {
  modifiers: Record<ModifierSource, string>;
  outcomes: Record<BattleReport['outcome'], string>;
  stances: Record<Stance['kind'], string>;
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
  };
}

/** "+25%" or "−25%" (with a real minus sign). */
export function signedPct(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${Math.abs(pct)}%`;
}

export function percent(p: number): string {
  return `${Math.round(p * 100)}%`;
}
