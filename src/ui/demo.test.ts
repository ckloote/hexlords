import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import { reachable } from '../engine/movement';
import { viewFor } from '../engine/vision';
import { demoGame } from './demo';

describe('demo game', () => {
  const state = demoGame();

  it('builds a valid game on the test map', () => {
    expect(state.map.width).toBe(14);
    expect(Object.keys(state.stacks)).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('shows player 1 the orc patrol at the bridge but not the Gravelmaw garrison', () => {
    const view = viewFor(state, fantasy, 'p1');
    const enemies = Object.values(view.stacks).filter((s) => s.owner === 'p2');
    expect(enemies.map((s) => s.id)).toEqual(['s4']);
    expect(view.stacks.s4!.stance).toEqual({ kind: 'fall-back', threshold: 0.4 });
  });

  it('gives the host at the bridge reach, contested hexes, and an attack', () => {
    const view = viewFor(state, fantasy, 'p1');
    const reach = reachable(view, fantasy, 's1', { visible: new Set(view.visible) });
    expect(reach.budget).toBe(6);
    expect(reach.contested.length).toBeGreaterThan(0);
    expect(Object.keys(reach.attacks)).toEqual(['s4']);
  });
});
