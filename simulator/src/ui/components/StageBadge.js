import { h } from '../dom.js';

/**
 * Visual tone of a badge. `project` / `stand-in` / `error` mirror
 * StageStatus.mode; `pending` covers "not loaded yet" and "not built yet".
 * @typedef {'project'|'stand-in'|'error'|'pending'} BadgeTone
 */

/**
 * @typedef {Object} BadgeState
 * @property {string} label     short key, e.g. `CLS`
 * @property {string} value     e.g. `STAND-IN`, `LOADING 42%`
 * @property {BadgeTone} tone
 * @property {string} [reason]  shown on hover / click, e.g. "project model not configured"
 */

let nextId = 0;

/**
 * Small chamfered chip in the top bar, e.g. `CLS: STAND-IN`. Hover or click
 * reveals why the stage is in that mode. The tooltip lives outside the
 * clipped chip so the chamfer doesn't cut it off.
 */
export class StageBadge {
  /** @param {BadgeState} state */
  constructor(state) {
    const tipId = `badge-tip-${nextId++}`;
    this.key = h('span', { class: 'badge__k' });
    this.value = h('span', { class: 'badge__v' });
    this.button = h('button', { class: 'badge chamfer', type: 'button', 'aria-describedby': tipId }, this.key, this.value);
    this.tipHead = h('div', { class: 'badge__tip-head label' });
    this.tipBody = h('p', { class: 'badge__tip-body' });
    this.tip = h('div', { class: 'badge__tip chamfer', role: 'tooltip', id: tipId }, this.tipHead, this.tipBody);
    this.el = h('span', { class: 'badge-wrap' }, this.button, this.tip);

    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.classList.toggle('is-pinned');
    });
    document.addEventListener('click', () => this.el.classList.remove('is-pinned'));

    this.set(state);
  }

  /** @param {BadgeState} state */
  set({ label, value, tone, reason }) {
    this.key.textContent = `${label}:`;
    this.value.textContent = value;
    this.button.dataset.tone = tone;
    this.tipHead.replaceChildren(h('span', {}, label), h('span', { class: 'dim' }, tone.toUpperCase()));
    this.tipBody.textContent = reason ?? '';
  }
}
