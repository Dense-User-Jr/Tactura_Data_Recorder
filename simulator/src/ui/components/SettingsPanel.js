import { h } from '../dom.js';

/**
 * Settings drawer (spec §14, Phase 5): finish, arm / callouts / telemetry,
 * lexicon size and crude filter, voice, mute, and the two volumes.
 *
 * Every control reads from and writes to the store; main.js applies the
 * changes and remembers them in this browser.
 *
 * @typedef {import('../Hud.js').HudState} HudState
 * @typedef {import('../../core/store.js').Store<HudState>} Store
 * @typedef {{ value: any, label: string, title?: string }} Option
 * @typedef {{ el: HTMLElement, sync: (state: HudState) => void }} Control
 */

export class SettingsPanel {
  /**
   * @param {{
   *   store: Store,
   *   finishes: Record<string, { label: string }>,
   *   voices: Array<{ id: string, label: string, note: string }>,
   *   lexiconSizes: number[],
   *   reset: (state: HudState) => HudState,
   *   onClose?: () => void,
   * }} options
   */
  constructor({ store, finishes, voices, lexiconSizes, reset, onClose = () => {} }) {
    this.store = store;
    this.onClose = onClose;
    /** @type {Control[]} */
    this.controls = [];

    /** @param {(s: HudState) => any} get @param {(s: HudState, v: any) => HudState} set @param {Option[]} options */
    const segmented = (get, set, options) => {
      const buttons = options.map((o) =>
        h(
          'button',
          {
            class: 'chip chamfer label',
            type: 'button',
            title: o.title,
            onClick: () => store.update((s) => set(s, o.value)),
          },
          o.label,
        ),
      );
      return this.#control(h('div', { class: 'seg' }, buttons), (s) =>
        options.forEach((o, i) => buttons[i].setAttribute('aria-pressed', String(get(s) === o.value))),
      );
    };

