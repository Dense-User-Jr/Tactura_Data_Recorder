import { h } from '../dom.js';

/**
 * @typedef {Object} ToastOptions
 * @property {'info'|'error'} [tone]
 * @property {string} [detail]   secondary line, e.g. the caught error message
 * @property {number} [ms]       auto-dismiss delay
 */

const MAX_VISIBLE = 3;
const DEFAULT_MS = 2500;

/**
 * Bottom-center chamfered notices for fallbacks and errors.
 * Anything can raise one with `bus.emit('toast', { message, ...options })`.
 * @param {HTMLElement} root
 */
export function createToaster(root) {
  /**
   * @param {string} message
   * @param {ToastOptions} [options]
   */
  function show(message, { tone = 'info', detail, ms = DEFAULT_MS } = {}) {
    const el = h(
      'div',
      { class: `toast toast--${tone} chamfer label`, role: tone === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast__tag' }, tone === 'error' ? 'ERR' : 'SYS'),
      h('span', { class: 'toast__msg' }, message),
      detail && h('span', { class: 'toast__detail' }, detail),
    );
    root.append(el);
    while (root.children.length > MAX_VISIBLE) root.firstElementChild?.remove();

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  return { show };
}
