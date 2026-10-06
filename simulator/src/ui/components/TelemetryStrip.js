import { h } from '../dom.js';

/**
 * Dock row 05 / TELEMETRY (spec §12): live SYNTHETIC accel and gyro from the
 * animation, as six single-channel stat tiles (small multiples, so each
 * trace is named by its tile, never told apart by color). Fixed ±20 scales
 * so tiles compare honestly; a hairline zero line; the newest sample dotted.
 * Hovering a trace snaps a crosshair to the nearest sample and shows its
 * value and age.
 *
 * @typedef {import('../../telemetry/SyntheticImu.js').SyntheticImu} SyntheticImu
 * @typedef {import('../../telemetry/SyntheticImu.js').Channel} Channel
 */

const TILES = /** @type {const} */ ([
  { channel: 'ax', label: 'ACCEL X', unit: 'm/s²', range: 20 },
  { channel: 'ay', label: 'ACCEL Y', unit: 'm/s²', range: 20 },
  { channel: 'az', label: 'ACCEL Z', unit: 'm/s²', range: 20 },
  { channel: 'gx', label: 'GYRO X', unit: 'rad/s', range: 20 },
  { channel: 'gy', label: 'GYRO Y', unit: 'rad/s', range: 20 },
  { channel: 'gz', label: 'GYRO Z', unit: 'rad/s', range: 20 },
]);

const INK = { line: '#8C8C93', zero: '#2A2A2F', dot: '#F4F4F1', cross: '#55555C' };
const FLAT = 1e-4;

/** @param {number} v */
const signed = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`;

export class TelemetryStrip {
  constructor() {
    this.tiles = TILES.map((t) => {
      const value = h('span', { class: 'tele__value' }, '+0.00');
      const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'tele__plot', 'aria-hidden': 'true' }));
      const el = h(
        'div',
        { class: 'tele', title: `${t.label} (${t.unit}), synthetic, last 3 s, scale ±${t.range}` },
        h('div', { class: 'tele__head' }, h('span', { class: 'label' }, t.label), value, h('span', { class: 'label dim nocase' }, t.unit)),
        canvas,
      );
      const tile = { ...t, el, canvas, value, ctx: /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), drawnFlat: NaN };
      canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        this.hover = { channel: t.channel, x: (e.clientX - rect.left) / rect.width };
        this.force = true;
      });
      canvas.addEventListener('pointerleave', () => {
        this.hover = null;
        this.force = true;
      });
      return tile;
    });

    this.offNote = h('span', { class: 'label dim' }, 'OFF · TURN ON IN SETTINGS');
    this.el = h('div', { class: 'telemetry' }, this.tiles.map((t) => t.el), this.offNote);
    this.aside = h(
      'div',
      { class: 'dock__aside label' },
      h('span', { class: 'tag tag--synthetic chamfer', title: 'Derived from the animation, not from a sensor. Never use it to train or evaluate a classifier.' }, 'SYNTHETIC'),
      h('span', { class: 'dim' }, '50 HZ · 3 S'),
    );
    /** @type {{ channel: Channel, x: number } | null} */
    this.hover = null;
    this.force = true;
    this.lastVersion = -1;
    this.enabled = true;

    new ResizeObserver(() => {
      for (const t of this.tiles) t.drawnFlat = NaN;
      this.force = true;
    }).observe(this.el);
  }

  /** @param {boolean} on */
  setEnabled(on) {
    this.enabled = on;
    this.el.classList.toggle('is-off', !on);
    this.aside.hidden = !on;
    this.force = true;
  }

  /** Redraw what changed. Call once per frame. @param {SyntheticImu} imu */
  render(imu) {
    if (!this.enabled) return;
    if (imu.version === this.lastVersion && !this.force) return;
    this.lastVersion = imu.version;
    const force = this.force;
    this.force = false;
    for (const tile of this.tiles) this.#drawTile(tile, imu, force);
  }

  /**
   * @param {typeof this.tiles[number]} tile
   * @param {SyntheticImu} imu
   * @param {boolean} force
   */
  #drawTile(tile, imu, force) {
    const data = imu.series(tile.channel);
    if (!data.length) return;
    const latest = data[data.length - 1];
    const hovering = this.hover?.channel === tile.channel;

    // a flat trace that is already on screen doesn't need repainting
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const flat = hi - lo < FLAT && data.length === imu.capacity;
    if (flat && !hovering && !force && Math.abs(tile.drawnFlat - latest) < FLAT) return;
    tile.drawnFlat = flat ? latest : NaN;

    const { canvas, ctx } = tile;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    ctx.clearRect(0, 0, w, hgt);

    const mid = hgt / 2;
    const pad = 3 * dpr;
    const yOf = (v) => mid - (Math.max(-tile.range, Math.min(tile.range, v)) / tile.range) * (mid - pad);
    const right = w - 4 * dpr; // room for the newest-sample dot
    const step = right / (imu.capacity - 1);
    const x0 = right - (data.length - 1) * step; // newest sample sits at the right

    ctx.strokeStyle = INK.zero;
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(w, Math.round(mid) + 0.5);
    ctx.stroke();

    ctx.strokeStyle = INK.line;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x0 + i * step, yOf(v)) : ctx.moveTo(x0, yOf(v))));
    ctx.stroke();

    let shown = latest;
    let ageLabel = '';
    let markX = x0 + (data.length - 1) * step;
    if (hovering && this.hover) {
      const i = Math.max(0, Math.min(data.length - 1, Math.round((this.hover.x * w - x0) / step)));
      shown = data[i];
      markX = x0 + i * step;
      const age = ((data.length - 1 - i) * 20) / 1000;
      ageLabel = age > 0 ? ` −${age.toFixed(2)}s` : '';
      ctx.strokeStyle = INK.cross;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(Math.round(markX) + 0.5, 0);
      ctx.lineTo(Math.round(markX) + 0.5, hgt);
      ctx.stroke();
    }
    ctx.fillStyle = INK.dot;
    ctx.beginPath();
    ctx.arc(markX, yOf(shown), 2.5 * dpr, 0, Math.PI * 2);
    ctx.fill();

    tile.value.textContent = signed(shown) + ageLabel;
  }
}
