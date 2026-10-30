import { describe, expect, it } from 'vitest';
import { fantasy, testMapJson } from '../content/fantasy';
import { fromOffset } from './hex';
import { featureAt, siteAt, terrainAt } from './map';
import { loadTiledMap } from './tiled';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('loadTiledMap', () => {
  const map = loadTiledMap(testMapJson, fantasy);

  it('reads size and terrain in odd-r order', () => {
    expect(map.width).toBe(14);
    expect(map.height).toBe(18);
    expect(terrainAt(map, fromOffset(0, 0))).toBe('mountains');
    expect(terrainAt(map, fromOffset(6, 0))).toBe('forest');
    expect(terrainAt(map, fromOffset(0, 8))).toBe('water');
    expect(terrainAt(map, fromOffset(1, 8))).toBe('river');
    expect(terrainAt(map, fromOffset(14, 0))).toBeUndefined();
  });

  it('reads roads, the bridge, and the ford', () => {
    expect(featureAt(map, fromOffset(6, 8))).toBe('bridge');
    expect(terrainAt(map, fromOffset(6, 8))).toBe('river');
    expect(featureAt(map, fromOffset(10, 8))).toBe('ford');
    expect(featureAt(map, fromOffset(6, 3))).toBe('road');
    expect(featureAt(map, fromOffset(7, 3))).toBeUndefined();
  });

  it('places cities from point objects at hex centers', () => {
    expect(siteAt(map, fromOffset(6, 2))).toMatchObject({ name: 'Gravelmaw', tier: 'city', startOwner: 'p2' });
    expect(siteAt(map, fromOffset(6, 14))).toMatchObject({ name: 'Stonebridge', tier: 'city', startOwner: 'p1' });
    expect(siteAt(map, fromOffset(11, 12))).toMatchObject({ name: 'Kettle Ford', tier: 'village', startOwner: 'p1' });
    expect(siteAt(map, fromOffset(12, 4))).toMatchObject({ name: 'Hollow Pine', tier: 'village', startOwner: null });
    expect(map.sites).toHaveLength(4);
  });

  it('is JSON-safe', () => {
    expect(clone(map)).toEqual(map);
  });

  it('rejects maps that are not odd-r pointy-top hex maps', () => {
    const bad = clone(testMapJson) as Record<string, unknown>;
    bad.staggeraxis = 'x';
    expect(() => loadTiledMap(bad, fantasy)).toThrow(/staggeraxis/);
    const ortho = clone(testMapJson) as Record<string, unknown>;
    ortho.orientation = 'orthogonal';
    expect(() => loadTiledMap(ortho, fantasy)).toThrow(/hexagonal/);
  });

  it('rejects unknown terrain, missing tiles, and stray objects', () => {
    const unknown = clone(testMapJson) as { tilesets: { tiles: { properties: { value: string }[] }[] }[] };
    unknown.tilesets[0]!.tiles[0]!.properties[0]!.value = 'lava';
    expect(() => loadTiledMap(unknown, fantasy)).toThrow(/lava/);
    const holes = clone(testMapJson) as { layers: { data?: number[] }[] };
    holes.layers[0]!.data![3] = 0;
    expect(() => loadTiledMap(holes, fantasy)).toThrow(/terrain/);
    const stray = clone(testMapJson) as { layers: { objects?: { x: number }[] }[] };
    stray.layers[2]!.objects![0]!.x = 99999;
    expect(() => loadTiledMap(stray, fantasy)).toThrow(/outside/);
  });
});
