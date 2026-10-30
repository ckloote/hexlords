// Axial hex coordinates (pointy-top). Milestone 2 grows this into the map module.

export interface Hex {
  q: number;
  r: number;
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
