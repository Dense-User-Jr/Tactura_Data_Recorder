import { h } from '../dom.js';

const SIZE = 480;

/**
 * Crisp 2D copy of the watch screen canvas (spec §7.3), so the display stays
 * readable at any camera angle. Same pixels, full resolution, clipped round by CSS.
 */
export class ScreenMirror {
  constructor() {
    this.canvas = /** @type {HTMLCanvasElement} */ (
      h('canvas', { class: 'mirror__canvas', width: SIZE, height: SIZE, 'aria-label': 'Watch screen mirror', role: 'img' })
    );
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
  }

  /** @param {HTMLCanvasElement} source the WatchScreen canvas */
  draw(source) {
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(source, 0, 0, SIZE, SIZE);
  }
}
