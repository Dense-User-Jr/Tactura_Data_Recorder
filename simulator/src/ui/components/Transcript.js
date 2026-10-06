import { h } from '../dom.js';
import { GESTURE_BY_ID } from '../../config/gestures.js';

const NOWORD_MS = 600;

/**
 * Dock row 04 / TRANSCRIPT (spec §7.3): committed words in Doto with a
 * blinking block cursor, then the current buffer as phoneme chips. The aside
 * shows the buffer as keys and how many words match.
 *
 * @typedef {import('../../pipeline/Composer.js').ComposeState} ComposeState
 */
export class Transcript {
  constructor() {
    this.words = h('span', { class: 'transcript__words' });
    this.cursor = h('span', { class: 'cursor', 'aria-hidden': 'true' });
    this.chips = h('span', { class: 'transcript__chips' });
    this.el = h('div', { class: 'transcript', 'aria-live': 'polite' }, this.words, this.cursor, this.chips);
    this.aside = h('div', { class: 'dock__aside label' });
    /** @type {string[]} */
    this.shown = [];
    this.noWordTimer = 0;
  }

  /** @param {ComposeState} compose */
  render({ transcript, buffer, result }) {
    // words: append or drop at the end only (commit / backspace)
    while (this.shown.length > transcript.length) {
      this.words.lastElementChild?.remove();
      this.shown.pop();
    }
    for (let i = this.shown.length; i < transcript.length; i++) {
      this.words.append(h('span', { class: 'transcript__word is-new' }, transcript[i]));
      this.shown.push(transcript[i]);
    }
    if (this.shown.length !== transcript.length || this.shown.some((w, i) => w !== transcript[i])) {
      this.words.replaceChildren(...transcript.map((w) => h('span', { class: 'transcript__word' }, w)));
      this.shown = [...transcript];
    }

    this.chips.replaceChildren(
      ...buffer.map((t) => h('span', { class: 'buf-chip chamfer label' }, t.phonemes.join('/'))),
    );
    this.el.scrollLeft = this.el.scrollWidth;

    const keys = buffer.map((t) => h('kbd', {}, GESTURE_BY_ID[t.gesture]?.key ?? '?'));
    let status = '';
    if (buffer.length && result) {
      const n = result.exact.length;
      status = n ? `→ ${n} MATCH${n > 1 ? 'ES' : ''}` : result.prefixCount ? `→ ${result.prefixCount} POSSIBLE` : '→ NO MATCH';
    }
    this.aside.replaceChildren(
      h('span', { class: 'dim' }, 'BUFFER'),
      buffer.length ? h('span', { class: 'aside__keys' }, keys) : h('span', { class: 'dim' }, 'EMPTY'),
      status && h('span', { class: 'aside__status' }, status),
    );
  }

  /** Space with no exact match: a short red NO WORD in the aside. */
  flashNoWord() {
    clearTimeout(this.noWordTimer);
    this.aside.classList.add('is-noword');
    this.aside.dataset.flash = 'NO WORD';
    this.noWordTimer = window.setTimeout(() => this.aside.classList.remove('is-noword'), NOWORD_MS);
  }
}
