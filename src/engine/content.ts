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
  /** Ignores zone of control when stepping into forest. */
  forestZocImmune: 'forest-zoc-immune',
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
  /** Vision radius in hexes; default RULES.defaultVision. */
  vision?: number;
  tags: string[];
}

export interface TerrainType {
  id: string;
  name: string;
  /** Doubled movement cost; null means impassable on foot. */
  moveCost: number | null;
  /** Defender bonus. */
  defensePct: number;
  /** Extra vision radius for a stack standing here. */
  visionBonus: number;
  tags: string[];
  /** Cost overrides for units carrying a faction trait or unit tag, e.g. { "mountain-walker": 6 }. */
  traitCosts?: Record<string, number>;
}

export const FEATURES = ['road', 'bridge', 'ford'] as const;

export interface FeatureType {
  name: string;
  /** Replaces the terrain's cost for everyone. */
  moveCost: number;
}

/** Upkeep rule from DESIGN.md: 12% of the base price, rounded, minimum 1. */
export function upkeepFor(cost: number): number {
  return Math.max(1, Math.round((cost * RULES.upkeepPct) / 100));
}

export interface Faction {
  id: string;
  name: string;
  /** A short name for tight spaces such as the score strip; defaults to name. */
  shortName: string;
  traits: string[];
  uniqueUnit?: string;
}

export interface ContentPack {
  id: string;
  name: string;
  units: Record<string, UnitType>;
  factions: Record<string, Faction>;
  terrain: Record<string, TerrainType>;
  features: Record<(typeof FEATURES)[number], FeatureType>;
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

function num(v: unknown, where: string, { integer = false, min = 0, inclusive = false } = {}): number {
  const low = typeof v === 'number' && (inclusive ? v < min : v <= min);
  if (typeof v !== 'number' || !Number.isFinite(v) || low || (integer && !Number.isInteger(v))) {
    fail(`${where} must be ${integer ? 'an integer' : 'a number'} ${inclusive ? 'at least' : 'above'} ${min}`);
  }
  return v;
}

const pct = (v: unknown, where: string) => num(v, where, { integer: true, min: -100, inclusive: true });

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
    if (o.vision !== undefined) unit.vision = num(o.vision, at('vision'), { integer: true });
    units[id] = unit;
  }
  const factions: Record<string, Faction> = {};
  for (const [id, f] of Object.entries(obj(r.factions, 'factions'))) {
    const o = obj(f, `factions.${id}`);
    const faction: Faction = {
      id,
      name: str(o.name, `factions.${id}.name`),
      shortName: o.shortName === undefined ? str(o.name, `factions.${id}.name`) : str(o.shortName, `factions.${id}.shortName`),
      traits: tags(o.traits ?? [], `factions.${id}.traits`),
    };
    if (o.uniqueUnit !== undefined) {
      const u = str(o.uniqueUnit, `factions.${id}.uniqueUnit`);
      if (!units[u]) fail(`factions.${id}.uniqueUnit refers to unknown unit "${u}"`);
      faction.uniqueUnit = u;
    }
    factions[id] = faction;
  }
  const terrain: Record<string, TerrainType> = {};
  for (const [id, t] of Object.entries(obj(r.terrain, 'terrain'))) {
    const o = obj(t, `terrain.${id}`);
    const at = (f: string) => `terrain.${id}.${f}`;
    const type: TerrainType = {
      id,
      name: str(o.name, at('name')),
      moveCost: o.moveCost === null ? null : num(o.moveCost, at('moveCost'), { integer: true }),
      defensePct: pct(o.defensePct ?? 0, at('defensePct')),
      visionBonus: num(o.visionBonus ?? 0, at('visionBonus'), { integer: true, inclusive: true }),
      tags: tags(o.tags ?? [], at('tags')),
    };
    if (o.traitCosts !== undefined) {
      type.traitCosts = {};
      for (const [trait, cost] of Object.entries(obj(o.traitCosts, at('traitCosts')))) {
        type.traitCosts[trait] = num(cost, at(`traitCosts.${trait}`), { integer: true });
      }
    }
    terrain[id] = type;
  }
  const rawFeatures = obj(r.features, 'features');
  const features = {} as ContentPack['features'];
  for (const f of FEATURES) {
    const o = obj(rawFeatures[f], `features.${f}`);
    features[f] = { name: str(o.name, `features.${f}.name`), moveCost: num(o.moveCost, `features.${f}.moveCost`, { integer: true }) };
  }
  return { id: str(r.id, 'id'), name: str(r.name, 'name'), units, factions, terrain, features };
}
