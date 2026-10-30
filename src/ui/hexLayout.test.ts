import { describe, expect, it } from 'vitest';
import { fromOffset, hexKey } from '../engine/hex';
import { plainsMap } from '../engine/test-fixtures';
import { HEX_SIZE, hexCorners, hexToPixel, mapBounds, pixelToHex } from './hexLayout';

describe('hex layout (pointy-top, radius 25)', () => {
  it('spaces hexes like the mockups: 43.3 px across a row, 37.5 px between rows', () => {
    expect(HEX_SIZE).toBe(25);
    const a = hexToPixel(fromOffset(0, 0));
    const b = hexToPixel(fromOffset(1, 0));
    const c = hexToPixel(fromOffset(0, 1));
    expect(b.x - a.x).toBeCloseTo(43.30127, 4);
    expect(b.y - a.y).toBeCloseTo(0, 9);
    expect(c.y - a.y).toBeCloseTo(37.5, 9);
    // Odd rows are shifted half a hex to the right.
    expect(c.x - a.x).toBeCloseTo(21.65064, 4);
  });

  it('finds the hex under a point, at centers and near edges', () => {
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const h = fromOffset(col, row);
        const p = hexToPixel(h);
        expect(hexKey(pixelToHex(p))).toBe(hexKey(h));
        // 90% of the way to each corner is still inside.
        for (const corner of hexCorners(p)) {
          const near = { x: p.x + 0.9 * (corner.x - p.x), y: p.y + 0.9 * (corner.y - p.y) };
          expect(hexKey(pixelToHex(near))).toBe(hexKey(h));
        }
      }
    }
  });

  it('measures the map, including the half-hex shift of odd rows', () => {
    const b = mapBounds(plainsMap(3, 2));
    expect(b.minX).toBeCloseTo(-21.65064, 4);
    expect(b.minY).toBeCloseTo(-25, 9);
    expect(b.maxX).toBeCloseTo(3 * 43.30127, 3); // odd row: center 2.5 widths in, plus half a hex
    expect(b.maxY).toBeCloseTo(37.5 + 25, 9);
  });
});
