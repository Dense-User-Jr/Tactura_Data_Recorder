import { h, panelHead } from './dom.js';
import { StageBadge } from './components/StageBadge.js';
import { ScreenMirror } from './components/ScreenMirror.js';
import { PipelineTrace } from './components/PipelineTrace.js';
import { Transcript } from './components/Transcript.js';
import { TelemetryStrip } from './components/TelemetryStrip.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { isShortcutEvent } from '../core/keyboard.js';

/**
 * @typedef {import('./components/StageBadge.js').BadgeState} BadgeState
 * @typedef {Object} HudState
 * @property {{ leftRail: boolean, rightRail: boolean }} ui
 * @property {{ source: string }} input
 * @property {Record<string, BadgeState>} badges   rendered in insertion order
 * @property {{ fps: number, dpr: number, gl: string }} perf
 * @property {{ finish: string, mannequin: boolean }} watch
 * @property {{ annotations: boolean, telemetry: boolean }} view
 * @property {{ size: number, filterCrude: boolean }} lexicon
 * @property {{ yaw: number, pitch: number, distance: number }} camera   degrees, degrees, world units
 * @property {import('../pipeline/Composer.js').ComposeState} compose
 * @property {{ app: string }} screen
 * @property {{ id: string, muted: boolean, volume: number }} voice
 * @property {{ volume: number }} sound
 */

/** @param {number} deg */
const signedDeg = (deg) => `${deg < 0 ? '−' : '+'}${String(Math.abs(Math.round(deg))).padStart(3, '0')}°`;

const GEAR_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
  <circle cx="8" cy="8" r="2.1"/><circle cx="8" cy="8" r="4.6"/>
  <path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15M3.05 3.05l1.7 1.7M11.25 11.25l1.7 1.7M3.05 12.95l1.7-1.7M11.25 4.75l1.7-1.7"/>
