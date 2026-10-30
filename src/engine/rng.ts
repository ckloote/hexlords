// Seeded PRNG (sfc32). The state is four uint32s in a plain array, so it can
// live inside the game state and survive JSON round trips. Every function is
// pure: it returns the drawn value together with the next state.

export type RngState = [number, number, number, number];

/** splitmix32 step, used only to spread a seed across the four words. */
function splitmix32(x: number): [number, number] {
  const next = (x + 0x9e3779b9) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return [z >>> 0, next];
}

function hashString(s: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedRng(seed: number | string): RngState {
  let x = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const words: number[] = [];
  for (let k = 0; k < 4; k++) {
    const [v, next] = splitmix32(x);
    words.push(v);
    x = next;
  }
  let state = words as RngState;
  // Discard the first outputs so similar seeds diverge quickly.
  for (let k = 0; k < 12; k++) state = nextUint32(state)[1];
  return state;
}

export function nextUint32(state: RngState): [number, RngState] {
  let [a, b, c, d] = state;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [t >>> 0, [a >>> 0, b >>> 0, c >>> 0, d >>> 0]];
}

/** Uniform float in [0, 1). */
export function nextFloat(state: RngState): [number, RngState] {
  const [v, next] = nextUint32(state);
  return [v / 4294967296, next];
}

/** Uniform integer in [0, n). */
export function nextInt(state: RngState, n: number): [number, RngState] {
  const [v, next] = nextFloat(state);
  return [Math.floor(v * n), next];
}
