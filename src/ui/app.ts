// The page for milestone 3, step 1: a read-only map. Shows player 1's view of
// the demo game; tapping one of your stacks shows where it can go this turn.

import { Application } from 'pixi.js';
import { fantasy } from '../content/fantasy';
import themeJson from '../content/fantasy/theme.json';
import { hexKey } from '../engine/hex';
import { reachable } from '../engine/movement';
import { viewFor } from '../engine/vision';
import { Camera } from './camera';
import { demoGame } from './demo';
import { hexToPixel, mapBounds, pixelToHex } from './hexLayout';
import { MapView, type Selection } from './mapView';
import { loadTheme } from './theme';

export async function startApp(root: HTMLElement, buildStamp: string): Promise<void> {
  const theme = loadTheme(themeJson, fantasy);
  const state = demoGame();
  const viewer = state.players[state.currentPlayer]!;
  const view = viewFor(state, fantasy, viewer.id);
  const faction = fantasy.factions[viewer.factionId]!;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <span class="banner" style="--faction: ${theme.factions[viewer.factionId]!.color}"></span>
        <span class="faction">${faction.name}</span>
        <span class="turn">Turn ${state.turn}</span>
      </header>
      <div class="map" aria-label="Map"></div>
      <footer class="hint"><span class="hint-text">Tap one of your stacks to see where it can move.</span><span class="build">Build ${buildStamp}</span></footer>
    </div>`;
  const mapEl = root.querySelector<HTMLDivElement>('.map')!;
  const hint = root.querySelector<HTMLSpanElement>('.hint-text')!;

  await document.fonts?.ready;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: theme.ui.background, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  mapEl.appendChild(app.canvas);

  const mapView = new MapView(theme);
  app.stage.addChild(mapView.world);
  mapView.drawMap(view);

  let selection: Selection | null = null;
  const redraw = () => mapView.drawState(view, selection);

  const camera = new Camera(mapEl, mapView.world, mapBounds(view.map), (p) => {
    const hex = pixelToHex(p);
    const stack = Object.values(view.stacks).find((s) => hexKey(s.pos) === hexKey(hex));
    if (stack && stack.owner === viewer.id && stack.id !== selection?.stackId) {
      const reach = reachable(view, fantasy, stack.id, { visible: new Set(view.visible) });
      selection = { stackId: stack.id, reach };
      const inReach = Object.keys(reach.hexes).length - 1;
      const attacks = Object.keys(reach.attacks).length;
      hint.textContent = `${stack.unitIds.length} units · Move ${reach.budget} · ${inReach} hexes in reach${attacks ? ` · can attack ${attacks}` : ''}`;
    } else if (stack && stack.owner !== viewer.id) {
      const units = stack.unitIds.map((id) => fantasy.units[view.units[id]!.typeId]!.name).join(', ');
      hint.textContent = `Enemy: ${units}`;
      selection = null;
    } else {
      selection = null;
      hint.textContent = 'Tap one of your stacks to see where it can move.';
    }
    redraw();
  });

  // Start centered on your own stacks at default zoom.
  const own = Object.values(view.stacks).filter((s) => s.owner === viewer.id).map((s) => hexToPixel(s.pos));
  camera.centerOn({ x: own.reduce((a, p) => a + p.x, 0) / own.length, y: own.reduce((a, p) => a + p.y, 0) / own.length });
  redraw();
}
