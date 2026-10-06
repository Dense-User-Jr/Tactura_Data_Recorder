import { ScreenApp } from '../ScreenApp.js';
import { drawTime } from '../WatchScreen.js';
import { INK, chamferPath, clamp01, easeInOutCubic, easeOutCubic, fitFont, label } from '../draw.js';
import { layoutDots } from '../../ui/dotMatrix.js';

/**
 * The sim's own watch UI (spec §11.3): dot-matrix on true black. A stand-in
 * until the real Tactura watch UI is recreated as its own ScreenApp.
 *
 *   Boot        TACTURA assembles from scattered dots
 *   Idle        time, last words, READY, hint, a slow breathing dot
 *   Composing   bin chips along the upper arc; the top exact match with +N,
 *               or N POSSIBLE while only prefixes match
 *   Committed   the word lands in the center, a ring pulses (with the voice
 *               level once the voice exists), then it shrinks to the top line
 *   No match    red NO WORD for 600 ms with a small horizontal shake
 *
 * Reads the store's `compose` slice and the compose:* bus events.
 *
 * @typedef {import('../ScreenApp.js').ScreenApi} ScreenApi
 * @typedef {import('../../pipeline/Composer.js').ComposeState} ComposeState
 * @typedef {import('../../pipeline/types.js').BinToken} BinToken
 */

const SIZE = 480;
const C = SIZE / 2;
const SAFE_R = SIZE * 0.42; // inscribed safe circle at 84% of the diameter

const BOOT = { assemble: 800, hold: 450, pitch: 9.4, dot: 3.1 };
const COMMIT = { pop: 220, ring: 900, shrink: 320 };
const COMMIT_MS = COMMIT.pop + COMMIT.ring + COMMIT.shrink;
const NOWORD_MS = 600;
const FRESH_MS = 300;

const CHIP = { radius: 168, height: 30, gap: 0.06, maxShown: 5 };
const LAST_LINE_Y = 148;
const BREATH_MS = 3200;
const BREATH_STEPS = 24; // the breathing dot redraws in steps, not every frame

export class TacturaStarterApp extends ScreenApp {
  name = 'TACTURA STARTER';

  /** @param {ScreenApi} api */
  mount(api) {
    this.api = api;
    /** @type {'off'|'boot'|'live'} */
    this.mode = 'off';
    this.bootT = 0;
    this.clockT = 0;
    /** @type {ComposeState} */
    this.compose = api.store.get().compose;
    /** @type {{ kind: 'commit', word: string, tokens: BinToken[], t: number } | { kind: 'noword', t: number } | null} */
    this.overlay = null;
    this.freshT = Infinity;
    this.minute = -1;
    this.breath = -1;
    this.bootDots = this.#prepareBoot();

    this.unsubscribe = [
      api.store.watch(
        (s) => s.compose,
        (compose, prev) => {
          this.compose = compose;
          if (prev && compose.buffer.length > prev.buffer.length) {
            this.freshT = 0;
            if (this.overlay?.kind === 'commit') this.overlay = null; // typing on cuts the commit animation short
          }
          api.invalidate();
        },
      ),
      api.bus.on('compose:commit', ({ word, tokens }) => {
        this.overlay = { kind: 'commit', word, tokens, t: 0 };
        api.invalidate();
      }),
      api.bus.on('compose:noword', () => {
        this.overlay = { kind: 'noword', t: 0 };
        api.invalidate();
      }),
    ];
  }

  wake() {
    this.mode = 'boot';
    this.bootT = 0;
    this.api.invalidate();
  }

  unmount() {
    this.unsubscribe?.forEach((off) => off());
  }

