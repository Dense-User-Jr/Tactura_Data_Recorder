/**
 * Session clock and the one requestAnimationFrame loop everything shares
 * (3D scene, watch screen, animations, HUD readouts).
 *
 * @typedef {(dt: number, now: number) => void} Ticker   dt in seconds (clamped), now in ms
 * @typedef {Object} Clock
 * @property {(t?: number) => number} sinceStart   ms since the session started
 * @property {(fn: Ticker) => () => void} onTick
 * @property {() => void} start
 * @property {() => void} stop
 */

/** Longest frame step handed to tickers, so a backgrounded tab doesn't teleport animations. */
const MAX_DT = 0.1;

/** @returns {Clock} */
export function createClock() {
  const t0 = performance.now();
  /** @type {Set<Ticker>} */
  const tickers = new Set();
  let raf = 0;
  let last = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, MAX_DT);
    last = now;
    for (const fn of tickers) {
      try {
        fn(dt, now);
      } catch (err) {
        console.error('[clock] ticker threw', err);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    sinceStart: (t = performance.now()) => t - t0,
    onTick(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
    start() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Session-relative timestamp in the HUD's microcopy style.
 * @param {number} ms
 * @returns {string} e.g. `T+0412ms`
 */
export function formatT(ms) {
  return `T+${String(Math.max(0, Math.round(ms))).padStart(4, '0')}ms`;
}