</svg>`;

/**
 * The HUD frame (spec §6.2): top bar, left rail (01 gestures), right rail
 * (02 screen, 03 trace), dock (04 transcript, 05 telemetry), and the
 * click-through stage over the full-bleed 3D viewport.
 *
 * Settings (⚙) and help (? / H) open as overlays on top.
 */
export class Hud {
  /**
   * @param {{
   *   root: HTMLElement,
   *   store: import('../core/store.js').Store<HudState>,
   *   bus: import('../core/eventBus.js').EventBus,
   *   version: string,
   *   deck: import('./components/GestureDeck.js').GestureDeck,
   *   settings: Omit<ConstructorParameters<typeof SettingsPanel>[0], 'store'>,
   * }} deps
   */
  constructor({ root, store, bus, version, deck, settings }) {
    this.root = root;
    this.store = store;
    this.bus = bus;
    this.deck = deck;
    /** @type {Map<string, StageBadge>} */
    this.badges = new Map();
    this.mirror = new ScreenMirror();
    this.trace = new PipelineTrace();
    this.transcript = new Transcript();
    this.telemetry = new TelemetryStrip();
    this.settings = new SettingsPanel({ store, ...settings, onClose: () => this.gearButton.focus({ preventScroll: true }) });
    this.help = new HelpOverlay();

    root.append(this.#topbar(version), this.#leftRail(), this.#stage(), this.#rightRail(), this.#dock());
    document.body.append(this.settings.el, this.help.el);

    bus.on('screen:frame', (/** @type {HTMLCanvasElement} */ canvas) => {
      this.mirror.draw(canvas);
      this.mirrorEl.classList.add('has-signal');
    });
    store.watch((s) => s.compose, (compose) => {
      this.trace.render(compose);
      this.transcript.render(compose);
    });
    bus.on('compose:noword', () => this.transcript.flashNoWord());
    store.watch((s) => s.screen.app, (app) => {
      this.appLabel.textContent = `APP: ${app}`;
    });
    store.watch((s) => s.view.telemetry, (on) => {
      this.telemetry.setEnabled(on);
      this.telemetryRow.classList.toggle('is-off', !on);
    });
    store.watch((s) => s.camera, (cam) => {
      this.cameraReadout.textContent = `YAW ${signedDeg(cam.yaw)}  PITCH ${signedDeg(cam.pitch)}  DIST ${cam.distance.toFixed(2)}`;
    });

    store.watch((s) => s.ui, (ui) => {
      root.dataset.left = ui.leftRail ? 'open' : 'closed';
      root.dataset.right = ui.rightRail ? 'open' : 'closed';
    });
    store.watch((s) => s.badges, (badges) => this.#renderBadges(badges));
    store.watch((s) => s.input, (input) => {
      this.inputValue.textContent = input.source.toUpperCase();
    });
    store.watch((s) => s.perf, (perf) => {
      // fps counts drawn frames; 0 means the scene is idle and skipping the GPU entirely
      const fps = perf.fps > 0 ? String(perf.fps).padStart(2, '0') : 'IDLE';
      this.readout.textContent = perf.gl === 'ERROR' ? 'GL: ERROR' : `FPS ${fps} · DPR ${perf.dpr.toFixed(1)} · ${perf.gl}`;
    });

    window.addEventListener('keydown', (e) => this.#onKey(e));
    // capture phase: overlays get Esc before the composer (which would clear the buffer)
    window.addEventListener('keydown', (e) => this.#onOverlayKey(e), true);
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
    else if (e.key === '?' || e.key === 'h' || e.key === 'H') this.help.toggle();
    else return;
    e.preventDefault();
  }

  /**
   * Esc closes help, then settings, before anything else sees it. While help
   * is open it is modal: other keys don't fire gestures underneath it.
   * @param {KeyboardEvent} e
   */
  #onOverlayKey(e) {
    if (this.help.isOpen) {
      if (e.key === 'Escape' || e.key === '?' || e.key === 'h' || e.key === 'H') {
        if (!e.repeat) this.help.close();
      }
      if (e.key !== 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (e.key === 'Escape' && this.settings.isOpen) {
      this.settings.close();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
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
        (this.gearButton = h('button', {
          class: 'icon-btn chamfer',
          type: 'button',
          title: 'Settings',
          'aria-label': 'Settings',
          html: GEAR_SVG,
          onClick: () => this.settings.toggle(),
        })),
        h(
          'button',
          {
            class: 'icon-btn chamfer',
            type: 'button',
            title: 'Help (?)',
            'aria-label': 'Help',
            onClick: () => this.help.toggle(),
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
    return h(
      'aside',
      { class: 'rail rail--left' },
      h(
        'div',
        { class: 'rail__inner' },
        h(
          'section',
          { class: 'panel panel--grow' },
          panelHead(
            '01',
            'GESTURES',
            h('span', { class: 'panel__meta-group' }, 'KEYS 1–6', this.#railToggle('[', 'leftRail', 'gestures rail')),
          ),
          h('div', { class: 'panel__body' }, this.deck.el),
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
              (this.mirrorEl = h(
                'div',
                { class: 'mirror' },
                this.mirror.canvas,
                h('span', { class: 'mirror__msg label' }, 'NO SIGNAL'),
              )),
            ),
            h(
              'div',
              { class: 'mirror-meta label dim' },
              h('span', {}, '480 × 480'),
              (this.appLabel = h('span', {}, 'APP: NONE')),
            ),
          ),
        ),
        h(
          'section',
          { class: 'panel panel--grow' },
          panelHead('03', 'TRACE', 'LAST 8'),
          this.trace.candidates,
          this.trace.head,
          this.trace.list,
        ),
      ),
      this.#railTab(']', 'rightRail', '02 / SCREEN · 03 / TRACE'),
    );
  }

  #stage() {
    this.readout = h('div', { class: 'stage__readout label' });
    this.cameraReadout = h('div', { class: 'stage__camera label dim' });
    this.toastRoot = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const hint = (keys, action) => h('span', {}, ...keys.map((k) => h('kbd', {}, k)), h('span', { class: 'stage__hint-act' }, action));
    /** The viewport cell; the 3D view keeps the watch centered in it. */
    this.stageEl = h(
      'div',
      { class: 'stage' },
      ['tl', 'tr', 'bl', 'br'].map((corner) => h('span', { class: `stage__mark stage__mark--${corner}` })),
      h(
        'div',
        { class: 'stage__head' },
        h(
          'div',
          { class: 'stage__label label' },
          h('span', { class: 'panel__num' }, '00'),
          h('span', { class: 'panel__sep' }, '/'),
          h('span', {}, 'VIEWPORT'),
        ),
        this.cameraReadout,
      ),
      h(
        'div',
        { class: 'stage__hint label dim' },
        hint(['W', 'A', 'S', 'D'], 'ORBIT'),
        hint(['DRAG'], 'ORBIT'),
        hint(['SCROLL'], 'ZOOM'),
        hint(['R'], 'RESET'),
        hint(['?'], 'HELP'),
      ),
      this.readout,
      this.toastRoot,
    );
    return this.stageEl;
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
        this.transcript.el,
        this.transcript.aside,
      ),
      (this.telemetryRow = h(
        'div',
        { class: 'dock__row dock__row--telemetry' },
        dockLabel('05', 'TELEMETRY'),
        this.telemetry.el,
        this.telemetry.aside,
      )),
    );
  }
}