  /** @param {number} dt seconds */
  update(dt) {
    const ms = dt * 1000;
    this.clockT += ms;
    if (this.mode === 'off') return;

    if (this.mode === 'boot') {
      this.bootT += ms;
      if (this.bootT >= BOOT.assemble + BOOT.hold) this.mode = 'live';
      this.api.invalidate();
      return;
    }

    if (this.overlay) {
      this.overlay.t += ms;
      const length = this.overlay.kind === 'commit' ? COMMIT_MS : NOWORD_MS;
      if (this.overlay.t >= length) this.overlay = null;
      this.api.invalidate();
    }
    if (this.freshT < FRESH_MS) {
      this.freshT += ms;
      this.api.invalidate();
    }

    const minute = Math.floor(Date.now() / 60000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.api.invalidate();
    }
    if (!this.compose.buffer.length && !this.overlay) {
      const step = Math.floor(((this.clockT % BREATH_MS) / BREATH_MS) * BREATH_STEPS);
      if (step !== this.breath) {
        this.breath = step;
        this.api.invalidate();
      }
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    if (this.mode === 'off') return;
    if (this.mode === 'boot') {
      this.#renderBoot(ctx);
      return;
    }
    const o = this.overlay;
    if (o?.kind === 'commit') {
      this.#renderCommit(ctx, o);
      return;
    }
    ctx.save();
    if (o?.kind === 'noword') {
      const p = o.t / NOWORD_MS;
      ctx.translate(Math.sin(o.t * 0.09) * 9 * (1 - p) ** 2, 0); // haptic-style shake, decaying
    }
    if (this.compose.buffer.length) this.#renderComposing(ctx, o?.kind === 'noword');
    else this.#renderIdle(ctx);
    ctx.restore();
  }

  // ---------- states ----------

  #prepareBoot() {
    const { cols, rows, lit } = layoutDots('TACTURA');
    const w = (cols - 1) * BOOT.pitch;
    const h = (rows - 1) * BOOT.pitch;
    const x0 = C - w / 2;
    const y0 = C - h / 2 - 10;
    const grid = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) grid.push([x0 + c * BOOT.pitch, y0 + r * BOOT.pitch]);
    const dots = lit.map(([c, r]) => {
      const tx = x0 + c * BOOT.pitch;
      const ty = y0 + r * BOOT.pitch;
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 90;
      return { tx, ty, sx: tx + Math.cos(a) * d, sy: ty + Math.sin(a) * d, delay: (c / cols) * 260 + Math.random() * 120 };
    });
    return { grid, dots, below: y0 + h + 44 };
  }

  /** @param {CanvasRenderingContext2D} ctx */
  #renderBoot(ctx) {
    const { grid, dots, below } = this.bootDots;
    ctx.fillStyle = '#161618';
    for (const [x, y] of grid) {
      ctx.beginPath();
      ctx.arc(x, y, BOOT.dot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = INK.text;
    for (const d of dots) {
      const p = clamp01((this.bootT - d.delay) / 420);
      if (p <= 0) continue;
      const e = easeOutCubic(p);
      ctx.globalAlpha = clamp01(p * 2.5);
      ctx.beginPath();
      ctx.arc(d.sx + (d.tx - d.sx) * e, d.sy + (d.ty - d.sy) * e, BOOT.dot, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = clamp01((this.bootT - BOOT.assemble) / 250);
    label(ctx, 'GESTURE TO SPEECH', C, below, { size: 14, color: INK.dim, spacing: 0.2 });
    ctx.globalAlpha = 1;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  #renderIdle(ctx) {
    drawTime(ctx, new Date(), C, 104, 40);
    this.#renderLastWords(ctx);

    ctx.fillStyle = INK.text;
    ctx.textAlign = 'center';
    ctx.font = '900 70px "Doto"';
    ctx.fillText('READY', C, 268);
    label(ctx, '1–6 GESTURE · SPACE COMMIT', C, 318, { size: 14, color: INK.dim });

    const phase = this.breath / BREATH_STEPS;
    ctx.globalAlpha = 0.25 + 0.6 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    ctx.fillStyle = INK.text;
    ctx.beginPath();
    ctx.arc(C, 370, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** @param {CanvasRenderingContext2D} ctx */
  #renderLastWords(ctx) {
    const last = this.compose.transcript.slice(-2).join(' ');
    if (!last) return;
    ctx.textAlign = 'center';
    ctx.fillStyle = INK.muted;
    fitFont(ctx, last, { maxWidth: 300, maxSize: 26, weight: 700, family: '"Doto"' });
    ctx.fillText(last, C, LAST_LINE_Y);
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {boolean} noWord
   */
  #renderComposing(ctx, noWord) {
    const { buffer, result, selected } = this.compose;
    this.#renderChips(ctx, buffer, 1, 1);
    ctx.textAlign = 'center';

    if (noWord) {
      ctx.fillStyle = INK.accent;
      ctx.font = '900 66px "Doto"';
      ctx.fillText('NO WORD', C, 268);
      label(ctx, '⌫ UNDO · ESC CLEAR', C, 396, { size: 14, color: INK.dim });
      return;
    }

    const exact = result?.exact ?? [];
    if (exact.length) {
      const word = exact[Math.min(selected, exact.length - 1)].word;
      ctx.fillStyle = INK.text;
      fitFont(ctx, word, { maxWidth: 2 * SAFE_R - 70, maxSize: 88, weight: 900, family: '"Doto"' });
      ctx.fillText(word, C, 270);
      if (exact.length > 1) {
        label(ctx, `+${exact.length - 1}  ·  TAB`, C, 316, { size: 17, color: INK.muted });
        this.#renderSelectionDots(ctx, exact.length, selected, 342);
      }
      label(ctx, 'SPACE COMMIT · ⌫ UNDO', C, 396, { size: 14, color: INK.dim });
      return;
    }

    const possible = result?.prefixCount ?? 0;
    if (possible > 0) {
      ctx.fillStyle = INK.text;
      ctx.font = '900 84px "Doto"';
      ctx.fillText(String(possible), C, 262);
      label(ctx, 'POSSIBLE', C, 300, { size: 16, color: INK.muted, spacing: 0.25 });
      const preview = (result?.prefixPreview ?? []).map((c) => c.word).join(' · ');
      if (preview) label(ctx, preview, C, 336, { size: 16, color: INK.dim, spacing: 0.04 });
    } else {
      ctx.fillStyle = INK.dim;
      ctx.font = '900 54px "Doto"';
      ctx.fillText('NO MATCH', C, 264);
      label(ctx, 'NO WORD STARTS THIS WAY', C, 304, { size: 13, color: INK.dim });
    }
    label(ctx, '⌫ UNDO · ESC CLEAR', C, 396, { size: 14, color: INK.dim });
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ kind: 'commit', word: string, tokens: BinToken[], t: number }} o
   */
  #renderCommit(ctx, o) {
    const t = o.t;
    // 1. the buffer chips fly into the center slot and fade
    if (t < COMMIT.pop) {
      const p = easeInOutCubic(t / COMMIT.pop);
      this.#renderChips(ctx, o.tokens, 1 - p, 1 - p * 0.6);
    }

    ctx.textAlign = 'center';
    const bigSize = (() => {
      ctx.save();
      const s = fitFont(ctx, o.word, { maxWidth: 2 * SAFE_R - 70, maxSize: 96, weight: 900, family: '"Doto"' });
      ctx.restore();
      return s;
    })();

    const shrinkStart = COMMIT.pop + COMMIT.ring;
    if (t < shrinkStart) {
      // 2. the word lands in the center
      const p = clamp01(t / COMMIT.pop);
      const scale = 0.84 + 0.16 * easeOutCubic(p);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * p;
      ctx.translate(C, 270);
      ctx.scale(scale, scale);
      ctx.fillStyle = INK.text;
      ctx.font = `900 ${bigSize}px "Doto"`;
      ctx.fillText(o.word, 0, 0);
      ctx.restore();

      // 3. the speaking ring: the voice level once the voice exists, a single soft pulse until then
      const ringT = t - COMMIT.pop;
      if (ringT > 0) {
        const voice = this.api.voiceLevel();
        const level = voice > 0 ? voice : Math.sin(Math.PI * clamp01(ringT / COMMIT.ring)) * 0.8;
        ctx.strokeStyle = INK.text;
        ctx.globalAlpha = 0.15 + 0.75 * level;
        ctx.lineWidth = 1.5 + 4 * level;
        ctx.beginPath();
        ctx.arc(C, C, 214, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      return;
    }

    // 4. the word shrinks into the top line
    const p = easeInOutCubic(clamp01((t - shrinkStart) / COMMIT.shrink));
    const size = bigSize + (26 - bigSize) * p;
    const y = 270 + (LAST_LINE_Y - 270) * p;
    ctx.fillStyle = mix(INK.text, INK.muted, p);
    ctx.font = `${p < 0.5 ? 900 : 700} ${size}px "Doto"`;
    ctx.fillText(o.word, C, y);
  }

  // ---------- pieces ----------

  /**
   * Bin chips along the upper safe arc, newest on the right. `pull` 1 = on
   * the arc, 0 = collapsed to the center (the commit animation).
   * @param {CanvasRenderingContext2D} ctx
   * @param {BinToken[]} tokens
   * @param {number} pull
   * @param {number} alpha
   */
  #renderChips(ctx, tokens, pull, alpha) {
    let labels = tokens.map((t) => t.phonemes.join('/'));
    if (labels.length > CHIP.maxShown) {
      const keep = CHIP.maxShown - 1;
      labels = [`+${labels.length - keep}`, ...labels.slice(-keep)];
    }
    ctx.save();
    ctx.font = '400 17px "Space Mono"';
    const widths = labels.map((l) => ctx.measureText(l).width + 22);
    const arcs = widths.map((w) => w / CHIP.radius);
    const total = arcs.reduce((a, b) => a + b, 0) + CHIP.gap * (labels.length - 1);
    let angle = -Math.PI / 2 - total / 2;
    const radius = CHIP.radius * pull;

    labels.forEach((text, i) => {
      const mid = angle + arcs[i] / 2;
      angle += arcs[i] + CHIP.gap;
      const isNewest = i === labels.length - 1;
      const isOverflow = text.startsWith('+') && i === 0 && tokens.length > CHIP.maxShown;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(C + Math.cos(mid) * radius, C + Math.sin(mid) * radius);
      ctx.rotate(mid + Math.PI / 2);
      const w = widths[i];
      chamferPath(ctx, -w / 2, -CHIP.height / 2, w, CHIP.height, 7);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isNewest && this.freshT < FRESH_MS ? INK.accent : isNewest ? INK.muted : INK.lineStrong;
      ctx.stroke();
      ctx.fillStyle = isOverflow ? INK.dim : INK.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    });
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} count
   * @param {number} selected
   * @param {number} y
   */
  #renderSelectionDots(ctx, count, selected, y) {
    const gap = 14;
    const x0 = C - ((count - 1) * gap) / 2;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = i === selected ? INK.text : INK.lineStrong;
      ctx.beginPath();
      ctx.arc(x0 + i * gap, y, i === selected ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Blend two #RRGGBB colors. @param {string} a @param {string} b @param {number} t */
function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
