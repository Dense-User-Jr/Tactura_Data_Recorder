import { h, panelHead } from './dom.js';
import { StageBadge } from './components/StageBadge.js';
import { isShortcutEvent } from '../core/keyboard.js';

/**
 * @typedef {import('./components/StageBadge.js').BadgeState} BadgeState
 * @typedef {Object} HudState
 * @property {{ leftRail: boolean, rightRail: boolean }} ui
 * @property {{ source: string }} input
 * @property {Record<string, BadgeState>} badges   rendered in insertion order
 * @property {{ fps: number, dpr: number, gl: string }} perf
 */

const GEAR_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
  <circle cx="8" cy="8" r="2.1"/><circle cx="8" cy="8" r="4.6"/>
  <path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15M3.05 3.05l1.7 1.7M11.25 11.25l1.7 1.7M3.05 12.95l1.7-1.7M11.25 4.75l1.7-1.7"/>
</svg>`;

/**
 * The HUD frame (spec §6.2): top bar, left rail (01 gestures), right rail
 * (02 screen, 03 trace), dock (04 transcript, 05 telemetry), and the
 * click-through stage over the full-bleed 3D viewport.
 *
 * Phase 0 renders the frame with honest placeholders; later phases fill
 * the panels in.
 */
export class Hud {
  /**
   * @param {{ root: HTMLElement, store: import('../core/store.js').Store<HudState>, bus: import('../core/eventBus.js').EventBus, version: string }} deps
   */
  constructor({ root, store, bus, version }) {
    this.root = root;
    this.store = store;
    this.bus = bus;
    /** @type {Map<string, StageBadge>} */
    this.badges = new Map();

    root.append(this.#topbar(version), this.#leftRail(), this.#stage(), this.#rightRail(), this.#dock());

    store.watch((s) => s.ui, (ui) => {
      root.dataset.left = ui.leftRail ? 'open' : 'closed';
      root.dataset.right = ui.rightRail ? 'open' : 'closed';
    });
    store.watch((s) => s.badges, (badges) => this.#renderBadges(badges));
    store.watch((s) => s.input, (input) => {
      this.inputValue.textContent = input.source.toUpperCase();
    });
    store.watch((s) => s.perf, (perf) => {
      this.readout.textContent =
        perf.gl === 'ERROR' ? 'GL: ERROR' : `FPS ${String(perf.fps).padStart(2, '0')} · DPR ${perf.dpr.toFixed(1)} · ${perf.gl}`;
    });

    window.addEventListener('keydown', (e) => this.#onKey(e));
  }

  /** Fades the frame in once boot is done. */
  reveal() {
    this.root.classList.add('is-ready');
  }

  /** @param {'leftRail'|'rightRail'} which */
  toggleRail(which) {
    this.store.update((s) => ({ ...s, ui: { ...s.ui, [which]: !s.ui[which] } }));
  }

  /** @param {KeyboardEvent} e */
  #onKey(e) {
    if (e.repeat || !isShortcutEvent(e)) return;
    if (e.key === '[') this.toggleRail('leftRail');
    else if (e.key === ']') this.toggleRail('rightRail');
    else if (e.key === '?' || e.key === 'h' || e.key === 'H') this.#notBuilt('Help overlay');
    else return;
    e.preventDefault();
  }

  /** @param {string} what */
  #notBuilt(what) {
    this.bus.emit('toast', { message: `${what} not built yet`, detail: 'Arrives in Phase 5.' });
  }

  /** @param {Record<string, BadgeState>} badges */
  #renderBadges(badges) {
    for (const [id, state] of Object.entries(badges)) {
      let badge = this.badges.get(id);
      if (!badge) {
        badge = new StageBadge(state);
        this.badges.set(id, badge);
        this.badgeRow.append(badge.el);
      } else {
        badge.set(state);
      }
    }
  }

  #topbar(version) {
    this.badgeRow = h('div', { class: 'badges' });
    this.inputValue = h('b');
    return h(
      'header',
      { class: 'topbar' },
      h(
        'div',
        { class: 'wordmark' },
        h('span', { class: 'wordmark__mark' }, 'TACTURA'),
        h('span', { class: 'wordmark__sub label' }, '/ SIM'),
      ),
      h('span', { class: 'topbar__sep' }),
      h(
        'div',
        { class: 'topbar__meta label' },
        h('span', { class: 'nocase' }, `v${version}`),
        h('span', {}, 'INPUT: ', this.inputValue),
      ),
      h('div', { class: 'topbar__spacer' }),
      this.badgeRow,
      h('span', { class: 'topbar__sep' }),
      h(
        'div',
        { class: 'topbar__actions' },
        h('button', {
          class: 'icon-btn chamfer',
          type: 'button',
          title: 'Settings',
          'aria-label': 'Settings',
          html: GEAR_SVG,
          onClick: () => this.#notBuilt('Settings panel'),
        }),
        h(
          'button',
          {
            class: 'icon-btn chamfer',
            type: 'button',
            title: 'Help (?)',
            'aria-label': 'Help',
            onClick: () => this.#notBuilt('Help overlay'),
          },
          '?',
        ),
      ),
    );
  }

  #railToggle(key, which, label) {
    return h(
      'button',
      { class: 'rail-toggle', type: 'button', title: `Collapse (${key})`, 'aria-label': `Collapse ${label}`, onClick: () => this.toggleRail(which) },
      h('kbd', {}, key),
    );
  }

  #railTab(key, which, text) {
    return h(
      'button',
      { class: 'rail__tab', type: 'button', title: `Expand (${key})`, 'aria-label': `Expand ${text}`, onClick: () => this.toggleRail(which) },
      h('kbd', {}, key),
      h('span', { class: 'rail__tab-text label' }, text),
    );
  }

  #leftRail() {
    const skeleton = [1, 2, 3, 4, 5, 6].map((n) =>
      h(
        'div',
        { class: 'tile-skel chamfer', 'aria-hidden': 'true' },
        h('span', { class: 'tile-skel__num' }, String(n)),
        h(
          'span',
          { class: 'tile-skel__lines' },
          h('span', { class: 'skel-bar', style: { width: `${64 + ((n * 23) % 40)}px` } }),
          h('span', { class: 'skel-bar', style: { width: '44px' } }),
        ),
      ),
    );
    return h(
      'aside',
      { class: 'rail rail--left' },
      h(
        'div',
        { class: 'rail__inner' },
        h(
          'section',
          { class: 'panel panel--grow' },
          panelHead('01', 'GESTURES', this.#railToggle('[', 'leftRail', 'gestures rail')),
          h('div', { class: 'panel__body deck' }, skeleton),
          h('div', { class: 'empty label' }, 'INPUT NOT WIRED'),
        ),
      ),
      this.#railTab('[', 'leftRail', '01 / GESTURES'),
    );
  }

  #rightRail() {
    return h(
      'aside',
      { class: 'rail rail--right' },
      h(
        'div',
        { class: 'rail__inner' },
        h(
          'section',
          { class: 'panel' },
          panelHead('02', 'SCREEN', this.#railToggle(']', 'rightRail', 'screen and trace rail')),
          h(
            'div',
            { class: 'panel__body' },
            h(
              'div',
              { class: 'mirror-frame' },
              h('div', { class: 'mirror' }, h('span', { class: 'mirror__msg label' }, 'NO SIGNAL')),
            ),
            h('div', { class: 'mirror-meta label dim' }, h('span', {}, '480 × 480'), h('span', {}, 'APP: NONE')),
          ),
        ),
        h(
          'section',
          { class: 'panel panel--grow' },
          panelHead('03', 'TRACE', 'LAST 8'),
          h(
            'div',
            { class: 'trace-head label' },
            h('span', {}, 'T+MS'),
            h('span', {}, 'GESTURE ▸ BIN'),
            h('span', {}, 'PH'),
            h('span', {}, 'N'),
          ),
          h('div', { class: 'empty label' }, 'NO EVENTS'),
        ),
      ),
      this.#railTab(']', 'rightRail', '02 / SCREEN · 03 / TRACE'),
    );
  }

  #stage() {
    this.readout = h('div', { class: 'stage__readout label' });
    this.toastRoot = h('div', { class: 'toasts', 'aria-live': 'polite' });
    return h(
      'div',
      { class: 'stage' },
      ['tl', 'tr', 'bl', 'br'].map((corner) => h('span', { class: `stage__mark stage__mark--${corner}` })),
      h(
        'div',
        { class: 'stage__label label' },
        h('span', { class: 'panel__num' }, '00'),
        h('span', { class: 'panel__sep' }, '/'),
        h('span', {}, 'VIEWPORT'),
      ),
      this.readout,
      this.toastRoot,
    );
  }

  #dock() {
    const dockLabel = (num, name) =>
      h(
        'div',
        { class: 'dock__label label' },
        h('span', { class: 'panel__num' }, num),
        h('span', { class: 'panel__sep' }, '/'),
        h('span', {}, name),
      );
    return h(
      'footer',
      { class: 'dock' },
      h(
        'div',
        { class: 'dock__row dock__row--transcript' },
        dockLabel('04', 'TRANSCRIPT'),
        h('div', { class: 'transcript' }, h('span', { class: 'cursor', 'aria-hidden': 'true' })),
        h('div', { class: 'dock__aside label dim' }, 'BUFFER: EMPTY'),
      ),
      h(
        'div',
        { class: 'dock__row dock__row--telemetry' },
        dockLabel('05', 'TELEMETRY'),
        h('div', { class: 'telemetry label dim' }, 'ACCEL —   GYRO —'),
        h('div', { class: 'dock__aside label dim' }, 'OFFLINE'),
      ),
    );
  }
}
