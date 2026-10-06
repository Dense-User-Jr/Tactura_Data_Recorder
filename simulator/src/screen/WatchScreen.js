import * as THREE from 'three';

export const SCREEN_SIZE = 480;

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The watch's round 480 × 480 display (spec §11.1). Owns an offscreen 2D
 * canvas that is both the display mesh's texture and the source for the HUD
 * screen mirror. After each redraw it emits `screen:frame` with the canvas.
 *
 * Phase 1: no ScreenApp yet, so it shows a built-in standby clock.
 * Phase 3 adds app hosting (TacturaStarterApp) on top of this.
 */
export class WatchScreen {
  /** @param {{ bus: import('../core/eventBus.js').EventBus }} deps */
  constructor({ bus }) {
    this.bus = bus;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SCREEN_SIZE;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.lastMinute = -1;
  }

  /** Call every frame; only redraws when the content changes. */
  update() {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    this.#drawStandby(now);
    this.texture.needsUpdate = true;
    this.bus.emit('screen:frame', this.canvas);
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
    setSpacing(ctx, '4px');
    ctx.fillStyle = '#8C8C93';
    ctx.font = '400 22px "Space Mono"';
    ctx.fillText(`${DAYS[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}`, c, 168);

    // time, with the colon drawn as two dots (Doto's heavy colon reads as a smudge at this size)
    setSpacing(ctx, '0px');
    ctx.fillStyle = '#F4F4F1';
    ctx.font = '900 118px "Doto"';
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const gap = 36;
    const wH = ctx.measureText(hh).width;
    const wM = ctx.measureText(mm).width;
    const left = c - (wH + gap + wM) / 2;
    ctx.textAlign = 'left';
    ctx.fillText(hh, left, 290);
    ctx.fillText(mm, left + wH + gap, 290);
    for (const y of [222, 266]) {
      ctx.beginPath();
      ctx.arc(left + wH + gap / 2, y, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';

    setSpacing(ctx, '4px');
    ctx.fillStyle = '#55555C';
    ctx.font = '400 16px "Space Mono"';
    ctx.fillText('TACTURA SIM', c, 352);
    setSpacing(ctx, '0px');
  }
}

/** Canvas letterSpacing where supported (Chromium, recent Safari/Firefox). */
function setSpacing(ctx, value) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = value;
}
