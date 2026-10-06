import { GESTURES } from '../../config/gestures.js';
import { CRUDE_WORDS, DEFAULT_FILTER_CRUDE, DEFAULT_LEXICON_SIZE } from '../../config/lexicon.js';

/**
 * The spellable vocabulary (spec §8.6).
 *
 * lexicon_base.json holds CMUdict pronunciations for wordfreq's top 50k
 * English words, NOT filtered by the bins. This class filters it against the
 * current bins at load, so editing gesture_bins.json recomputes the
 * vocabulary (and a live bin editor can just build a new Lexicon).
 *
 * A pronunciation is kept only if every phoneme is in some bin; it becomes
 * the gesture sequence that spells it. Single letters, the exclude list
 * (tools/lexicon_exclude.txt) and, by default, crude words are dropped.
 *
 * @typedef {import('../types.js').GestureId} GestureId
 * @typedef {import('../types.js').Candidate} Candidate
 * @typedef {import('../mapper/BinMapper.js').BinMapper} BinMapper
 * @typedef {Object} LexiconData  the parsed lexicon_base.json
 * @property {number} v
 * @property {string} source
 * @property {number} topN
 * @property {Array<[word: string, zipf: number, pronunciations: string[], rank: number]>} words
 * @typedef {Object} LexiconOptions
 * @property {number} [size]          only wordfreq's top `size` words (5k, 20k or 50k)
 * @property {boolean} [filterCrude]
 * @property {Iterable<string>} [exclude]
 * @property {Iterable<string>} [crude]
 * @typedef {{ word: string, zipf: number, phonemes: string[], key: string }} Entry
 */

/** One character per gesture, by key order: '1' Flick Up … '6' Double Tap. */
const CODE = Object.fromEntries(GESTURES.map((g, i) => [g.id, String(i + 1)]));

/**
 * Compact key for a gesture sequence, e.g. Double Tap, Twist Right, Shake → "635".
 * One character per gesture, so prefix matching is plain string prefix matching.
 * @param {readonly GestureId[]} gestures
 */
export function sequenceKey(gestures) {
  return gestures.map((g) => CODE[g]).join('');
}

/**
 * Parses tools/lexicon_exclude.txt: one word per line, `#` comments.
 * @param {string} text
 */
export function parseWordList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim().toLowerCase())
    .filter(Boolean);
}

/** Higher zipf first, then alphabetical so ties are stable. @param {Entry} a @param {Entry} b */
const byFrequency = (a, b) => b.zipf - a.zipf || a.word.localeCompare(b.word);

export class Lexicon {
  /**
   * @param {LexiconData} data
   * @param {BinMapper} mapper
   * @param {LexiconOptions} [options]
   */
  constructor(data, mapper, options = {}) {
    const { size = DEFAULT_LEXICON_SIZE, filterCrude = DEFAULT_FILTER_CRUDE, exclude = [], crude = CRUDE_WORDS } = options;
    const excluded = new Set(exclude);
    const crudeWords = filterCrude ? new Set(crude) : new Set();

    /** @type {Entry[]} */
    const entries = [];
    const seen = new Set();
    for (const [word, zipf, pronunciations, rank] of data.words) {
      if (rank >= size || word.length < 2 || excluded.has(word) || crudeWords.has(word)) continue;
      for (const pron of pronunciations) {
        const phonemes = pron.split(' ');
        const gestures = phonemes.map((p) => mapper.gestureFor(p));
        if (gestures.some((g) => !g)) continue; // some phoneme has no gesture
        const key = sequenceKey(/** @type {GestureId[]} */ (gestures));
        if (seen.has(`${word}|${key}`)) continue; // two pronunciations, same spelling
        seen.add(`${word}|${key}`);
        entries.push({ word, zipf, phonemes, key });
      }
    }

    // sorted by key so a prefix is one contiguous run; ranked within each key
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : byFrequency(a, b)));
    this.entries = entries;

    /** @type {Map<string, Entry[]>} */
    this.byKey = new Map();
    for (const e of entries) {
      if (!this.byKey.has(e.key)) this.byKey.set(e.key, []);
      this.byKey.get(e.key)?.push(e);
    }

    const collisions = [...this.byKey.values()].filter((list) => new Set(list.map((e) => e.word)).size > 1).length;
    this.stats = {
      /** distinct spellable words, what the LEX badge shows */
      words: new Set(entries.map((e) => e.word)).size,
      sequences: this.byKey.size,
      /** sequences shared by more than one word */
      collisions,
      size,
      filterCrude,
      source: data.source,
    };
  }

  /**
   * Words spelled by exactly this sequence, most frequent first.
   * @param {string} key from `sequenceKey`
   * @returns {Candidate[]}
   */
  exact(key) {
    return (this.byKey.get(key) ?? []).map(toCandidate);
  }

  /**
   * Words whose sequence starts with `key` (including exact matches).
   * @param {string} key
   * @param {number} [previewCount]
   * @returns {{ count: number, preview: Candidate[] }} count of distinct words, and the most frequent few
   */
  prefix(key, previewCount = 3) {
    const run = this.#prefixRun(key);
    /** @type {Map<string, Entry>} */
    const best = new Map();
    for (const e of run) {
      const prev = best.get(e.word);
      if (!prev || e.zipf > prev.zipf) best.set(e.word, e);
    }
    const preview = [...best.values()].sort(byFrequency).slice(0, previewCount).map(toCandidate);
    return { count: best.size, preview };
  }

  /** @param {string} key */
  #prefixRun(key) {
    // binary search for the first entry whose key is >= `key`
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid].key < key) lo = mid + 1;
      else hi = mid;
    }
    const run = [];
    for (let i = lo; i < this.entries.length && this.entries[i].key.startsWith(key); i++) run.push(this.entries[i]);
    return run;
  }
}

/** @param {Entry} e @returns {Candidate} */
function toCandidate(e) {
  return { word: e.word, phonemes: [...e.phonemes], zipf: e.zipf };
}
