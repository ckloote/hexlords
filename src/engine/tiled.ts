// Loads a map exported from Tiled (JSON) into MapState. Expected shape:
// - orientation "hexagonal", staggeraxis "y", staggerindex "odd" (pointy-top, odd-r)
// - a tile layer "terrain" whose tiles carry a string property "terrain"
// - an optional tile layer "features" whose tiles carry "feature" (road, bridge, ford)
// - an object group "objects" with point objects of type/class "city" at hex
//   centers, with properties "tier" (village, city, capital) and optional "owner"

import { type ContentPack, FEATURES } from './content';
import { fromOffset } from './hex';
import { type CityTier, type Feature, hexKeyOf, inBounds, type MapState, type Site } from './map';

const GID_MASK = 0x1fffffff; // strips Tiled's flip flags
const TIERS: readonly CityTier[] = ['village', 'city', 'capital'];

type Props = Record<string, unknown>;

function fail(msg: string): never {
  throw new Error(`Invalid Tiled map: ${msg}`);
}

function asObj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${where} must be an object`);
  return v as Record<string, unknown>;
}

function asArray(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(`${where} must be an array`);
  return v;
}

function props(v: unknown): Props {
  const out: Props = {};
  for (const p of Array.isArray(v) ? v : []) {
    const o = asObj(p, 'property');
    if (typeof o.name === 'string') out[o.name] = o.value;
  }
  return out;
}

export function loadTiledMap(json: unknown, content: ContentPack): MapState {
  const m = asObj(json, 'map');
  if (m.orientation !== 'hexagonal') fail('orientation must be hexagonal');
  if (m.staggeraxis !== 'y') fail('staggeraxis must be "y" (pointy-top)');
  if (m.staggerindex !== 'odd') fail('staggerindex must be "odd"');
  const width = m.width as number;
  const height = m.height as number;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail('bad width or height');
  const tileW = m.tilewidth as number;
  const tileH = m.tileheight as number;
  const side = (m.hexsidelength as number) ?? 0;

  // gid -> tile properties
  const tileProps = new Map<number, Props>();
  for (const ts of asArray(m.tilesets, 'tilesets')) {
    const t = asObj(ts, 'tileset');
    const first = t.firstgid as number;
    for (const tile of asArray(t.tiles ?? [], 'tileset.tiles')) {
      const o = asObj(tile, 'tile');
      tileProps.set(first + (o.id as number), props(o.properties));
    }
  }

  const layers = asArray(m.layers, 'layers').map((l) => asObj(l, 'layer'));
  const layer = (name: string) => layers.find((l) => l.name === name);
  const tiles = (l: Record<string, unknown>, name: string) => {
    const data = asArray(l.data, `${name}.data`) as number[];
    if (data.length !== width * height) fail(`${name} layer must have ${width * height} tiles`);
    return data.map((g) => g & GID_MASK);
  };

  const terrainLayer = layer('terrain');
  if (!terrainLayer) fail('missing "terrain" tile layer');
  const terrain = tiles(terrainLayer, 'terrain').map((gid, k) => {
    const id = tileProps.get(gid)?.terrain;
    if (typeof id !== 'string') fail(`terrain tile ${k} (gid ${gid}) has no terrain property`);
    if (!content.terrain[id]) fail(`unknown terrain "${id}"`);
    return id;
  });

  const features: Record<string, Feature> = {};
  const featureLayer = layer('features');
  if (featureLayer) {
    tiles(featureLayer, 'features').forEach((gid, k) => {
      if (gid === 0) return;
      const f = tileProps.get(gid)?.feature;
      if (!FEATURES.includes(f as Feature)) fail(`feature tile ${k} has unknown feature "${String(f)}"`);
      features[hexKeyOf(k % width, Math.floor(k / width))] = f as Feature;
    });
  }

  const map: MapState = { width, height, terrain, features, sites: [] };
  const rowHeight = (tileH + side) / 2;
  for (const raw of asArray(layer('objects')?.objects ?? [], 'objects')) {
    const o = asObj(raw, 'object');
    const kind = o.type ?? o.class;
    if (kind !== 'city') fail(`object ${String(o.id)} has unsupported type "${String(kind)}"`);
    const row = Math.round(((o.y as number) - tileH / 2) / rowHeight);
    const col = Math.round(((o.x as number) - tileW / 2 - (row % 2 ? tileW / 2 : 0)) / tileW);
    const pos = fromOffset(col, row);
    if (!inBounds(map, pos)) fail(`object ${String(o.id)} lies outside the map`);
    const p = props(o.properties);
    const tier = p.tier as CityTier;
    if (!TIERS.includes(tier)) fail(`city ${String(o.name)} has bad tier "${String(p.tier)}"`);
    const site: Site = {
      id: `site${String(o.id)}`,
      kind: 'city',
      name: typeof o.name === 'string' && o.name ? o.name : `City ${String(o.id)}`,
      pos,
      tier,
      owner: typeof p.owner === 'string' && p.owner ? p.owner : null,
    };
    map.sites.push(site);
  }
  return map;
}