    /** @param {(s: HudState) => boolean} get @param {(s: HudState, v: boolean) => HudState} set @param {[string, string]} [labels] */
    const toggle = (get, set, labels = ['ON', 'OFF']) => {
      const button = h('button', { class: 'chip chamfer label toggle', type: 'button', onClick: () => store.update((s) => set(s, !get(s))) });
      return this.#control(button, (s) => {
        const on = get(s);
        button.textContent = on ? labels[0] : labels[1];
        button.setAttribute('aria-pressed', String(on));
      });
    };

    /** @param {(s: HudState) => number} get @param {(s: HudState, v: number) => HudState} set */
    const slider = (get, set) => {
      const input = /** @type {HTMLInputElement} */ (
        h('input', { class: 'slider', type: 'range', min: '0', max: '100', step: '1', 'aria-valuetext': '' })
      );
      const readout = h('span', { class: 'slider__value label' });
      input.addEventListener('input', () => store.update((s) => set(s, Number(input.value) / 100)));
      return this.#control(h('div', { class: 'slider-row' }, input, readout), (s) => {
        const pct = Math.round(get(s) * 100);
        if (document.activeElement !== input) input.value = String(pct);
        readout.textContent = `${pct}%`;
        input.setAttribute('aria-valuetext', `${pct}%`);
      });
    };

    const lexiconNote = h('span', { class: 'set__note' });
    this.controls.push({ el: lexiconNote, sync: (s) => (lexiconNote.textContent = `${s.badges.lexicon?.value ?? '—'} spellable words now`) });

    const body = h(
      'div',
      { class: 'settings__body' },
      section('01', 'WATCH', [
        row('Finish', 'Case color', segmented((s) => s.watch.finish, (s, v) => ({ ...s, watch: { ...s.watch, finish: v } }), Object.entries(finishes).map(([value, f]) => ({ value, label: f.label })))),
      ]),
      section('02', 'VIEW', [
        row('Arm', 'Forearm and hand; with it off the watch stands upright like a product shot', toggle((s) => s.watch.mannequin, (s, v) => ({ ...s, watch: { ...s.watch, mannequin: v } }))),
        row('Callouts', 'Labels on the keys, display, IMU and sensors', toggle((s) => s.view.annotations, (s, v) => ({ ...s, view: { ...s.view, annotations: v } }))),
        row('Telemetry', 'Synthetic accel / gyro strip in the dock', toggle((s) => s.view.telemetry, (s, v) => ({ ...s, view: { ...s.view, telemetry: v } }))),
      ]),
      section('03', 'LEXICON', [
        row(
          'Size',
          'Most frequent English words considered (5k matches the bin analysis)',
          segmented(
            (s) => s.lexicon.size,
            (s, v) => ({ ...s, lexicon: { ...s.lexicon, size: v } }),
            lexiconSizes.map((n) => ({ value: n, label: `${n / 1000}K` })),
          ),
          lexiconNote,
        ),
        row('Crude words', 'Hide crude words from the matches', toggle((s) => s.lexicon.filterCrude, (s, v) => ({ ...s, lexicon: { ...s.lexicon, filterCrude: v } }), ['HIDDEN', 'SHOWN'])),
      ]),
      section('04', 'VOICE', [
        row('Voice', 'Kokoro voice for committed words', segmented((s) => s.voice.id, (s, v) => ({ ...s, voice: { ...s.voice, id: v } }), voices.map((v) => ({ value: v.id, label: v.label, title: v.note })))),
        row('Speech', 'Same as M', toggle((s) => !s.voice.muted, (s, v) => ({ ...s, voice: { ...s.voice, muted: !v } }), ['ON', 'MUTED'])),
        row('Voice volume', '', slider((s) => s.voice.volume, (s, v) => ({ ...s, voice: { ...s.voice, volume: v } }))),
      ]),
      section('05', 'SOUND', [row('UI sounds', 'Ticks on gesture, commit and NO WORD', slider((s) => s.sound.volume, (s, v) => ({ ...s, sound: { ...s.sound, volume: v } })))]),
    );

    this.closeButton = h('button', { class: 'icon-btn chamfer', type: 'button', 'aria-label': 'Close settings', title: 'Close (Esc)', onClick: () => this.close() }, '✕');
    this.el = h(
      'aside',
      { class: 'settings', role: 'dialog', 'aria-label': 'Settings', hidden: true },
      h('header', { class: 'settings__head label' }, h('span', { class: 'panel__num' }, '⚙'), h('span', { class: 'panel__sep' }, '/'), h('span', {}, 'SETTINGS'), this.closeButton),
      body,
      h(
        'footer',
        { class: 'settings__foot' },
        h('span', { class: 'label dim' }, 'SAVED IN THIS BROWSER'),
        h('button', { class: 'chip chamfer label', type: 'button', onClick: () => store.update(reset) }, 'RESET'),
      ),
    );

    store.subscribe((s) => this.#sync(s));
    this.#sync(store.get());
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open() {
    this.el.hidden = false;
    requestAnimationFrame(() => this.el.classList.add('is-open'));
    this.closeButton.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('is-open');
    this.el.hidden = true;
    this.onClose();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** @param {HTMLElement} el @param {(s: HudState) => void} sync @returns {HTMLElement} */
  #control(el, sync) {
    this.controls.push({ el, sync });
    return el;
  }

  /** @param {HudState} state */
  #sync(state) {
    if (this.lastState === state) return;
    this.lastState = state;
    for (const c of this.controls) c.sync(state);
  }
}

/** @param {string} num @param {string} name @param {HTMLElement[]} rows */
function section(num, name, rows) {
  return h(
    'section',
    { class: 'set' },
    h('h3', { class: 'set__head label' }, h('span', { class: 'panel__num' }, num), h('span', { class: 'panel__sep' }, '/'), h('span', {}, name)),
    rows,
  );
}

/** @param {string} name @param {string} hint @param {HTMLElement} control @param {HTMLElement} [extra] */
function row(name, hint, control, extra) {
  return h(
    'div',
    { class: 'set__row' },
    h('div', { class: 'set__label' }, h('span', { class: 'set__name' }, name), hint && h('span', { class: 'set__hint' }, hint)),
    control,
    extra,
  );
}
