import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, nextUint32, seedRng } from './rng';

function draw(seed: number | string, n: number): number[] {
  let rng = seedRng(seed);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const [v, next] = nextFloat(rng);
    out.push(v);
    rng = next;
  }
  return out;
}

describe('seeded RNG', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draw(42, 100)).toEqual(draw(42, 100));
    expect(draw('gravelmaw', 10)).toEqual(draw('gravelmaw', 10));
  });

  it('gives different sequences for different seeds', () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it('is pure: drawing does not mutate the input state', () => {
    const rng = seedRng(7);
    const copy = [...rng];
    nextUint32(rng);
    expect(rng).toEqual(copy);
  });

  it('survives a JSON round trip mid-sequence', () => {
    let rng = seedRng(99);
    for (let k = 0; k < 5; k++) rng = nextUint32(rng)[1];
    const restored = JSON.parse(JSON.stringify(rng)) as typeof rng;
    expect(nextFloat(restored)).toEqual(nextFloat(rng));
  });

  it('returns floats in [0, 1) with a sane mean', () => {
    const values = draw(123, 20000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it('nextInt stays in range', () => {
    let rng = seedRng(5);
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) {
      const [v, next] = nextInt(rng, 6);
      rng = next;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
});
