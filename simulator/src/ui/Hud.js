import { h, panelHead } from './dom.js';
import { StageBadge } from './components/StageBadge.js';
import { ScreenMirror } from './components/ScreenMirror.js';
import { FinishPicker } from './components/FinishPicker.js';
import { PipelineTrace } from './components/PipelineTrace.js';
import { Transcript } from './components/Transcript.js';
import { isShortcutEvent } from '../core/keyboard.js';

/**
 * @typedef {import('./components/StageBadge.js').BadgeState} BadgeState
 * @typedef {Object} HudState
 * @property {{ leftRail: boolean, rightRail: boolean }} ui
 * @property {{ source: string }} input
 * @property {Record<string, BadgeState>} badges   rendered in insertion order
 * @property {{ fps: number, dpr: number, gl: string }} perf
 * @property {{ finish: string, mannequin: boolean }} watch
 * @property {{ yaw: number, pitch: number, distance: number }} camera   degrees, degrees, world units
 * @property {import('../pipeline/Composer.js').ComposeState} compose
 * @property {{ app: string }} screen
 * @property {{ id: string, muted: boolean }} voice
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
 * Panels not built yet show honest placeholders; later phases fill them in.
 */
export class Hud {
  /**
   * @param {{ root: HTMLElement, store: import('../core/store.js').Store<HudState>, bus: import('../core/eventBus.js').EventBus, version: string, finishes: Record<string, { label: string }>, voices: Array<{ id: string, label: string, note: string }>, deck: import('./components/GestureDeck.js').GestureDeck }} deps
   */
  constructor({ root, store, bus, version, finishes, voices, deck }) {
    this.root = root;
    this.store = store;
    this.bus = bus;
    this.deck = deck;
    /** @type {Map<string, StageBadge>} */
    this.badges = new Map();
    this.mirror = new ScreenMirror();
    this.trace = new PipelineTrace();
    this.transcript = new Transcript();
    this.finishPicker = new FinishPicker({
      finishes,
      onPick: (finish) => store.update((s) => ({ ...s, watch: { ...s.watch, finish } })),
    });
    this.armToggle = /** @type {HTMLButtonElement} */ (
      h('button', {
        class: 'chip chamfer label',
        type: 'button',
        title: 'Show or hide the forearm and hand',
        onClick: () => store.update((s) => ({ ...s, watch: { ...s.watch, mannequin: !s.watch.mannequin } })),
      })
    );
    // voice picker (moves into the settings panel in Phase 5): click cycles the voices
    this.voiceChip = /** @type {HTMLButtonElement} */ (
      h('button', {
        class: 'chip chamfer label',
        type: 'button',
        onClick: () =>
          store.update((s) => {
            const i = voices.findIndex((v) => v.id === s.voice.id);
            return { ...s, voice: { ...s.voice, id: voices[(i + 1) % voices.length].id } };
          }),
      })
    );
    this.muteChip = /** @type {HTMLButtonElement} */ (
      h('button', {
        class: 'chip chamfer label',
        type: 'button',
        title: 'Mute or unmute the voice (M)',
        onClick: () => store.update((s) => ({ ...s, voice: { ...s.voice, muted: !s.voice.muted } })),
      })
    );

    root.append(this.#topbar(version), this.#leftRail(), this.#stage(), this.#rightRail(), this.#dock());

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
    store.watch((s) => s.watch.finish, (finish) => this.finishPicker.set(finish));
    store.watch((s) => s.watch.mannequin, (on) => {
      this.armToggle.textContent = on ? 'ON' : 'OFF';
      this.armToggle.setAttribute('aria-pressed', String(on));
    });
    store.watch((s) => s.voice, (v) => {
      const current = voices.find((x) => x.id === v.id);
      this.voiceChip.textContent = current?.label ?? v.id;
      this.voiceChip.title = `${current?.note ?? v.id}. Click for the next voice.`;
      this.muteChip.textContent = v.muted ? 'MUTED' : 'ON';
      this.muteChip.setAttribute('aria-pressed', String(!v.muted));
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
        { class: 'stage__view' },
        this.finishPicker.el,
        h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'Arm' }, h('span', { class: 'label dim' }, 'ARM'), this.armToggle),
        h(
          'div',
          { class: 'view-toggle', role: 'group', 'aria-label': 'Voice' },
          h('span', { class: 'label dim' }, 'VOICE'),
          this.voiceChip,
          this.muteChip,
        ),
      ),
      h(
        'div',
        { class: 'stage__hint label dim' },
        hint(['W', 'A', 'S', 'D'], 'ORBIT'),
        hint(['DRAG'], 'ORBIT'),
        hint(['SCROLL'], 'ZOOM'),
        hint(['R'], 'RESET'),
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
