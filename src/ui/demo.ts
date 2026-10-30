// The demo game shown on the page: the handcrafted test map plus a starting
// setup from the content pack. Stack positions are offset (col, row), like Tiled.

import { fantasy, testMapJson } from '../content/fantasy';
import scenario from '../content/fantasy/scenarios/test.json';
import type { ContentPack } from '../engine/content';
import { createGame, type GameSetup } from '../engine/engine';
import { fromOffset } from '../engine/hex';
import type { MapState } from '../engine/map';
import { loadTiledMap } from '../engine/tiled';
import type { GameState, Stance } from '../engine/types';

interface ScenarioJson {
  seed: string | number;
  players: GameSetup['players'];
  startingGold?: number;
  stacks: { owner: string; at: [number, number]; units: GameSetup['stacks'][number]['units']; stance?: unknown }[];
}

export function scenarioSetup(raw: unknown, map: MapState): GameSetup {
  const s = raw as ScenarioJson;
  const setup: GameSetup = {
    seed: s.seed,
    map,
    players: s.players,
    stacks: s.stacks.map((st) => {
      const out: GameSetup['stacks'][number] = { owner: st.owner, pos: fromOffset(st.at[0], st.at[1]), units: st.units };
      if (st.stance) out.stance = st.stance as Stance;
      return out;
    }),
  };
  if (s.startingGold !== undefined) setup.startingGold = s.startingGold;
  return setup;
}

export function demoGame(content: ContentPack = fantasy): GameState {
  return createGame(scenarioSetup(scenario, loadTiledMap(testMapJson, content)), content);
}
