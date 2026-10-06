import * as THREE from 'three';

export const SCREEN_SIZE = 480;

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The watch's round 480 × 480 display (spec §11.1). Owns an offscreen 2D
 * canvas that is both the display mesh's texture and the source for the HUD
 * screen mirror. After each redraw it emits `screen:frame` with the canvas.
 *
 * Hosts exactly one ScreenApp at a time (spec §11.2). With no app mounted it
 * shows a built-in standby clock.
 *
 * @typedef {import('./ScreenApp.js').ScreenApp} ScreenApp
 */
export class WatchScreen {
  /** @param {{ bus: import('../core/eventBus.js').EventBus, store: import('../core/store.js').Store<any> }} deps */
  constructor({ bus, store }) {
    this.bus = bus;
    this.store = store;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SCREEN_SIZE;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.lastMinute = -1;
    /** @type {ScreenApp | null} */
    this.app = null;
    this.dirty = true;
    /** Speech output level 0..1; the voice engine (Phase 4) sets this. */
    this.voiceLevel = () => 0;
  }

  /** @param {ScreenApp} app */
  setApp(app) {
    this.app?.unmount();
    this.app = app;
    app.mount({
      store: this.store,
      bus: this.bus,
      size: SCREEN_SIZE,
      invalidate: () => {
        this.dirty = true;
      },
      voiceLevel: () => this.voiceLevel(),
    });
    this.dirty = true;
  }

  /** The display just turned on: let the app play its boot. */
  wake() {
    this.app?.wake();
  }

  /** @param {number} dt seconds. Call every frame; redraws only when something changed. */
  update(dt = 0) {
    if (!this.app) {
      this.#updateStandby();
      return;
    }
    this.app.update(dt);
    if (!this.dirty) return;
    this.dirty = false;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_SIZE, SCREEN_SIZE);
    ctx.beginPath();
    ctx.arc(SCREEN_SIZE / 2, SCREEN_SIZE / 2, SCREEN_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      this.app.render(ctx);
    } catch (err) {
      console.error('[screen] app render failed', err);
    }
    ctx.restore();
    this.#publish();
  }

  #publish() {
    this.texture.needsUpdate = true;
    this.bus.emit('screen:frame', this.canvas);
  }

  #updateStandby() {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.#drawStandby(now);
    this.#publish();
  }

  /** @param {Date} now */
  #drawStandby(now) {
    const { ctx } = this;
    const c = SCREEN_SIZE / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_SIZE, SCREEN_SIZE);

    // minute track: 60 dots, hours brighter, the current minute lit
    const current = now.getMinutes();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const hour = i % 5 === 0;
      ctx.fillStyle = i === current ? '#F4F4F1' : hour ? '#55555C' : '#2A2A2F';
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 222, c + Math.sin(a) * 222, hour || i === current ? 3.4 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8C8C93';
    ctx.font = '400 22px "Space Mono"';
    ctx.fillText(`${DAYS[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}`, c, 168);
    drawTime(ctx, now, c, 290, 118);
    ctx.fillStyle = '#55555C';
    ctx.font = '400 16px "Space Mono"';
    ctx.fillText('TACTURA SIM', c, 352);
  }
}

/**
 * HH:MM in Doto with the colon drawn as two dots (Doto's heavy colon reads
 * as a smudge at display sizes).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Date} now
 * @param {number} cx center x
 * @param {number} baseline
 * @param {number} size font px
 * @param {string} [color]
 */
export function drawTime(ctx, now, cx, baseline, size, color = '#F4F4F1') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px "Doto"`;
  ctx.textAlign = 'left';
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const gap = size * 0.3;
  const wH = ctx.measureText(hh).width;
  const wM = ctx.measureText(mm).width;
  const left = cx - (wH + gap + wM) / 2;
  ctx.fillText(hh, left, baseline);
  ctx.fillText(mm, left + wH + gap, baseline);
  const r = size * 0.055;
  for (const k of [0.575, 0.2]) {
    ctx.beginPath();
    ctx.arc(left + wH + gap / 2, baseline - size * k, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
