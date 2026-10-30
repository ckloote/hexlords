// Content packs hold every name and stat. The engine only knows generic tags
// (see TAGS), so a reskin is a new pack with no engine changes.

import { RULES } from './rules';

export const TAGS = {
  /** A commander: hired rather than built (milestone 6). */
  commander: 'commander',
  /** Grants leadership to its whole stack. */
  leadsStack: 'leads-stack',
  /** Its stack cuts the enemy city defense bonus. */
  siege: 'siege',
  /** Bonus when defending. */
  defenseBonus: 'defense-bonus',
  flying: 'flying',
  regenerates: 'regenerates',
  mounted: 'mounted',
} as const;

export interface UnitType {
  id: string;
  name: string;
  strength: number;
  hits: number;
  move: number;
  /** Gold cost; absent for units that are never built (commanders, allies) or not yet priced. */
  cost?: number;
  buildTurns?: number;
  /** Gold per turn; see upkeepFor. Absent for units that pay none (commanders). */
  upkeep?: number;
  /** Strikes when pursuing a withdrawing stack; default 1. */
  pursuitStrikes?: number;
  tags: string[];
}

/** Upkeep rule from DESIGN.md: 12% of the base price, rounded, minimum 1. */
export function upkeepFor(cost: number): number {
  return Math.max(1, Math.round((cost * RULES.upkeepPct) / 100));
}

export interface Faction {
  id: string;
  name: string;
  traits: string[];
  uniqueUnit?: string;
}

export interface ContentPack {
  id: string;
  name: string;
  units: Record<string, UnitType>;
  factions: Record<string, Faction>;
}

function fail(msg: string): never {
  throw new Error(`Invalid content pack: ${msg}`);
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${where} must be an object`);
  return v as Record<string, unknown>;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v === '') fail(`${where} must be a non-empty string`);
  return v;
}

function num(v: unknown, where: string, { integer = false, min = 0 } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= min || (integer && !Number.isInteger(v))) {
    fail(`${where} must be ${integer ? 'an integer' : 'a number'} above ${min}`);
  }
  return v;
}

function tags(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) fail(`${where} must be a list of strings`);
  return [...v];
}

/** Validates raw JSON and returns a typed pack. Throws on invalid data. */
export function loadContent(raw: unknown): ContentPack {
  const r = obj(raw, 'pack');
  const units: Record<string, UnitType> = {};
  for (const [id, u] of Object.entries(obj(r.units, 'units'))) {
    const o = obj(u, `units.${id}`);
    const at = (f: string) => `units.${id}.${f}`;
    const unit: UnitType = {
      id,
      name: str(o.name, at('name')),
      strength: num(o.strength, at('strength')),
      hits: num(o.hits, at('hits'), { integer: true }),
      move: num(o.move, at('move'), { integer: true }),
      tags: tags(o.tags ?? [], at('tags')),
    };
    if (o.cost !== undefined) unit.cost = num(o.cost, at('cost'));
    if (o.buildTurns !== undefined) unit.buildTurns = num(o.buildTurns, at('buildTurns'), { integer: true });
    if (o.upkeep !== undefined) unit.upkeep = num(o.upkeep, at('upkeep'), { integer: true });
    if (o.pursuitStrikes !== undefined) unit.pursuitStrikes = num(o.pursuitStrikes, at('pursuitStrikes'), { integer: true });
    units[id] = unit;
  }
  const factions: Record<string, Faction> = {};
  for (const [id, f] of Object.entries(obj(r.factions, 'factions'))) {
    const o = obj(f, `factions.${id}`);
    const faction: Faction = {
      id,
      name: str(o.name, `factions.${id}.name`),
      traits: tags(o.traits ?? [], `factions.${id}.traits`),
    };
    if (o.uniqueUnit !== undefined) {
      const u = str(o.uniqueUnit, `factions.${id}.uniqueUnit`);
      if (!units[u]) fail(`factions.${id}.uniqueUnit refers to unknown unit "${u}"`);
      faction.uniqueUnit = u;
    }
    factions[id] = faction;
  }
  return { id: str(r.id, 'id'), name: str(r.name, 'name'), units, factions };
}
