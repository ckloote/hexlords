// Pan and zoom for the map: drag to pan, pinch (touch) or wheel (desktop) to
// zoom, and taps reported in map coordinates. Uses DOM pointer events on the
// canvas so one- and two-finger gestures behave the same on every browser.

import type { Container } from 'pixi.js';
import type { Bounds, Point } from './hexLayout';

const TAP_SLOP = 8; // px a finger may wander and still count as a tap

export class Camera {
  scale = 1;
  readonly minScale: number;
  readonly maxScale = 2.5;
  private pointers = new Map<number, Point>();
  private moved = 0;
  private pinchDistance = 0;

  constructor(
    private el: HTMLElement,
    private world: Container,
    private bounds: Bounds,
    private onTap: (p: Point) => void,
  ) {
    const fit = Math.min(el.clientWidth / (bounds.maxX - bounds.minX), el.clientHeight / (bounds.maxY - bounds.minY));
    this.minScale = Math.min(1, fit * 0.9);
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
  }

  /** Centers the view on a map point. */
  centerOn(p: Point): void {
    this.world.position.set(this.el.clientWidth / 2 - p.x * this.scale, this.el.clientHeight / 2 - p.y * this.scale);
    this.clamp();
  }

  /** Screen point (relative to the element) to map coordinates. */
  toMap(p: Point): Point {
    return { x: (p.x - this.world.position.x) / this.scale, y: (p.y - this.world.position.y) / this.scale };
  }

  private local(e: PointerEvent | WheelEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 1) this.moved = 0;
    if (this.pointers.size === 2) this.pinchDistance = this.spread();
  };

  private move = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const now = this.local(e);
    if (this.pointers.size === 1) {
      this.world.position.x += now.x - prev.x;
      this.world.position.y += now.y - prev.y;
      this.moved += Math.hypot(now.x - prev.x, now.y - prev.y);
      this.pointers.set(e.pointerId, now);
      this.clamp();
    } else if (this.pointers.size === 2) {
      this.pointers.set(e.pointerId, now);
      const d = this.spread();
      if (this.pinchDistance > 0) this.zoomAt(this.midpoint(), d / this.pinchDistance);
      this.pinchDistance = d;
      this.moved = Infinity; // a pinch is never a tap
    }
  };

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0 && p && this.moved < TAP_SLOP && e.type === 'pointerup') this.onTap(this.toMap(p));
    if (this.pointers.size < 2) this.pinchDistance = 0;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(this.local(e), Math.exp(-e.deltaY * 0.0015));
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private midpoint(): Point {
    const [a, b] = [...this.pointers.values()];
    return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }

  /** Zooms by `factor` keeping the screen point `p` fixed. */
  private zoomAt(p: Point, factor: number): void {
    const before = this.toMap(p);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.world.scale.set(this.scale);
    this.world.position.set(p.x - before.x * this.scale, p.y - before.y * this.scale);
    this.clamp();
  }

  /** Keeps at least some of the map on screen. */
  private clamp(): void {
    const { minX, minY, maxX, maxY } = this.bounds;
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const margin = 80;
    const pos = this.world.position;
    pos.x = Math.min(w - margin - minX * this.scale, Math.max(margin - maxX * this.scale, pos.x));
    pos.y = Math.min(h - margin - minY * this.scale, Math.max(margin - maxY * this.scale, pos.y));
  }
}
