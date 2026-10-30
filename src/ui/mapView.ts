// Draws a player's view of the map with PixiJS: terrain, roads, crossings,
// cities, stacks (only those in the view, so fog applies), and the selected
// stack's reach and zone-of-control overlay.

import { Container, Graphics, Text } from 'pixi.js';
import { type Hex, hexKey, neighbors, parseHexKey } from '../engine/hex';
import { allHexes, featureAt, inBounds, siteAt, terrainAt } from '../engine/map';
import type { Reach } from '../engine/movement';
import type { Stack } from '../engine/types';
import type { PlayerView } from '../engine/vision';
import { HEX_SIZE, hexCorners, hexToPixel, type Point } from './hexLayout';
import type { BannerShape, Theme } from './theme';

const flat = (pts: Point[]) => pts.flatMap((p) => [p.x, p.y]);

export interface Selection {
  stackId: string;
  reach: Reach;
}

/** A planned move or attack drawn over the map. */
export interface Plan {
  /** From the stack's hex through each step. */
  path: Hex[];
  /** Turn-end markers: where each turn's movement ends (1-based turn numbers). */
  markers: { hex: Hex; turn: number }[];
  /** An enemy stack about to be attacked. */
  target?: Hex;
}

export class MapView {
  /** Everything on the map; the camera moves and scales this. */
  readonly world = new Container();
  private terrain = new Container();
  private overlay = new Graphics();
  private plan = new Container();
  private fog = new Graphics();
  private stacks = new Container();

  constructor(private theme: Theme) {
    this.world.addChild(this.terrain, this.fog, this.overlay, this.stacks, this.plan);
  }

  /** Draws the static layers (terrain, roads, crossings, cities). Call once per map. */
  drawMap(view: PlayerView): void {
    this.terrain.removeChildren();
    const ground = new Graphics();
    const grid = new Graphics();
    for (const h of allHexes(view.map)) {
      const corners = flat(hexCorners(hexToPixel(h)));
      ground.poly(corners).fill(this.theme.terrain[terrainAt(view.map, h)!] ?? '#000000');
      grid.poly(corners).stroke({ width: 1, color: '#23251F', alpha: 0.32 });
    }
    this.terrain.addChild(ground, this.drawTerrainMarks(view), grid, this.drawRoads(view), this.drawCities(view));
  }

  /** Small marks so terrain reads without relying on color alone. */
  private drawTerrainMarks(view: PlayerView): Graphics {
    const g = new Graphics();
    for (const h of allHexes(view.map)) {
      const c = hexToPixel(h);
      const t = terrainAt(view.map, h);
      if (t === 'forest') {
        for (const [dx, dy] of [[-7, 3], [6, -2], [1, 9]] as const) {
          g.poly([c.x + dx, c.y + dy - 8, c.x + dx - 5, c.y + dy + 2, c.x + dx + 5, c.y + dy + 2]).fill({ color: '#4F6A3D', alpha: 0.9 });
        }
      } else if (t === 'hills') {
        // moveTo first, or the arc joins on to the previous path.
        g.moveTo(c.x - 12, c.y + 5).arc(c.x - 5, c.y + 5, 7, Math.PI, 0).stroke({ width: 2, color: '#8A774E' });
        g.moveTo(c.x, c.y + 2).arc(c.x + 6, c.y + 2, 6, Math.PI, 0).stroke({ width: 2, color: '#8A774E' });
      } else if (t === 'mountains') {
        g.poly([c.x - 12, c.y + 8, c.x - 3, c.y - 9, c.x + 6, c.y + 8]).fill('#6E6A65');
        g.poly([c.x - 1, c.y + 8, c.x + 6, c.y - 4, c.x + 13, c.y + 8]).fill('#7A766F');
      } else if (t === 'swamp') {
        for (const dy of [-4, 4]) g.moveTo(c.x - 9, c.y + dy).lineTo(c.x + 9, c.y + dy).stroke({ width: 1.5, color: '#5E6648' });
      } else if (t === 'river' || t === 'water') {
        g.moveTo(c.x - 10, c.y - 2).bezierCurveTo(c.x - 4, c.y - 6, c.x + 4, c.y + 2, c.x + 10, c.y - 2).stroke({ width: 1.5, color: '#86AFCB', alpha: 0.8 });
      }
      if (featureAt(view.map, h) === 'ford') {
        g.poly(flat(hexCorners(c, HEX_SIZE - 3))).fill({ color: this.theme.features.ford, alpha: 0.9 });
        for (const dx of [-8, 0, 8]) g.circle(c.x + dx, c.y + (dx === 0 ? 4 : -2), 2.5).fill('#9C9484');
      }
    }
    return g;
  }

