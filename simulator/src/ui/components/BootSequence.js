import { h } from '../dom.js';
import { layoutDots } from '../dotMatrix.js';

/**
 * @typedef {'ok'|'muted'|'error'} LineTone
 * @typedef {string | { value: string, tone?: LineTone }} StepResult   a bare string means tone 'ok'
 */

const PITCH = 12; // px between dot centers
const DOT_R = 3.4;
const PAD = 56; // canvas overhang so scattered dots can start outside the wordmark
const UNLIT_ALPHA = 0.08;
const LINE_GAP_MS = 110; // minimum spacing between log lines so each one is readable
const HOLD_MS = 280;
const FADE_MS = 360;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));

/**
 * Startup screen (spec §6.1): the dot-matrix wordmark assembles while the real
 * init steps run, each one ticking on as a log line with its actual result.
 * A failing step shows ERROR and boot continues; nothing here blocks the sim.
 */
export class BootSequence {
  /**
   * @param {HTMLElement} root
   * @param {{ version: string, reducedMotion: boolean }} options
   */
  constructor(root, { version, reducedMotion }) {
    this.root = root;
    this.reducedMotion = reducedMotion;
    /** @type {Array<{ label: string, error: Error }>} */
    this.errors = [];
    this.startedAt = performance.now();
    this.lastLineAt = 0;

    this.layout = layoutDots('TACTURA');
    this.width = this.layout.cols * PITCH;
    this.height = this.layout.rows * PITCH;
    this.dots = this.layout.lit.map(([c, r]) => {
      const tx = PAD + c * PITCH + PITCH / 2;
      const ty = PAD + r * PITCH + PITCH / 2;
      const angle = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 72;
      return {
        tx,
        ty,
        sx: tx + Math.cos(angle) * dist,
        sy: ty + Math.sin(angle) * dist,
        delay: (c / this.layout.cols) * 220 + Math.random() * 100,
        dur: 380 + Math.random() * 100,
      };
    });
    this.assembleMs = reducedMotion ? 0 : Math.max(...this.dots.map((d) => d.delay + d.dur));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = this.width + PAD * 2;
    const ch = this.height + PAD * 2;
    this.canvas = h('canvas', {
      class: 'boot__mark',
      width: Math.round(cw * dpr),
      height: Math.round(ch * dpr),
      style: { width: `${cw}px`, height: `${ch}px`, margin: `${-PAD}px` },
      'aria-label': 'Tactura',
      role: 'img',
    });
    this.ctx = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.ctx.scale(dpr, dpr);

    this.log = h('ol', { class: 'boot__log label' });
    this.inner = h(
      'div',
      { class: 'boot__inner', style: { width: `${this.width}px` } },
      this.canvas,
      h('div', { class: 'boot__sub label' }, h('span', {}, 'Watch simulator'), h('span', { class: 'dim nocase' }, `v${version}`)),
      h('div', { class: 'boot__rule' }),
      this.log,
    );
    root.append(this.inner);
  }

  start() {
    this.startedAt = performance.now();
    const frame = () => {
      const t = performance.now() - this.startedAt;
      this.#draw(t);
      if (t < this.assembleMs) requestAnimationFrame(frame);
    };
    frame();
  }

  /**
   * Runs one init step and logs its outcome as `LABEL ........ VALUE`.
   * @param {string} label
   * @param {() => StepResult | Promise<StepResult>} run
   * @returns {Promise<boolean>} false if the step threw
   */
  async step(label, run) {
    const wait = this.lastLineAt + LINE_GAP_MS - performance.now();
    if (!this.reducedMotion && wait > 0) await sleep(wait);

    let value;
    let tone;
    let ok = true;
    try {
      const result = await run();
      ({ value, tone = 'ok' } = typeof result === 'string' ? { value: result } : result);
    } catch (err) {
      console.error(`[boot] ${label} failed`, err);
      this.errors.push({ label, error: err instanceof Error ? err : new Error(String(err)) });
      value = 'ERROR';
      tone = 'error';
      ok = false;
    }

    this.log.append(
      h(
        'li',
        { class: 'boot__line' },
        h('span', {}, label),
        h('span', { class: 'boot__leader' }),
        // values are passed in already cased (`OK`, `WEBGL2`, `T+0412ms`)
        h('span', { class: 'boot__v nocase', dataset: { tone } }, value),
      ),
    );
    // text stays hidden until the first step (fonts) lands, so it never flashes in a fallback face
    this.inner.classList.add('has-text');
    this.lastLineAt = performance.now();
    return ok;
  }

  /** Waits for the wordmark to finish, holds briefly, then fades the boot screen out. */
  async finish() {
    if (!this.reducedMotion) {
      const remaining = this.startedAt + this.assembleMs - performance.now();
      await sleep(Math.max(remaining, 0) + HOLD_MS);
    }
    this.root.classList.add('is-done');
    await sleep(this.reducedMotion ? 0 : FADE_MS);
    this.root.hidden = true;
  }

  /** @param {number} t ms since start */
  #draw(t) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.width + PAD * 2, this.height + PAD * 2);

    ctx.fillStyle = `rgba(244, 244, 241, ${UNLIT_ALPHA})`;
    for (let c = 0; c < this.layout.cols; c++) {
      for (let r = 0; r < this.layout.rows; r++) {
        ctx.beginPath();
        ctx.arc(PAD + c * PITCH + PITCH / 2, PAD + r * PITCH + PITCH / 2, DOT_R, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#F4F4F1';
    for (const d of this.dots) {
      const p = this.reducedMotion ? 1 : Math.min(Math.max((t - d.delay) / d.dur, 0), 1);
      if (p <= 0) continue;
      const e = easeOutExpo(p);
      ctx.globalAlpha = Math.min(1, p * 2.5);
      ctx.beginPath();
      ctx.arc(d.sx + (d.tx - d.sx) * e, d.sy + (d.ty - d.sy) * e, DOT_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
