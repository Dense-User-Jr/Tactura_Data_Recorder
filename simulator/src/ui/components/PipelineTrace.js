import { h } from '../dom.js';
import { GESTURE_BY_ID, glyphSvg } from '../../config/gestures.js';
import { formatT } from '../../core/clock.js';

/** Zipf scale tops out around 8 ("the" is 7.7); bars are drawn against this. */
const ZIPF_MAX = 8;

/**
 * Right-rail 03 / TRACE content (spec §7.3):
 *
 * - Candidates for the current buffer: word in Doto, a thin frequency bar,
 *   COLLISION when more than one word matches exactly, ▸ on the selected one.
 *   While only prefixes match, a dim preview of where the buffer is heading.
 * - The last 8 pipeline events, newest on top: T+ms, gesture glyph and
 *   name, bin and phonemes, and how many words are still possible. New rows
 *   slide in with a red tick that fades.
 *
 * @typedef {import('../../pipeline/Composer.js').ComposeState} ComposeState
 * @typedef {import('../../pipeline/Composer.js').TraceRow} TraceRow
 */
export class PipelineTrace {
  constructor() {
    this.candMeta = h('span', { class: 'cands__meta' });
    this.candTag = h('span', { class: 'tag chamfer', hidden: true }, 'COLLISION');
    this.candList = h('ol', { class: 'cands__list' });
    this.rows = h('ol', { class: 'trace' });
    this.empty = h('div', { class: 'empty label' }, 'NO EVENTS');
    /** @type {Set<string>} */
    this.rendered = new Set();

    this.candidates = h(
      'div',
      { class: 'cands' },
      h('div', { class: 'cands__head label' }, h('span', {}, 'CANDIDATES'), this.candMeta, this.candTag),
      this.candList,
    );
    this.head = h(
      'div',
      { class: 'trace-head label' },
      h('span', {}, 'T+MS'),
      h('span', {}, 'GESTURE ▸ BIN'),
      h('span', {}, 'N'),
    );
    this.list = h('div', { class: 'trace-scroll' }, this.rows, this.empty);
  }

  /** @param {ComposeState} compose */
  render(compose) {
    this.#renderCandidates(compose);
    this.#renderRows(compose.trace);
  }

  /** @param {ComposeState} compose */
  #renderCandidates({ buffer, result, selected }) {
    const exact = result?.exact ?? [];
    this.candTag.hidden = exact.length < 2;

    if (!buffer.length || !result) {
      this.candMeta.textContent = 'BUFFER EMPTY';
      this.candList.replaceChildren();
      return;
    }
    if (exact.length) {
      this.candMeta.textContent = `${exact.length} EXACT`;
      this.candList.replaceChildren(
        ...exact.slice(0, 4).map((c, i) => candidate(c.word, c.zipf, i === selected ? 'selected' : 'exact')),
      );
      return;
    }
    this.candMeta.textContent = result.prefixCount ? `0 EXACT · ${result.prefixCount} POSSIBLE` : 'NO MATCH';
    this.candList.replaceChildren(...result.prefixPreview.map((c) => candidate(c.word, c.zipf, 'prefix')));
  }

  /** @param {TraceRow[]} trace newest first */
  #renderRows(trace) {
    this.empty.hidden = trace.length > 0;
    const ids = new Set(trace.map((r) => r.id));
    for (const el of [...this.rows.children]) {
      const id = /** @type {HTMLElement} */ (el).dataset.id ?? '';
      if (!ids.has(id)) {
        el.remove();
        this.rendered.delete(id);
      }
    }
    // rows only ever arrive at the top
    for (const row of [...trace].reverse()) {
      if (this.rendered.has(row.id)) continue;
      this.rendered.add(row.id);
      this.rows.prepend(traceRow(row));
    }
  }
}

/**
 * @param {string} word
 * @param {number} zipf
 * @param {'selected'|'exact'|'prefix'} kind
 */
function candidate(word, zipf, kind) {
  return h(
    'li',
    { class: `cand cand--${kind}` },
    h('span', { class: 'cand__mark' }, kind === 'selected' ? '▸' : kind === 'prefix' ? '…' : ''),
    h('span', { class: 'cand__word' }, word),
    h('span', { class: 'cand__bar' }, h('i', { style: { width: `${Math.round((Math.min(zipf, ZIPF_MAX) / ZIPF_MAX) * 100)}%` } })),
    h('span', { class: 'cand__z label' }, zipf.toFixed(2)),
  );
}

/** @param {TraceRow} row */
function traceRow(row) {
  const gesture = row.gesture ? GESTURE_BY_ID[row.gesture] : null;
  const binShort = row.bin.replace(/\s*\(.*\)$/, ''); // "High vowel (front-tense / back-lax)" → "High vowel"
  const source = row.source === 'keyboard' ? 'KEY' : row.source === 'mouse' ? 'CLICK' : row.source.toUpperCase();
  return h(
    'li',
    { class: `trace__row${row.error ? ' trace__row--error' : ''}`, dataset: { id: row.id } },
    h('span', { class: 'trace__t label nocase' }, formatT(row.t)),
    h(
      'span',
      { class: 'trace__main' },
      h(
        'span',
        { class: 'trace__g label' },
        gesture && h('span', { class: 'trace__glyph', html: glyphSvg(gesture) }),
        gesture ? gesture.name : 'UNKNOWN',
      ),
      h(
        'span',
        { class: 'trace__bin label' },
        // phonemes first: if the row is too narrow, the bin name is what gets cut
        h('span', { class: 'trace__bin-text' }, row.error ? row.error : `${row.phonemes.join('/')} · ${binShort}`),
        !row.error && h('span', { class: 'trace__src' }, `${source} ${row.confidence.toFixed(2)}`),
      ),
    ),
    h('span', { class: 'trace__n' }, row.error ? '!' : String(row.prefixCount)),
  );
}