  private drawRoads(view: PlayerView): Graphics {
    const g = new Graphics();
    const onRoad = (h: Hex) => {
      const f = featureAt(view.map, h);
      return f === 'road' || f === 'bridge' || siteAt(view.map, h) !== undefined;
    };
    for (const h of allHexes(view.map)) {
      if (featureAt(view.map, h) === 'bridge') {
        const c = hexToPixel(h);
        g.roundRect(c.x - 9, c.y - 18, 18, 36, 3).fill('#8A6F45').stroke({ width: 1, color: '#5E4A2C' });
      }
    }
    const done = new Set<string>();
    for (const h of allHexes(view.map)) {
      if (!onRoad(h)) continue;
      for (const n of neighbors(h)) {
        if (!inBounds(view.map, n) || !onRoad(n)) continue;
        const key = [hexKey(h), hexKey(n)].sort().join('|');
        if (done.has(key)) continue;
        done.add(key);
        const a = hexToPixel(h);
        const b = hexToPixel(n);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5, color: this.theme.features.road, cap: 'round' });
      }
    }
    return g;
  }

  private drawCities(view: PlayerView): Container {
    const layer = new Container();
    for (const site of view.map.sites) {
      const c = hexToPixel(site.pos);
      const owner = view.cityOwners[site.id];
      const faction = view.players.find((p) => p.id === owner)?.factionId;
      const ring = faction ? this.theme.factions[faction]!.color : this.theme.ui.neutral;
      const size = site.tier === 'village' ? 9 : site.tier === 'city' ? 12 : 14;
      const g = new Graphics();
      g.roundRect(c.x - size, c.y - size, size * 2, size * 2, 3).fill('#3A3328').stroke({ width: 2.5, color: ring });
      // Battlements.
      for (let k = -1; k <= 1; k++) g.rect(c.x + k * size * 0.6 - 2, c.y - size - 4, 4, 4).fill('#3A3328');
      const label = new Text({
        text: site.name,
        style: { fontFamily: 'Source Sans 3, system-ui, sans-serif', fontSize: 11, fontWeight: '700', fill: '#FFF8EA', stroke: { color: '#15171B', width: 3 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(c.x, c.y + size + 2);
      layer.addChild(g, label);
    }
    return layer;
  }

  /** Draws what changes: fog, stacks, and the selection overlay. */
  drawState(view: PlayerView, selection: Selection | null, plan: Plan | null = null): void {
    const visible = new Set(view.visible);
    this.fog.clear();
    for (const h of allHexes(view.map)) {
      if (!visible.has(hexKey(h))) this.fog.poly(flat(hexCorners(hexToPixel(h)))).fill({ color: '#15171B', alpha: 0.28 });
    }
    this.drawOverlay(selection);
    this.stacks.removeChildren();
    for (const stack of Object.values(view.stacks)) this.stacks.addChild(this.drawStack(view, stack, stack.id === selection?.stackId));
    this.drawPlan(plan);
  }

  private drawPlan(plan: Plan | null): void {
    this.plan.removeChildren();
    if (!plan) return;
    const g = new Graphics();
    const color = this.theme.ui.path;
    if (plan.path.length > 1) {
      const pts = plan.path.map((h) => hexToPixel(h));
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 5, color: '#15171B', alpha: 0.5, cap: 'round', join: 'round' });
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 3, color, cap: 'round', join: 'round' });
    }
    if (plan.target) {
      const c = hexToPixel(plan.target);
      g.circle(c.x, c.y, 20).stroke({ width: 3, color: this.theme.ui.danger });
    }
    this.plan.addChild(g);
    for (const m of plan.markers) {
      const c = hexToPixel(m.hex);
      const dot = new Graphics().circle(c.x, c.y, 9).fill(color).stroke({ width: 2, color: '#15171B' });
      const n = new Text({
        text: String(m.turn),
        style: { fontFamily: 'Source Sans 3, system-ui, sans-serif', fontSize: 11, fontWeight: '700', fill: '#1A1508' },
      });
      n.anchor.set(0.5);
      n.position.set(c.x, c.y);
      this.plan.addChild(dot, n);
    }
  }

  private drawOverlay(selection: Selection | null): void {
    const g = this.overlay;
    g.clear();
    if (!selection) return;
    for (const [key, entry] of Object.entries(selection.reach.hexes)) {
      if (entry.cost === 0) continue;
      const corners = flat(hexCorners(hexToPixel(parseHexKey(key)), HEX_SIZE - 1));
      g.poly(corners).fill({ color: '#FFF8EA', alpha: 0.22 }).stroke({ width: 1.5, color: '#FFF8EA', alpha: 0.55 });
    }
    // Contested hexes the stack can reach: red hatching.
    for (const key of selection.reach.contested) {
      const c = hexToPixel(parseHexKey(key));
      const r = HEX_SIZE * 0.8;
      for (const offset of [-12, -4, 4, 12]) {
        // A 45° line at this offset, clipped to a circle of radius r.
        const half = Math.sqrt(Math.max(0, r * r - offset * offset));
        const ux = Math.SQRT1_2;
        const ox = c.x + offset * ux;
        const oy = c.y - offset * ux;
        g.moveTo(ox - half * ux, oy - half * ux).lineTo(ox + half * ux, oy + half * ux).stroke({ width: 2, color: this.theme.ui.danger, alpha: 0.85 });
      }
    }
  }

  private drawStack(view: PlayerView, stack: Stack, selected: boolean): Container {
    const c = hexToPixel(stack.pos);
    const factionId = view.players.find((p) => p.id === stack.owner)?.factionId ?? '';
    const { color, shape } = this.theme.factions[factionId] ?? { color: '#CCCCCC', shape: 'circle' as BannerShape };
    const layer = new Container();
    const g = new Graphics();
    if (selected) g.circle(c.x, c.y, 19).stroke({ width: 3, color: this.theme.ui.path });
    banner(g, shape, c, 13).fill(color).stroke({ width: 2, color: '#15171B' });
    const count = new Text({
      text: String(stack.unitIds.length),
      style: { fontFamily: 'Source Sans 3, system-ui, sans-serif', fontSize: 13, fontWeight: '700', fill: '#15171B' },
    });
    count.anchor.set(0.5);
    count.position.set(c.x, c.y + (shape === 'triangle' ? 3 : 0));
    layer.addChild(g, count);
    if (stack.owner !== view.viewer && stack.stance.kind !== 'hold') {
      // Public stance banner: a small flag above the stack.
      const flag = stack.stance.kind === 'evade' ? 'E' : `F${Math.round(stack.stance.threshold * 100)}`;
      const t = new Text({
        text: flag,
        style: { fontFamily: 'Source Sans 3, system-ui, sans-serif', fontSize: 10, fontWeight: '700', fill: '#FFF8EA', stroke: { color: '#15171B', width: 3 } },
      });
      t.anchor.set(0.5, 1);
      t.position.set(c.x, c.y - 15);
      layer.addChild(t);
    }
    return layer;
  }
}

/** A faction banner shape centered on `c`; distinct shapes help colorblind players. */
function banner(g: Graphics, shape: BannerShape, c: Point, r: number): Graphics {
  switch (shape) {
    case 'rounded-square':
      return g.roundRect(c.x - r, c.y - r, 2 * r, 2 * r, 4);
    case 'diamond':
      return g.poly([c.x, c.y - r * 1.25, c.x + r * 1.25, c.y, c.x, c.y + r * 1.25, c.x - r * 1.25, c.y]);
    case 'circle':
      return g.circle(c.x, c.y, r);
    case 'triangle':
      return g.poly([c.x, c.y - r * 1.2, c.x + r * 1.2, c.y + r * 0.9, c.x - r * 1.2, c.y + r * 0.9]);
  }
}
