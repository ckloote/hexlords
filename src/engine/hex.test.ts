import { describe, expect, it } from 'vitest';
import { DIRECTIONS, fromOffset, hexDistance, hexKey, hexesWithin, neighbors, parseHexKey, toOffset } from './hex';

describe('hex math (axial, pointy-top)', () => {
  it('has six neighbors at distance 1, in a fixed order', () => {
    const n = neighbors({ q: 2, r: 3 });
    expect(n).toHaveLength(6);
    for (const h of n) expect(hexDistance(h, { q: 2, r: 3 })).toBe(1);
    expect(n[0]).toEqual({ q: 3, r: 3 }); // east first
    expect(DIRECTIONS).toHaveLength(6);
  });

  it('measures distance', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: -2, r: 4 })).toBe(4);
  });

  it('round-trips odd-r offset coordinates (Tiled staggeraxis y, staggerindex odd)', () => {
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 6; col++) {
        expect(toOffset(fromOffset(col, row))).toEqual({ col, row });
      }
    }
    // Odd rows are shoved right: (0,1) is adjacent to (0,0) and (1,0).
    const a = fromOffset(0, 1);
    expect(hexDistance(a, fromOffset(0, 0))).toBe(1);
    expect(hexDistance(a, fromOffset(1, 0))).toBe(1);
    // Even rows: (1,2) is adjacent to (0,1) and (1,1).
    expect(hexDistance(fromOffset(1, 2), fromOffset(0, 1))).toBe(1);
    expect(hexDistance(fromOffset(1, 2), fromOffset(1, 1))).toBe(1);
  });

  it('keys round-trip', () => {
    expect(parseHexKey(hexKey({ q: -3, r: 7 }))).toEqual({ q: -3, r: 7 });
  });

  it('lists hexes within a radius', () => {
    expect(hexesWithin({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexesWithin({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(hexesWithin({ q: 0, r: 0 }, 2)).toHaveLength(19);
  });
});
