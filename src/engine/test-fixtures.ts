// Shared test fixtures. Not imported by game code.
import type { Fighter } from './fight';

/** Gravelmaw, with effective Strengths already applied (see modifiers.test.ts). */
export function gravelmaw(): { attackers: Fighter[]; defenders: Fighter[] } {
  return {
    attackers: [
      { strength: 2.5, hits: 2, move: 6 }, // siege engine
      { strength: 5, hits: 2, move: 8 }, // infantry
      { strength: 5, hits: 1, move: 8 }, // infantry, wounded
      { strength: 6.25, hits: 3, move: 6 }, // ironguard
      { strength: 6.25, hits: 3, move: 10 }, // hero
    ],
    defenders: [
      { strength: 2, hits: 2, move: 8 },
      { strength: 2, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 4, hits: 2, move: 8 },
      { strength: 5, hits: 3, move: 8 },
    ],
  };
}
