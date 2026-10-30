// The playable slice: a hot-seat game on the test map. The page shows the
// current player's view; taps and buttons go through the interaction reducer,
// and every change to the game goes through the engine.

import { Application } from 'pixi.js';
import { fantasy } from '../content/fantasy';
import stringsJson from '../content/fantasy/strings.json';
import themeJson from '../content/fantasy/theme.json';
import { fromOffset } from '../engine/hex';
import { inBounds } from '../engine/map';
import { reachable } from '../engine/movement';
import type { PlayerView } from '../engine/vision';
import { Camera } from './camera';
import { cityCard } from './cityCard';
import { Game } from './controller';
import { demoGame } from './demo';
import { hexToPixel, mapBounds, pixelToHex } from './hexLayout';
import { initialUi, type Input, type UiState } from './interaction';
import { MapView, type Plan, type Selection } from './mapView';
import {
  attackPanel,
  capturePanel,
  cityPanel,
  esc,
  gameOverOverlay,
  idlePanel,
  movePanel,
  type PanelContext,
  resultPanel,
  stackPanel,
  summaryOverlay,
  topBar,
} from './panels';
import { scoreboard } from './scoreboard';
import { loadStrings } from './strings';
import { buildSummary } from './summary';
import { loadTheme } from './theme';

export async function startApp(root: HTMLElement, buildStamp: string): Promise<void> {
  const theme = loadTheme(themeJson, fantasy);
  const strings = loadStrings(stringsJson);
  const game = new Game(demoGame(), fantasy);
  let ui: UiState = initialUi;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <div class="board" data-ref="board"></div>
      </header>
      <div class="map" aria-label="Map">
        <div class="toast" data-ref="toast" role="status" aria-live="polite"></div>
        <div class="thumbs">
          <button class="thumb" data-input="nextStack">Next stack<span class="badge" data-ref="ready"></span></button>
          <button class="thumb primary" data-input="endTurn">End turn</button>
        </div>
        <span class="build">Build ${esc(buildStamp)}</span>
      </div>
      <section class="panel" data-ref="panel" aria-live="polite"></section>
      <div class="handoff" data-ref="handoff" hidden></div>
      <div class="handoff summary" data-ref="summary" hidden></div>
      <div class="handoff gameover" data-ref="gameover" hidden></div>
    </div>`;
  const ref = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const mapEl = root.querySelector<HTMLDivElement>('.map')!;

  await document.fonts?.ready;
  const app = new Application();
  await app.init({ resizeTo: mapEl, background: theme.ui.background, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  mapEl.prepend(app.canvas);

  const mapView = new MapView(theme);
  app.stage.addChild(mapView.world);
  mapView.drawMap(game.view());

  let toastTimer = 0;
  const showToast = (text: string | null, sticky = false) => {
    const el = ref('toast');
    window.clearTimeout(toastTimer);
    el.textContent = text ?? '';
    el.classList.toggle('show', Boolean(text));
    if (text && !sticky) toastTimer = window.setTimeout(() => el.classList.remove('show'), 3500);
  };

  const centerOnOwn = (view: PlayerView) => {
    const own = Object.values(view.stacks).filter((s) => s.owner === view.viewer).map((s) => hexToPixel(s.pos));
    if (own.length) camera.centerOn({ x: own.reduce((a, p) => a + p.x, 0) / own.length, y: own.reduce((a, p) => a + p.y, 0) / own.length });
  };

  function render(): void {
    const view = game.view();
    const ctx: PanelContext = { view, content: fantasy, strings, theme };
    ref('board').innerHTML = topBar(ctx, scoreboard(view, fantasy));
    const ready = Object.values(view.stacks).filter((s) => s.owner === view.viewer && s.unitIds.every((id) => view.units[id]!.moveLeft > 0)).length;
    ref('ready').textContent = ready ? String(ready) : '';

    const mode = ui.mode;
    let selection: Selection | null = null;
    let plan: Plan | null = null;
    if ((mode.kind === 'selected' || mode.kind === 'move' || mode.kind === 'attack') && view.stacks[mode.stackId]) {
      const stack = view.stacks[mode.stackId]!;
      const reach = reachable(view, fantasy, stack.id, { unitIds: mode.split.length ? mode.split : undefined, visible: new Set(view.visible) });
      selection = { stackId: stack.id, reach };
      if (mode.kind === 'move') {
        const markers =
          mode.steps[mode.steps.length - 1]!.turn > 0
            ? mode.steps.flatMap((s, k) => (k === mode.steps.length - 1 || mode.steps[k + 1]!.turn !== s.turn ? [{ hex: s.hex, turn: s.turn + 1 }] : []))
            : [];
        plan = { path: [stack.pos, ...mode.steps.map((s) => s.hex)], markers };
      } else if (mode.kind === 'attack') {
        plan = { path: [stack.pos, ...mode.path], markers: [], target: view.stacks[mode.targetId]?.pos };
      }
    }
    const city = mode.kind === 'city' || mode.kind === 'capture' ? view.map.sites.find((s) => s.id === mode.siteId)?.pos : undefined;
    mapView.drawState(view, selection, plan, city);

    const panel = ref('panel');
    panel.innerHTML =
      mode.kind === 'selected' ? stackPanel(ctx, mode)
      : mode.kind === 'move' ? movePanel(ctx, mode)
      : mode.kind === 'attack' ? attackPanel(ctx, mode)
      : mode.kind === 'result' ? resultPanel(ctx, mode.report)
      : mode.kind === 'city' ? cityPanel(ctx, cityCard(view, fantasy, strings, mode.siteId))
      : mode.kind === 'capture' ? capturePanel(ctx, mode.siteId)
      : idlePanel();
    panel.dataset.mode = mode.kind;

    const summary = ref('summary');
    summary.hidden = mode.kind !== 'summary';
    if (mode.kind === 'summary') summary.innerHTML = summaryOverlay(ctx, buildSummary(view, fantasy, strings, mode.events));
    const over = ref('gameover');
    over.hidden = !view.winner;
    if (view.winner) over.innerHTML = gameOverOverlay(ctx);

    const handoff = ref('handoff');
    handoff.hidden = mode.kind !== 'handoff';
    if (mode.kind === 'handoff') {
      const next = view.players.find((p) => p.id === mode.playerId)!;
      const nextLook = theme.factions[next.factionId]!;
      const name = esc(fantasy.factions[next.factionId]!.name);
      handoff.innerHTML = `<div class="handoff-card"><span class="banner big ${nextLook.shape}" style="--faction:${nextLook.color}"></span>
        <h2>Pass to the ${name}</h2><p>Hand the device over. The next view shows only what the ${name} can see.</p>
        <button class="primary" data-input="continue">Start the ${name} turn</button></div>`;
    }
    if (ui.message) showToast(ui.message);
    else if (mode.kind === 'move') showToast('Tap the destination again to move', true);
    else if (mode.kind === 'attack') showToast('Tap the enemy again to attack', true);
    else showToast(null);
  }

  function send(input: Input): void {
    const before = ui.mode.kind;
    ui = game.handle(ui, input).ui;
    if (before === 'handoff' && ui.mode.kind !== 'handoff') {
      const view = game.view();
      mapView.drawMap(view);
      centerOnOwn(view);
    }
    render();
  }

  const camera = new Camera(mapEl, mapView.world, mapBounds(game.state.map), (p) => {
    const hex = pixelToHex(p);
    send(inBounds(game.state.map, hex) ? { kind: 'tap', hex } : { kind: 'cancel' });
  });

  root.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-input]');
    if (!target) return;
    const action = target.dataset.action ?? target.dataset.input;
    const delta = Number(target.dataset.delta ?? 0);
    switch (action) {
      case 'toggleUnit':
        return send({ kind: 'toggleUnit', unitId: target.dataset.unit! });
      case 'stance':
        return send({ kind: 'stance', stance: target.dataset.stance as 'hold' | 'fall-back' | 'evade' });
      case 'stanceThreshold':
        return send({ kind: 'stanceThreshold', delta });
      case 'withdraw':
        return send({ kind: 'withdraw', delta });
      case 'openCity':
        return send({ kind: 'openCity', siteId: target.dataset.site! });
      case 'build':
        return send({ kind: 'build', unitTypeId: target.dataset.unit || null });
      case 'capture':
        return send({ kind: 'capture', choice: target.dataset.choice as 'occupy' | 'pillage' | 'raze' });
      case 'newGame':
        return window.location.reload();
      case 'clearSplit':
      case 'cancel':
      case 'confirm':
      case 'continue':
      case 'nextStack':
      case 'endTurn':
        return send({ kind: action } as Input);
    }
  });

  centerOnOwn(game.view());
  render();

  // ?debug exposes hex positions so automated browser checks can tap real hexes.
  if (new URLSearchParams(window.location.search).has('debug')) {
    const hook = {
      screenOf(col: number, row: number) {
        const p = hexToPixel(fromOffset(col, row));
        const r = mapEl.getBoundingClientRect();
        return { x: r.left + mapView.world.position.x + p.x * camera.scale, y: r.top + mapView.world.position.y + p.y * camera.scale };
      },
      center(col: number, row: number) {
        camera.centerOn(hexToPixel(fromOffset(col, row)));
      },
    };
    (window as unknown as { hexlords: typeof hook }).hexlords = hook;
  }
}
