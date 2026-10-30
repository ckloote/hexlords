// Pixel geometry for pointy-top hexes. Axial (q, r) to pixels and back, at the
// mockups' default size (radius 25 px, about 43 px wide).

import { type Hex } from '../engine/hex';
import { allHexes, type MapState } from '../engine/map';

export const HEX_SIZE = 25;
const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

/** Center of hex `h`; hex (0, 0) is at the origin. */
export function hexToPixel(h: Hex, size = HEX_SIZE): Point {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** The hex containing point `p`. */
export function pixelToHex(p: Point, size = HEX_SIZE): Hex {
  const q = ((SQRT3 / 3) * p.x - p.y / 3) / size;
  const r = ((2 / 3) * p.y) / size;
  // Round in cube coordinates.
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 }; // + 0 turns -0 into 0
}

/** The six corners of the hex centered on `center`, clockwise from the top. */
export function hexCorners(center: Point, size = HEX_SIZE): Point[] {
  return Array.from({ length: 6 }, (_, k) => {
    const angle = (Math.PI / 180) * (60 * k - 90);
    return { x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) };
  });
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Pixel extent of every hex on the map. */
export function mapBounds(map: MapState, size = HEX_SIZE): Bounds {
  const half = (size * SQRT3) / 2;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const h of allHexes(map)) {
    const p = hexToPixel(h, size);
    b.minX = Math.min(b.minX, p.x - half);
    b.maxX = Math.max(b.maxX, p.x + half);
    b.minY = Math.min(b.minY, p.y - size);
    b.maxY = Math.max(b.maxY, p.y + size);
  }
  return b;
}
