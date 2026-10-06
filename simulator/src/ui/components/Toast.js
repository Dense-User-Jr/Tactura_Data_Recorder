import { h } from '../dom.js';

/**
 * @typedef {Object} ToastOptions
 * @property {'info'|'error'} [tone]
 * @property {string} [detail]   secondary line, e.g. the caught error message
 * @property {number} [ms]       auto-dismiss delay
 */

const MAX_VISIBLE = 3;
const DEFAULT_MS = 2500;
const LEAVE_MS = 400;

/**
 * Bottom-center chamfered notices for fallbacks and errors.
 * Anything can raise one with `bus.emit('toast', { message, ...options })`.
 * A toast identical to one already showing (say, the same stage failing on
 * every gesture) refreshes that one instead of stacking a copy.
 * @param {HTMLElement} root
 */
export function createToaster(root) {
  /** @type {Map<string, { el: HTMLElement, timer: number }>} */
  const live = new Map();

  /**
   * @param {string} message
   * @param {ToastOptions} [options]
   */
  function show(message, { tone = 'info', detail, ms = DEFAULT_MS } = {}) {
    const key = `${tone}|${message}|${detail ?? ''}`;
    const existing = live.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = window.setTimeout(() => dismiss(key), ms);
      return;
    }

    const el = h(
      'div',
      { class: `toast toast--${tone} chamfer label`, role: tone === 'error' ? 'alert' : 'status', title: detail },
      h('span', { class: 'toast__tag' }, tone === 'error' ? 'ERR' : 'SYS'),
      h('span', { class: 'toast__msg' }, message),
      detail && h('span', { class: 'toast__detail' }, detail),
    );
    root.append(el);
    live.set(key, { el, timer: window.setTimeout(() => dismiss(key), ms) });
    while (root.children.length > MAX_VISIBLE) {
      const oldest = [...live.entries()].find(([, t]) => t.el === root.firstElementChild);
      if (oldest) dismiss(oldest[0], true);
      else root.firstElementChild?.remove();
    }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  }

  /** @param {string} key @param {boolean} [now] */
  function dismiss(key, now = false) {
    const toast = live.get(key);
    if (!toast) return;
    live.delete(key);
    clearTimeout(toast.timer);
    if (now) {
      toast.el.remove();
      return;
    }
    toast.el.classList.remove('is-in');
    window.setTimeout(() => toast.el.remove(), LEAVE_MS);
  }

  return { show };
}
