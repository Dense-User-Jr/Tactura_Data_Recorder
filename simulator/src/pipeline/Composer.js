import { describeError } from './registry.js';

/**
 * Word composition in the sim (spec §6.3–6.4): the buffer of gestures typed
 * so far, the committed transcript, and the commands around them.
 *
 *   push(raw)   a gesture arrived → recognize, append to the buffer, decode
 *   commit()    Space: commit the selected exact match, or signal NO WORD
 *   backspace() drop the last gesture; on an empty buffer, the last word
 *   cycle(±1)   Tab / Shift+Tab: step through collisions (choose / juice)
 *   clear()     Esc: empty the buffer
 *   clearAll()  R: empty the buffer and the transcript
 *
 * Space-to-commit is the sim's word boundary; the real watch's end-of-word
 * mechanism is still undecided (decision log). Everything runs through one
 * queue, so a Space pressed right after a gesture sees that gesture decoded.
 *
 * State lives in the store's `compose` slice. One-off moments go on the bus:
 *   compose:token    { event, token, result }
 *   compose:commit   { word, candidate, tokens }
 *   compose:noword   { tokens }
 *   compose:uncommit { word }
 *   compose:clearall { words }
 *
 * @typedef {import('./types.js').BinToken} BinToken
 * @typedef {import('./types.js').DecodeResult} DecodeResult
 * @typedef {import('./types.js').GestureId} GestureId
 * @typedef {Object} TraceRow
 * @property {string} id
 * @property {number} t              ms since session start
 * @property {GestureId | null} gesture
 * @property {string} bin
 * @property {string[]} phonemes
 * @property {number} prefixCount   words still possible after this gesture
 * @property {number} exactCount
 * @property {string} source        keyboard | mouse | ...
 * @property {number} confidence
 * @property {string} [error]
 * @typedef {Object} ComposeState
 * @property {BinToken[]} buffer
 * @property {DecodeResult | null} result   decode of the buffer; null when empty
 * @property {number} selected              index into result.exact
 * @property {string[]} transcript
 * @property {TraceRow[]} trace             newest first, at most TRACE_ROWS
 */

export const TRACE_ROWS = 8;

/** @returns {ComposeState} */
export function emptyCompose() {
  return { buffer: [], result: null, selected: 0, transcript: [], trace: [] };
}

export class Composer {
  /**
   * @param {{ pipeline: import('./Pipeline.js').Pipeline, store: import('../core/store.js').Store<any>, bus: import('../core/eventBus.js').EventBus, sinceStart: (t: number) => number }} deps
   */
  constructor({ pipeline, store, bus, sinceStart }) {
    this.pipeline = pipeline;
    this.store = store;
    this.bus = bus;
    this.sinceStart = sinceStart;
    this.queue = Promise.resolve();
  }

  /** @returns {ComposeState} */
  get state() {
    return this.store.get().compose;
  }

  /** True when Tab has something to cycle (more than one exact match). */
  get canCycle() {
    return (this.state.result?.exact.length ?? 0) > 1;
  }

  /** @param {import('./types.js').RawInput} raw */
  push(raw) {
    return this.#enqueue(async () => {
      let recognized;
      try {
        recognized = await this.pipeline.recognize(raw);
      } catch (err) {
        this.bus.emit('toast', { message: 'Gesture not recognized', tone: 'error', detail: describeError(err) });
        this.#addTrace({
          id: `err${raw.t}`,
          t: this.sinceStart(raw.t),
          gesture: raw.label ?? null,
          bin: '',
          phonemes: [],
          prefixCount: 0,
          exactCount: 0,
          source: raw.source,
          confidence: 0,
          error: describeError(err),
        });
        return;
      }
      for (const { event, token } of recognized) {
        const buffer = [...this.state.buffer, token];
        const result = await this.#decode(buffer);
        this.#set({ buffer, result, selected: 0 });
        this.#addTrace({
          id: event.id,
          t: this.sinceStart(event.t),
          gesture: event.gesture,
          bin: token.bin,
          phonemes: token.phonemes,
          prefixCount: result.prefixCount,
          exactCount: result.exact.length,
          source: event.source,
          confidence: event.confidence,
        });
        this.bus.emit('compose:token', { event, token, result });
      }
    });
  }

  commit() {
    return this.#enqueue(async () => {
      const { buffer, result, selected, transcript } = this.state;
      if (!buffer.length) return;
      const candidate = result?.exact[selected];
      if (!candidate) {
        this.bus.emit('compose:noword', { tokens: buffer });
        return;
      }
      this.#set({ buffer: [], result: null, selected: 0, transcript: [...transcript, candidate.word] });
      this.bus.emit('compose:commit', { word: candidate.word, candidate, tokens: buffer });
    });
  }

  backspace() {
    return this.#enqueue(async () => {
      const { buffer, transcript } = this.state;
      if (buffer.length) {
        const next = buffer.slice(0, -1);
        this.#set({ buffer: next, result: next.length ? await this.#decode(next) : null, selected: 0 });
      } else if (transcript.length) {
        const word = transcript[transcript.length - 1];
        this.#set({ transcript: transcript.slice(0, -1) });
        this.bus.emit('compose:uncommit', { word });
      }
    });
  }

  /** @param {1 | -1} direction */
  cycle(direction) {
    return this.#enqueue(async () => {
      const n = this.state.result?.exact.length ?? 0;
      if (n < 2) return;
      this.#set({ selected: (this.state.selected + direction + n) % n });
    });
  }

  clear() {
    return this.#enqueue(async () => {
      if (this.state.buffer.length) this.#set({ buffer: [], result: null, selected: 0 });
    });
  }

  clearAll() {
    return this.#enqueue(async () => {
      const { buffer, transcript } = this.state;
      if (!buffer.length && !transcript.length) return;
      this.#set({ buffer: [], result: null, selected: 0, transcript: [] });
      this.bus.emit('compose:clearall', { words: transcript });
    });
  }

  /** Re-decode the current buffer, e.g. after the lexicon or decoder changed. */
  refresh() {
    return this.#enqueue(async () => {
      const { buffer } = this.state;
      this.#set({ result: buffer.length ? await this.#decode(buffer) : null, selected: 0 });
    });
  }

  /** @param {BinToken[]} tokens @returns {Promise<DecodeResult>} */
  async #decode(tokens) {
    try {
      return await this.pipeline.decode(tokens);
    } catch (err) {
      this.bus.emit('toast', { message: 'Decoder failed', tone: 'error', detail: describeError(err) });
      return { exact: [], prefixCount: 0, prefixPreview: [] };
    }
  }

  /** @param {TraceRow} row */
  #addTrace(row) {
    this.#set({ trace: [row, ...this.state.trace].slice(0, TRACE_ROWS) });
  }

  /** @param {Partial<ComposeState>} patch */
  #set(patch) {
    this.store.update((s) => ({ ...s, compose: { ...s.compose, ...patch } }));
  }

  /** @param {() => Promise<void>} task */
  #enqueue(task) {
    this.queue = this.queue.then(task).catch((err) => {
      console.error('[composer]', err);
      this.bus.emit('toast', { message: 'Composer error', tone: 'error', detail: describeError(err) });
    });
    return this.queue;
  }
}
